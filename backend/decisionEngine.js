const AnalysisEngine = require('./analysisEngine');
const { UNIFIED_PRESET_CONFIG } = require('./strategyConfig');

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
        this.dailyTradeCount = 0;
        this.dailyLossCount = 0;
        this.lastTradeDate = null;
        this.circuitBreakerActive = false;
        this.maxDailyLosses = this._getNumberEnv('MAX_DAILY_LOSSES', 1);
        this.dailyTradeLimit = this._getNumberEnv('DAILY_TRADE_LIMIT', 1);
        this.minConfluenceScore = this._getNumberEnv('MIN_CONFLUENCE_SCORE', 4);
        this.sessionStartHour = this._getNumberEnv('BOT_START_HOUR', 0);
        this.sessionEndHour = this._getNumberEnv('BOT_END_HOUR', 23);

    }

    _getNumberEnv(name, fallback) {
        const preset = String(process.env.STRATEGY_PRESET || 'unified').toLowerCase();
        if (preset === 'unified') {
            const value = UNIFIED_PRESET_CONFIG[name];
            if (typeof value === 'number') return value;
        }

        const value = Number(process.env[name]);
        return Number.isFinite(value) ? value : fallback;
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
            this.dailyTradeCount = 0;
            this.dailyLossCount = 0;
            this.lastTradeDate = today;
            this.circuitBreakerActive = false;
        }

        // Always perform technical analysis first so the live dashboard has real-time score & indicators
        const analysis = this.analysisEngine.analyze(priceData);

        // Check circuit breaker. Small accounts default to one loss per day.
        if (this.dailyLossCount >= this.maxDailyLosses) {
            this.circuitBreakerActive = true;
            return {
                action: 'SKIP',
                reason: `${this.maxDailyLosses}-loss circuit breaker activated`,
                details: {
                    score: analysis.score,
                    analysis: analysis.details,
                    dailyLossCount: this.dailyLossCount,
                    circuitBreakerActive: true
                }
            };
        }

        // Check daily trade lock.
        if (this.dailyTradeCount >= this.dailyTradeLimit) {
            return {
                action: 'SKIP',
                reason: `Daily trade limit reached (${this.dailyTradeLimit} trade${this.dailyTradeLimit === 1 ? '' : 's'} per session)`,
                details: {
                    score: analysis.score,
                    analysis: analysis.details,
                    dailyTradeTaken: this.dailyTradeTaken,
                    dailyTradeCount: this.dailyTradeCount
                }
            };
        }

        // Check session time gate.
        const now = new Date();
        const hour = now.getUTCHours();
        const minute = now.getUTCMinutes();
        const timeInMinutes = hour * 60 + minute;
        const isSessionOpen = (timeInMinutes >= this.sessionStartHour * 60 && timeInMinutes <= this.sessionEndHour * 60);

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

        // Check if score meets minimum threshold.
        if (analysis.score < this.minConfluenceScore) {
            return {
                action: 'SKIP',
                reason: `Confluence score too low: ${analysis.score}/10`,
                details: {
                    score: analysis.score,
                    threshold: this.minConfluenceScore,
                    analysis: analysis.details
                }
            };
        }

        if (analysis.signal !== 'BUY' && analysis.signal !== 'SELL') {
            const qualityReasons = analysis.details?.qualityFilters || analysis.details?.analysis?.qualityFilters || [];
            return {
                action: 'SKIP',
                reason: qualityReasons.length > 0
                    ? `Quality filter blocked trade: ${qualityReasons.join('; ')}`
                    : 'No executable trade signal after trend filters',
                details: {
                    score: analysis.score,
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

            this.dailyTradeCount = Math.max(this.dailyTradeCount, 1);
            this.dailyTradeTaken = true;

            // Check if we hit the circuit breaker after this trade
            if (this.dailyLossCount >= this.maxDailyLosses) {
                this.circuitBreakerActive = true;
            }
        } else {
            console.log(`[DecisionEngine] Trade ID ${tradeResult.id} entered on ${entryDate} (not today: ${today}). Skipping daily session lock update.`);
        }
    }

    recordTradeEntry() {
        const today = new Date().toDateString();
        if (this.lastTradeDate !== today) {
            this.dailyTradeCount = 0;
            this.dailyLossCount = 0;
            this.lastTradeDate = today;
            this.circuitBreakerActive = false;
        }

        this.dailyTradeCount++;
        this.dailyTradeTaken = this.dailyTradeCount > 0;
    }

}

module.exports = DecisionEngine;
