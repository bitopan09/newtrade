/**
 * Analysis Engine - delegates all logic to UnifiedStrategy
 * This is the wrapper used by the live bot's DecisionEngine and TradingBot.
 */
const UnifiedStrategy = require('./unifiedStrategy');

class AnalysisEngine {
    constructor() {
        this.strategy = new UnifiedStrategy();
        const unifiedPreset = String(process.env.STRATEGY_PRESET || 'unified').toLowerCase() === 'unified';
        this.indicators = {
            trendFilter: { enabled: true, timeframe: '4H', emaPeriod: 50 },
            srDetector: { enabled: true, lookbackPeriods: 100 },
            obFvGScanner: { enabled: true, minObSize: 0.01 },
            chochBosDetector: { enabled: true, timeframe: '5M' },
            confluenceScorer: { enabled: true, threshold: unifiedPreset ? 6 : Number(process.env.MIN_CONFLUENCE_SCORE) || 6 },
            riskCalculator: { enabled: true, riskPerTrade: (Number(process.env.RISK_PERCENTAGE) || 1) / 100 }
        };
    }

    /**
     * Analyze market data and generate trading signals
     * Delegates entirely to UnifiedStrategy for identical results everywhere.
     * @param {Array} priceData - Historical price data
     * @returns {Object} Analysis results with signal and score
     */
    analyze(priceData) {
        if (!priceData || priceData.length < 20) {
            return { signal: 'NEUTRAL', score: 0, details: 'Insufficient data' };
        }

        const result = this.strategy.analyze(priceData);

        // Wrap in the format expected by DecisionEngine and TradingBot
        return {
            signal: result.signal,
            score: result.score,
            details: {
                confluenceScorer: result.details.confluenceScorer,
                riskCalculator: result.details.riskCalculator,
                qualityFilters: result.details.qualityFilters || [],
                analysis: {
                    confluenceScorer: result.details.confluenceScorer,
                    riskCalculator: result.details.riskCalculator,
                    qualityFilters: result.details.qualityFilters || []
                },
                timestamp: result.details.timestamp
            }
        };
    }
}

module.exports = AnalysisEngine;
