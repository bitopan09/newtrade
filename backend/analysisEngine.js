class AnalysisEngine {
    constructor() {
        // In a real implementation, these would be loaded from config or calculated dynamically
        this.indicators = {
            trendFilter: { enabled: true, timeframe: '4H', emaPeriod: 50 },
            srDetector: { enabled: true, lookbackPeriods: 100 },
            obFvGScanner: { enabled: true, minObSize: 0.01 },
            chochBosDetector: { enabled: true, timeframe: '5M' },
            confluenceScorer: { enabled: true, threshold: 4 },
            riskCalculator: { enabled: true, riskPerTrade: 0.05 } // 5% risk per trade
        };
    }

    /**
     * Analyze market data and generate trading signals
     * @param {Array} priceData - Historical price data
     * @returns {Object} Analysis results with signal and score
     */
    analyze(priceData) {
        if (!priceData || priceData.length < 20) {
            return { signal: 'NEUTRAL', score: 0, details: 'Insufficient data' };
        }

        const analysis = {
            trendFilter: this._analyzeTrendFilter(priceData),
            srDetector: this._analyzeSrDetector(priceData),
            obFvGScanner: this._analyzeObFvGScanner(priceData),
            chochBosDetector: this._analyzeChochBosDetector(priceData),
            confluenceScorer: this._calculateConfluenceScore(priceData),
            riskCalculator: this._calculateRiskParameters(priceData)
        };

        // Determine overall signal based on confluence score
        const { score, details } = analysis.confluenceScorer;
        let signal = 'NEUTRAL';

        if (score >= 4) {
            // REVERSED LOGIC (Contra-Strategy): 
            // If price action is up, we SELL. If price action is down, we BUY.
            signal = priceData[priceData.length - 1].price > priceData[priceData.length - 20].price ? 'SELL' : 'BUY';
        }

        return {
            signal,
            score,
            details: {
                ...analysis,
                timestamp: new Date().toISOString()
            }
        };
    }

    /**
     * Trend filter using 4H EMA-50 bias
     * @param {Array} priceData - Historical price data
     * @returns {Object} Trend filter analysis
     */
    _analyzeTrendFilter(priceData) {
        // Simplified EMA calculation
        const ema50 = this._calculateEma(priceData.map(p => p.price), 50);
        const currentPrice = priceData[priceData.length - 1].price;
        const emaValue = ema50[ema50.length - 1];

        const isBullish = currentPrice > emaValue;
        const strength = Math.abs((currentPrice - emaValue) / emaValue) * 100;

        return {
            enabled: this.indicators.trendFilter.enabled,
            signal: isBullish ? 'BULLISH' : 'BEARISH',
            strength: Math.min(strength, 10), // Cap at 10 for scoring
            value: emaValue,
            price: currentPrice
        };
    }

    /**
     * Support/Resistance detector using daily highs/lows and weekly open
     * @param {Array} priceData - Historical price data
     * @returns {Object} S/R detector analysis
     */
    _analyzeSrDetector(priceData) {
        // Simplified S/R detection
        const recentData = priceData.slice(-50); // Last 50 periods
        const highs = recentData.map(p => p.high || p.price);
        const lows = recentData.map(p => p.low || p.price);

        const resistance = Math.max(...highs);
        const support = Math.min(...lows);
        const currentPrice = priceData[priceData.length - 1].price;

        // Calculate distance to nearest S/R level
        const distToResistance = ((resistance - currentPrice) / currentPrice) * 100;
        const distToSupport = ((currentPrice - support) / currentPrice) * 100;

        let signal = 'NEUTRAL';
        let strength = 0;

        if (distToResistance < 1 && distToResistance > 0) { // Near resistance
            signal = 'BEARISH';
            strength = (1 - distToResistance) * 10; // Stronger when closer
        } else if (distToSupport < 1 && distToSupport > 0) { // Near support
            signal = 'BULLISH';
            strength = (1 - distToSupport) * 10; // Stronger when closer
        }

        return {
            enabled: this.indicators.srDetector.enabled,
            signal,
            strength: Math.min(strength, 10),
            resistance,
            support,
            currentPrice
        };
    }

    /**
     * Order Blocks and Fair Value Gaps scanner
     * @param {Array} priceData - Historical price data
     * @returns {Object} OB/FVG scanner analysis
     */
    _analyzeObFvGScanner(priceData) {
        // Simplified OB/FVG detection
        const recentData = priceData.slice(-20); // Last 20 periods

        // Look for significant price imbalances (simplified FVG)
        let fvgCount = 0;
        let obCount = 0;

        for (let i = 2; i < recentData.length; i++) {
            const prev = recentData[i - 2];
            const curr = recentData[i - 1];
            const next = recentData[i];

            // Simplified FVG: gap between prev high and next low (or vice versa)
            const prevHigh = prev.high || prev.price;
            const nextLow = next.low || next.price;
            const prevLow = prev.low || prev.price;
            const nextHigh = next.high || next.price;

            // Bullish FVG: prev high < next low
            if (prevHigh < nextLow) {
                fvgCount++;
            }
            // Bearish FVG: prev low > next high
            if (prevLow > nextHigh) {
                fvgCount++;
            }

            // Simplified OB: strong candle with large body
            const bodySize = Math.abs((curr.open || curr.price) - (curr.close || curr.price));
            const candleSize = (curr.high || curr.price) - (curr.low || curr.price);
            if (bodySize / candleSize > 0.6) { // Strong body
                obCount++;
            }
        }

        const signal = fvgCount > 2 ? (obCount > 1 ? 'BULLISH' : 'BEARISH') : 'NEUTRAL';
        const strength = Math.min((fvgCount + obCount) / 2, 10);

        return {
            enabled: this.indicators.obFvGScanner.enabled,
            signal,
            strength,
            fvgCount,
            obCount
        };
    }

    /**
     * Change of Character / Break of Structure detector (5M structure break)
     * @param {Array} priceData - Historical price data
     * @returns {Object} CHoCH/BOS detector analysis
     */
    _analyzeChochBosDetector(priceData) {
        // Simplified CHoCH/BOS detection
        const recentData = priceData.slice(-10); // Last 10 periods

        // Look for breaks of recent swing highs/lows
        let bosCount = 0; // Break of Structure
        let chochCount = 0; // Change of Character

        // Find recent swing points
        const swingHighs = [];
        const swingLows = [];

        for (let i = 2; i < recentData.length - 2; i++) {
            const curr = recentData[i];
            const prev = recentData[i - 1];
            const next = recentData[i + 1];

            const currHigh = curr.high || curr.price;
            const currLow = curr.low || curr.price;
            const prevHigh = prev.high || prev.price;
            const prevLow = prev.low || prev.price;
            const nextHigh = next.high || next.price;
            const nextLow = next.low || next.price;

            // Swing high: higher than neighbors
            if (currHigh > prevHigh && currHigh > nextHigh) {
                swingHighs.push({ price: currHigh, index: i });
            }
            // Swing low: lower than neighbors
            if (currLow < prevLow && currLow < nextLow) {
                swingLows.push({ price: currLow, index: i });
            }
        }

        const currentPrice = priceData[priceData.length - 1].price;

        // Check for BOS (break above recent swing high or below recent swing low)
        const recentSwingHigh = swingHighs.length > 0 ? Math.max(...swingHighs.map(s => s.price)) : 0;
        const recentSwingLow = swingLows.length > 0 ? Math.min(...swingLows.map(s => s.price)) : Infinity;

        if (recentSwingHigh > 0 && currentPrice > recentSwingHigh) {
            bosCount++; // Bullish BOS
        }
        if (recentSwingLow < Infinity && currentPrice < recentSwingLow) {
            bosCount++; // Bearish BOS
        }

        // Simplified CHoCH: change in swing character
        // In reality, this would be more complex
        if (swingHighs.length >= 2 && swingLows >= 2) {
            const lastSwingHigh = swingHighs[swingHighs.length - 1];
            const prevSwingHigh = swingHighs[swingHighs.length - 2];
            const lastSwingLow = swingLows[swingLows.length - 1];
            const prevSwingLow = swingLows[swingLows.length - 2];

            // Higher high and higher low = bullish CHoCH
            if (lastSwingHigh.price > prevSwingHigh.price &&
                lastSwingLow.price > prevSwingLow.price) {
                chochCount++;
            }
            // Lower high and lower low = bearish CHoCH
            if (lastSwingHigh.price < prevSwingHigh.price &&
                lastSwingLow.price < prevSwingLow.price) {
                chochCount++;
            }
        }

        const signal = bosCount > 0 ? (chochCount > 0 ? 'BULLISH' : 'BEARISH') : 'NEUTRAL';
        const strength = Math.min(bosCount + chochCount, 10);

        return {
            enabled: this.indicators.chochBosDetector.enabled,
            signal,
            strength,
            bosCount,
            chochCount
        };
    }

    /**
     * Calculate confluence score from all indicators
     * @param {Array} priceData - Historical price data
     * @returns {Object} Confluence score analysis
     */
    _calculateConfluenceScore(priceData) {
        const trend = this._analyzeTrendFilter(priceData);
        const sr = this._analyzeSrDetector(priceData);
        const obFvG = this._analyzeObFvGScanner(priceData);
        const chochBos = this._analyzeChochBosDetector(priceData);

        let score = 0;
        const details = [];

        // Trend filter: 1 point if aligned with price action
        if ((trend.signal === 'BULLISH' && priceData[priceData.length - 1].price > priceData[priceData.length - 2].price) ||
            (trend.signal === 'BEARISH' && priceData[priceData.length - 1].price < priceData[priceData.length - 2].price)) {
            score += 1;
            details.push('Trend filter aligned');
        }

        // S/R detector: 1 point if near significant level
        if (sr.signal !== 'NEUTRAL' && sr.strength > 5) {
            score += 1;
            details.push('Near S/R level');
        }

        // OB/FVG scanner: 1 point if significant imbalances found
        if (obFvG.signal !== 'NEUTRAL' && obFvG.strength > 3) {
            score += 1;
            details.push('OB/FVG detected');
        }

        // CHoCH/BOS detector: 1 point if structure break
        if (chochBos.signal !== 'NEUTRAL' && chochBos.strength > 3) {
            score += 1;
            details.push('Structure break');
        }

        // Volume confirmation (simplified)
        const recentVolume = priceData.slice(-5).reduce((sum, p) => sum + (p.volume || 1), 0) / 5;
        const prevVolume = priceData.slice(-10, -5).reduce((sum, p) => sum + (p.volume || 1), 0) / 5;
        if (recentVolume > prevVolume * 1.5) {
            score += 1;
            details.push('Volume confirmation');
        }

        // Time of day filter (simplified - assuming London/NY overlap is best)
        const hour = new Date().getUTCHours();
        if ((hour >= 8 && hour <= 11) || (hour >= 13 && hour <= 16)) { // London/NY overlap
            score += 1;
            details.push('Optimal trading session');
        }

        return {
            enabled: this.indicators.confluenceScorer.enabled,
            score: Math.min(score, 6), // Max 6 points
            threshold: this.indicators.confluenceScorer.threshold,
            details: details.join(', ')
        };
    }

    /**
     * Calculate risk parameters for trade
     * @param {Array} priceData - Historical price data
     * @returns {Object} Risk calculation results
     */
    _calculateRiskParameters(priceData) {
        const currentPrice = priceData[priceData.length - 1].price;
        const atr = this._calculateAtr(priceData, 14); // 14-period ATR

        // Risk per trade (2% of account)
        const riskPerTrade = this.indicators.riskCalculator.riskPerTrade;

        // Tighter Stop loss distance (0.7x ATR instead of 1.5x)
        const slDistance = atr * 0.7;

        // Take profit levels (Aggressive targets for $10+ profit)
        const tp1Distance = atr * 2.0; // 1:2 RR
        const tp2Distance = atr * 6.0; // 1:6 RR

        return {
            enabled: this.indicators.riskCalculator.enabled,
            riskPerTrade,
            stopLoss: {
                long: currentPrice - slDistance,
                short: currentPrice + slDistance
            },
            takeProfit: {
                tp1Long: currentPrice + tp1Distance,
                tp1Short: currentPrice - tp1Distance,
                tp2Long: currentPrice + tp2Distance,
                tp2Short: currentPrice - tp2Distance
            },
            atr,
            riskReward: {
                tp1: 1.0,
                tp2: 2.0
            }
        };
    }

    /**
     * Calculate Exponential Moving Average
     * @param {Array} data - Price data array
     * @param {number} period - EMA period
     * @returns {Array} EMA values
     */
    _calculateEma(data, period) {
        if (data.length < period) return [];

        const ema = [];
        const multiplier = 2 / (period + 1);

        // Start with SMA for first EMA value
        let sma = data.slice(0, period).reduce((sum, price) => sum + price, 0) / period;
        ema.push(sma);

        // Calculate EMA for remaining values
        for (let i = period; i < data.length; i++) {
            ema.push((data[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1]);
        }

        return ema;
    }

    /**
     * Calculate Average True Range
     * @param {Array} priceData - Historical price data
     * @param {number} period - ATR period
     * @returns {number} ATR value
     */
    _calculateAtr(priceData, period) {
        if (priceData.length < period + 1) return 0;

        const trueRanges = [];

        for (let i = 1; i < priceData.length; i++) {
            const current = priceData[i];
            const previous = priceData[i - 1];

            const high = current.high || current.price;
            const low = current.low || current.price;
            const prevClose = previous.close || previous.price;

            const tr1 = high - low;
            const tr2 = Math.abs(high - prevClose);
            const tr3 = Math.abs(low - prevClose);

            trueRanges.push(Math.max(tr1, tr2, tr3));
        }

        // Calculate ATR using Wilder's smoothing
        let atr = trueRanges.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;

        for (let i = period; i < trueRanges.length; i++) {
            atr = (atr * (period - 1) + trueRanges[i]) / period;
        }

        return atr;
    }
}

module.exports = AnalysisEngine;