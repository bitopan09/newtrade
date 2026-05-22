const AnalysisEngine = require('./analysisEngine');

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

        // News filter placeholder (in real implementation, this would check news API)
        const newsFilterPassed = true; // Simplified

        if (!newsFilterPassed) {
            return {
                action: 'SKIP',
                reason: 'News filter blocked trade',
                details: {
                    score: analysis.score,
                    analysis: analysis.details,
                    newsFilterPassed: false
                }
            };
        }

        // Check if score meets minimum threshold (7/10 = A+ trade, matches UnifiedStrategy)
        if (analysis.score < 7) {
            return {
                action: 'SKIP',
                reason: `Confluence score too low: ${analysis.score}/10`,
                details: {
                    score: analysis.score,
                    threshold: 7,
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
            // For now, we'll just use localStorage (client-side only)
            // In backend, we'd use a database or file system
            const state = {
                dailyTradeTaken: this.dailyTradeTaken,
                dailyLossCount: this.dailyLossCount,
                lastTradeDate: this.lastTradeDate,
                circuitBreakerActive: this.circuitBreakerActive
            };
            // Note: localStorage is client-side only, this is just for illustration
            // In Node.js backend, we'd use fs or a database
            // localStorage.setItem('tradingBotState', JSON.stringify(state));
        } catch (error) {
            console.error('Error saving state:', error);
        }
    }
}

module.exports = DecisionEngine;