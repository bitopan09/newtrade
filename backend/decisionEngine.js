const AnalysisEngine = require('./analysisEngine');

// Known high-impact news dates (FOMC, CPI, NFP, etc.)
// In production, this would be fetched dynamically from a news API
const HIGH_IMPACT_NEWS_DATES = new Set([
    // FOMC Meetings 2026
    '2026-01-29', '2026-03-19', '2026-05-07', '2026-06-18',
    '2026-07-30', '2026-09-17', '2026-11-05', '2026-12-17',
    // CPI Release Dates 2026
    '2026-01-14', '2026-02-12', '2026-03-12', '2026-04-14',
    '2026-05-13', '2026-06-11', '2026-07-15', '2026-08-12',
    '2026-09-15', '2026-10-14', '2026-11-12', '2026-12-10',
    // NFP (Non-Farm Payrolls)
    '2026-01-09', '2026-02-06', '2026-03-06', '2026-04-03',
    '2026-05-01', '2026-06-05', '2026-07-02', '2026-08-07',
    '2026-09-04', '2026-10-02', '2026-11-06', '2026-12-04',
    // Major crypto-specific events
    '2026-04-15', // Tax deadline
]);

class DecisionEngine {
    constructor() {
        this.analysisEngine = new AnalysisEngine();
        this.dailyTradeTaken = false;
        this.dailyLossCount = 0;
        this.lastTradeDate = null;
        this.circuitBreakerActive = false;

        // Load persistent state (in a real app, this would be from database)
        this._loadState();
    }

    /**
     * Check if today is a high-impact news day
     * @returns {boolean} True if today is a news day
     */
    _isNewsDay() {
        const today = new Date().toISOString().split('T')[0];
        return HIGH_IMPACT_NEWS_DATES.has(today);
    }

    /**
     * Make a trading decision based on market analysis
     * @param {Array} priceData - Historical price data
     * @returns {Object} Decision result with action and reasoning
     */
    async makeDecision(priceData) {
        // Reset daily stats if new day
        const today = new Date().toDateString();
        if (this.lastTradeDate !== today) {
            this.dailyTradeTaken = false;
            this.dailyLossCount = 0;
            this.lastTradeDate = today;
            this.circuitBreakerActive = false;
            this._saveState();
        }

        // Always perform technical analysis first so the live dashboard has real-time score & indicators
        const analysis = this.analysisEngine.analyze(priceData);

        // Check circuit breaker (2-loss rule)
        if (this.dailyLossCount >= 2) {
            this.circuitBreakerActive = true;
            return {
                action: 'SKIP',
                reason: '2-loss circuit breaker activated',
                details: {
                    score: analysis.score,
                    analysis: analysis.details,
                    dailyLossCount: this.dailyLossCount,
                    circuitBreakerActive: true
                }
            };
        }

        // Check daily trade lock (only 1 trade per session)
        if (this.dailyTradeTaken) {
            return {
                action: 'SKIP',
                reason: 'Daily trade limit reached (1 trade per session)',
                details: {
                    score: analysis.score,
                    analysis: analysis.details,
                    dailyTradeTaken: this.dailyTradeTaken
                }
            };
        }

        // Check session time gate (8:00 AM to 4:00 PM UTC for Asian and active sessions)
        const now = new Date();
        const hour = now.getUTCHours();
        const minute = now.getUTCMinutes();
        const timeInMinutes = hour * 60 + minute;
        const isSessionOpen = (timeInMinutes >= 8 * 60 && timeInMinutes <= 16 * 60); // 8:00 AM - 4:00 PM UTC

        if (!isSessionOpen) {
            return {
                action: 'SKIP',
                reason: 'Outside trading session hours',
                details: {
                    score: analysis.score,
                    analysis: analysis.details,
                    currentHourUTC: hour,
                    sessionOpen: isSessionOpen
                }
            };
        }

        // v2 FIX: Real news day filter (replaces hardcoded true)
        if (this._isNewsDay()) {
            console.log(`[DecisionEngine] 🚫 News day detected — skipping trade.`);
            return {
                action: 'SKIP',
                reason: 'High-impact news day (FOMC/CPI/NFP) — trade blocked',
                details: {
                    score: analysis.score,
                    analysis: analysis.details,
                    newsFilterPassed: false,
                    newsDate: new Date().toISOString().split('T')[0]
                }
            };
        }

        // Check if score meets minimum threshold (matches UnifiedStrategy v2)
        if (analysis.score < 5) {
            return {
                action: 'SKIP',
                reason: `Confluence score too low: ${analysis.score}/10`,
                details: {
                    score: analysis.score,
                    threshold: 5,
                    analysis: analysis.details
                }
            };
        }

        // All checks passed - generate trade signal
        return {
            action: analysis.signal,
            reason: 'All checks passed, trade signal generated',
            details: {
                score: analysis.score,
                analysis: analysis.details,
                timestamp: new Date().toISOString()
            }
        };
    }

    /**
     * Record a trade outcome for tracking daily stats
     * @param {Object} tradeResult - Result of the trade
     */
    recordTradeOutcome(tradeResult) {
        const entryDate = new Date(tradeResult.timestamp).toDateString();
        const today = new Date().toDateString();

        // Only count towards today's stats if the trade was opened today
        if (entryDate === today) {
            const { pnl } = tradeResult;

            if (pnl < 0) {
                this.dailyLossCount++;
            }

            this.dailyTradeTaken = true;
            this._saveState();

            // Check if we hit the circuit breaker after this trade
            if (this.dailyLossCount >= 2) {
                this.circuitBreakerActive = true;
            }
        } else {
            console.log(`[DecisionEngine] Trade ID ${tradeResult.id} entered on ${entryDate} (not today: ${today}). Skipping daily session lock update.`);
        }
    }

    /**
     * Load persistent state (simplified - in real app would use database)
     */
    _loadState() {
        try {
            // In a real implementation, this would load from database or file
            // For now, we'll just use default values
            const state = null; // localStorage is client-side only
            if (state) {
                const parsed = JSON.parse(state);
                this.dailyTradeTaken = parsed.dailyTradeTaken || false;
                this.dailyLossCount = parsed.dailyLossCount || 0;
                this.lastTradeDate = parsed.lastTradeDate || null;
                this.circuitBreakerActive = parsed.circuitBreakerActive || false;
            }
        } catch (error) {
            console.error('Error loading state:', error);
        }
    }

    /**
     * Save persistent state (simplified - in real app would use database)
     */
    _saveState() {
        try {
            // In a real implementation, this would save to database or file
            // In Node.js backend, we'd use fs or a database
            const state = {
                dailyTradeTaken: this.dailyTradeTaken,
                dailyLossCount: this.dailyLossCount,
                lastTradeDate: this.lastTradeDate,
                circuitBreakerActive: this.circuitBreakerActive
            };
            // Note: In Node.js backend, we'd use fs or a database
        } catch (error) {
            console.error('Error saving state:', error);
        }
    }
}

module.exports = DecisionEngine;