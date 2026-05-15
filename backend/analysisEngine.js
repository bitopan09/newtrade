class AnalysisEngine {
    constructor() {
        this.indicators = {
            trendFilter: { enabled: true, timeframe: '4H', emaPeriod: 50 },
            srDetector: { enabled: true, lookbackPeriods: 100 },
            obFvGScanner: { enabled: true, minObSize: 0.01 },
            chochBosDetector: { enabled: true, timeframe: '5M' },
            confluenceScorer: { enabled: true, threshold: 7 }, // 7/10 for strict A+ quality
            riskCalculator: { enabled: true, riskPerTrade: 0.05 }
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
            riskCalculator: this._calculateRiskParameters(priceData),
            cpr: this._calculateCPR(priceData),
            vwap: this._calculateVWAP(priceData),
            liquiditySweep: this._detectLiquiditySweep(priceData),
            ote: this._checkOTEZone(priceData)
        };

        // Determine overall signal based on confluence score
        const { score, details } = analysis.confluenceScorer;
        let signal = 'NEUTRAL';

        if (score >= 7) {
            // INSTITUTIONAL LOGIC: EMA-9/21 crossover + EMA-50 trend + CPR PP + VWAP
            const prices = priceData.map(p => p.price);
            const ema9 = this._calculateEma(prices, 9);
            const ema21 = this._calculateEma(prices, 21);
            const ema50 = this._calculateEma(prices, 50);
            const ema9Val = ema9[ema9.length - 1];
            const ema21Val = ema21[ema21.length - 1];
            const ema50Val = ema50[ema50.length - 1];
            const currentPrice = priceData[priceData.length - 1].price;
            const cpr = analysis.cpr;

            // BUY: EMA-9 > EMA-21 (short-term momentum) + price > EMA-50 (trend) + price > PP (institutional level)
            const bullish = ema9Val > ema21Val && currentPrice > ema50Val && currentPrice > cpr.pp;
            // SELL: EMA-9 < EMA-21 + price < EMA-50 + price < PP
            const bearish = ema9Val < ema21Val && currentPrice < ema50Val && currentPrice < cpr.pp;

            if (bullish) {
                signal = 'BUY';
            } else if (bearish) {
                signal = 'SELL';
            }
            // If they disagree → NEUTRAL (skip — no edge)
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

    // ========== ORIGINAL INDICATORS (PRESERVED) ==========

    _analyzeTrendFilter(priceData) {
        const ema50 = this._calculateEma(priceData.map(p => p.price), 50);
        const currentPrice = priceData[priceData.length - 1].price;
        const emaValue = ema50[ema50.length - 1];
        const isBullish = currentPrice > emaValue;
        const strength = Math.abs((currentPrice - emaValue) / emaValue) * 100;

        return {
            enabled: this.indicators.trendFilter.enabled,
            signal: isBullish ? 'BULLISH' : 'BEARISH',
            strength: Math.min(strength, 10),
            value: emaValue,
            price: currentPrice
        };
    }

    _analyzeSrDetector(priceData) {
        const recentData = priceData.slice(-50);
        const highs = recentData.map(p => p.high || p.price);
        const lows = recentData.map(p => p.low || p.price);
        const resistance = Math.max(...highs);
        const support = Math.min(...lows);
        const currentPrice = priceData[priceData.length - 1].price;
        const distToResistance = ((resistance - currentPrice) / currentPrice) * 100;
        const distToSupport = ((currentPrice - support) / currentPrice) * 100;

        let signal = 'NEUTRAL';
        let strength = 0;

        if (distToResistance < 1 && distToResistance > 0) {
            signal = 'BEARISH';
            strength = (1 - distToResistance) * 10;
        } else if (distToSupport < 1 && distToSupport > 0) {
            signal = 'BULLISH';
            strength = (1 - distToSupport) * 10;
        }

        return {
            enabled: this.indicators.srDetector.enabled,
            signal, strength: Math.min(strength, 10),
            resistance, support, currentPrice
        };
    }

    _analyzeObFvGScanner(priceData) {
        const recentData = priceData.slice(-20);
        let fvgCount = 0;
        let obCount = 0;

        for (let i = 2; i < recentData.length; i++) {
            const prev = recentData[i - 2];
            const curr = recentData[i - 1];
            const next = recentData[i];
            const prevHigh = prev.high || prev.price;
            const nextLow = next.low || next.price;
            const prevLow = prev.low || prev.price;
            const nextHigh = next.high || next.price;

            if (prevHigh < nextLow) fvgCount++;
            if (prevLow > nextHigh) fvgCount++;

            const bodySize = Math.abs((curr.open || curr.price) - (curr.close || curr.price));
            const candleSize = (curr.high || curr.price) - (curr.low || curr.price);
            if (candleSize > 0 && bodySize / candleSize > 0.6) obCount++;
        }

        const signal = fvgCount > 2 ? (obCount > 1 ? 'BULLISH' : 'BEARISH') : 'NEUTRAL';
        const strength = Math.min((fvgCount + obCount) / 2, 10);

        return {
            enabled: this.indicators.obFvGScanner.enabled,
            signal, strength, fvgCount, obCount
        };
    }

    _analyzeChochBosDetector(priceData) {
        const recentData = priceData.slice(-10);
        let bosCount = 0;
        let chochCount = 0;
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

            if (currHigh > prevHigh && currHigh > nextHigh) swingHighs.push({ price: currHigh, index: i });
            if (currLow < prevLow && currLow < nextLow) swingLows.push({ price: currLow, index: i });
        }

        const currentPrice = priceData[priceData.length - 1].price;
        const recentSwingHigh = swingHighs.length > 0 ? Math.max(...swingHighs.map(s => s.price)) : 0;
        const recentSwingLow = swingLows.length > 0 ? Math.min(...swingLows.map(s => s.price)) : Infinity;

        if (recentSwingHigh > 0 && currentPrice > recentSwingHigh) bosCount++;
        if (recentSwingLow < Infinity && currentPrice < recentSwingLow) bosCount++;

        if (swingHighs.length >= 2 && swingLows.length >= 2) {
            const lastSH = swingHighs[swingHighs.length - 1];
            const prevSH = swingHighs[swingHighs.length - 2];
            const lastSL = swingLows[swingLows.length - 1];
            const prevSL = swingLows[swingLows.length - 2];

            if (lastSH.price > prevSH.price && lastSL.price > prevSL.price) chochCount++;
            if (lastSH.price < prevSH.price && lastSL.price < prevSL.price) chochCount++;
        }

        const signal = bosCount > 0 ? (chochCount > 0 ? 'BULLISH' : 'BEARISH') : 'NEUTRAL';
        const strength = Math.min(bosCount + chochCount, 10);

        return {
            enabled: this.indicators.chochBosDetector.enabled,
            signal, strength, bosCount, chochCount
        };
    }

    // ========== NEW INSTITUTIONAL INDICATORS ==========

    /**
     * CPR Calculation (Central Pivot Range) using previous candle's HLC
     */
    _calculateCPR(priceData) {
        const prevDay = priceData[priceData.length - 2];
        const high = prevDay.high || prevDay.price;
        const low = prevDay.low || prevDay.price;
        const close = prevDay.close || prevDay.price;

        const pp = (high + low + close) / 3;    // Daily Pivot Point
        const bc = (high + low) / 2;            // Bottom Central
        const tc = (2 * pp) - bc;               // Top Central

        // Standard pivot support/resistance levels
        const r1 = (2 * pp) - low;
        const s1 = (2 * pp) - high;
        const r2 = pp + (high - low);
        const s2 = pp - (high - low);

        const currentPrice = priceData[priceData.length - 1].price;
        const distToPP = (currentPrice - pp) / pp;
        const cprWidth = Math.abs(tc - bc) / pp; // Narrow CPR = trending day

        let signal = 'NEUTRAL';
        if (currentPrice > pp && currentPrice > tc) signal = 'BULLISH';
        else if (currentPrice < pp && currentPrice < bc) signal = 'BEARISH';

        return {
            enabled: true, signal, pp, bc, tc, r1, s1, r2, s2,
            distToPP, cprWidth,
            strength: Math.min(Math.abs(1 / (distToPP || 0.01)), 10)
        };
    }

    /**
     * VWAP — Volume Weighted Average Price (institutional benchmark)
     */
    _calculateVWAP(priceData) {
        const lookback = Math.min(priceData.length, 20);
        const recent = priceData.slice(-lookback);

        let cumTypicalPriceVol = 0;
        let cumVolume = 0;
        const vwapValues = [];

        for (let i = 0; i < recent.length; i++) {
            const tp = ((recent[i].high || recent[i].price) + (recent[i].low || recent[i].price) + (recent[i].close || recent[i].price)) / 3;
            const vol = recent[i].volume || 1;
            cumTypicalPriceVol += tp * vol;
            cumVolume += vol;
            vwapValues.push(cumTypicalPriceVol / cumVolume);
        }

        const vwap = vwapValues[vwapValues.length - 1];
        const currentPrice = priceData[priceData.length - 1].price;

        // Calculate standard deviation bands
        let sumSqDiff = 0;
        for (let i = 0; i < recent.length; i++) {
            const tp = ((recent[i].high || recent[i].price) + (recent[i].low || recent[i].price) + (recent[i].close || recent[i].price)) / 3;
            sumSqDiff += Math.pow(tp - vwap, 2);
        }
        const stdDev = Math.sqrt(sumSqDiff / recent.length);

        const signal = currentPrice > vwap ? 'BULLISH' : 'BEARISH';

        return {
            enabled: true, signal, value: vwap,
            upperBand1: vwap + stdDev,
            lowerBand1: vwap - stdDev,
            upperBand2: vwap + (2 * stdDev),
            lowerBand2: vwap - (2 * stdDev),
            stdDev,
            strength: Math.min(Math.abs((currentPrice - vwap) / stdDev) * 3, 10)
        };
    }

    /**
     * Liquidity Sweep + Wyckoff Spring/Upthrust detection
     */
    _detectLiquiditySweep(priceData) {
        const recent = priceData.slice(-10);
        const currentCandle = priceData[priceData.length - 1];
        const currentPrice = currentCandle.price;
        const currentClose = currentCandle.close || currentPrice;
        let sweepType = 'NONE';
        let sweepLevel = null;
        let isWyckoffConfirmed = false;

        for (let i = 0; i < recent.length - 1; i++) {
            const prevHigh = recent[i].high || recent[i].price;
            const prevLow = recent[i].low || recent[i].price;
            const currentHigh = currentCandle.high || currentPrice;
            const currentLow = currentCandle.low || currentPrice;

            // Swept above previous high (took sell-side liquidity)
            if (currentHigh > prevHigh * 1.001 && currentClose < prevHigh) {
                sweepType = 'LIQUIDITY_ABOVE';
                sweepLevel = prevHigh;
                isWyckoffConfirmed = true; // Upthrust: swept and closed back inside
            } else if (currentHigh > prevHigh * 1.001) {
                sweepType = 'LIQUIDITY_ABOVE';
                sweepLevel = prevHigh;
            }

            // Swept below previous low (took buy-side liquidity)
            if (currentLow < prevLow * 0.999 && currentClose > prevLow) {
                sweepType = 'LIQUIDITY_BELOW';
                sweepLevel = prevLow;
                isWyckoffConfirmed = true; // Spring: swept and closed back inside
            } else if (currentLow < prevLow * 0.999) {
                sweepType = 'LIQUIDITY_BELOW';
                sweepLevel = prevLow;
            }
        }

        let signal = 'NEUTRAL';
        if (sweepType === 'LIQUIDITY_BELOW') signal = 'BULLISH'; // Spring → BUY
        if (sweepType === 'LIQUIDITY_ABOVE') signal = 'BEARISH'; // Upthrust → SELL

        return {
            enabled: true, signal, sweepType, sweepLevel,
            isWyckoffConfirmed,
            strength: isWyckoffConfirmed ? 9 : (sweepType !== 'NONE' ? 6 : 0)
        };
    }

    /**
     * OTE Zone — Optimal Trade Entry (Fibonacci 62-79% retracement)
     */
    _checkOTEZone(priceData) {
        const recent = priceData.slice(-20);
        const highs = recent.map(p => p.high || p.price);
        const lows = recent.map(p => p.low || p.price);
        const swingHigh = Math.max(...highs);
        const swingLow = Math.min(...lows);
        const range = swingHigh - swingLow;
        const currentPrice = priceData[priceData.length - 1].price;

        // For bullish OTE: price retraced 62-79% from swing high to swing low
        const fib62 = swingHigh - (range * 0.618);
        const fib79 = swingHigh - (range * 0.786);
        const inBullishOTE = currentPrice >= fib79 && currentPrice <= fib62;

        // For bearish OTE: price retraced 62-79% from swing low to swing high
        const bearFib62 = swingLow + (range * 0.618);
        const bearFib79 = swingLow + (range * 0.786);
        const inBearishOTE = currentPrice >= bearFib62 && currentPrice <= bearFib79;

        let signal = 'NEUTRAL';
        if (inBullishOTE) signal = 'BULLISH';
        if (inBearishOTE) signal = 'BEARISH';

        return {
            enabled: true, signal, inBullishOTE, inBearishOTE,
            fib62, fib79, bearFib62, bearFib79,
            swingHigh, swingLow,
            strength: (inBullishOTE || inBearishOTE) ? 8 : 0
        };
    }

    /**
     * ICT Killzone check — is the candle timestamp in an active institutional window?
     */
    _checkKillzone(timestamp) {
        if (!timestamp) return { inKillzone: true, zone: 'unknown' };
        const date = new Date(timestamp);
        const hour = date.getUTCHours();

        if (hour >= 7 && hour <= 10) return { inKillzone: true, zone: 'London Open' };
        if (hour >= 12 && hour <= 15) return { inKillzone: true, zone: 'NY Open' };
        if (hour >= 15 && hour <= 17) return { inKillzone: true, zone: 'London Close' };
        // For 6h candles, be more lenient — most candles span killzones
        if (hour >= 0 && hour <= 6) return { inKillzone: false, zone: 'Asian' };
        return { inKillzone: true, zone: 'Active Session' };
    }

    // ========== UPGRADED 10-FACTOR CONFLUENCE SCORING ==========

    _calculateConfluenceScore(priceData) {
        const trend = this._analyzeTrendFilter(priceData);
        const sr = this._analyzeSrDetector(priceData);
        const obFvG = this._analyzeObFvGScanner(priceData);
        const chochBos = this._analyzeChochBosDetector(priceData);
        const cpr = this._calculateCPR(priceData);
        const vwap = this._calculateVWAP(priceData);
        const liquidity = this._detectLiquiditySweep(priceData);
        const ote = this._checkOTEZone(priceData);

        let score = 0;
        const details = [];

        // Factor 1: EMA-50 Trend Filter
        if ((trend.signal === 'BULLISH' && priceData[priceData.length - 1].price > priceData[priceData.length - 2].price) ||
            (trend.signal === 'BEARISH' && priceData[priceData.length - 1].price < priceData[priceData.length - 2].price)) {
            score += 1;
            details.push('Trend aligned');
        }

        // Factor 2: S/R Level Proximity
        if (sr.signal !== 'NEUTRAL' && sr.strength > 3) {
            score += 1;
            details.push('Near S/R level');
        }

        // Factor 3: Order Block / FVG
        if (obFvG.signal !== 'NEUTRAL' && obFvG.strength > 2) {
            score += 1;
            details.push('OB/FVG detected');
        }

        // Factor 4: CHoCH / BOS
        if (chochBos.signal !== 'NEUTRAL') {
            score += 1;
            details.push('Structure break');
        }

        // Factor 5: Volume Confirmation
        const recentVolume = priceData.slice(-5).reduce((sum, p) => sum + (p.volume || 1), 0) / 5;
        const prevVolume = priceData.slice(-10, -5).reduce((sum, p) => sum + (p.volume || 1), 0) / 5;
        if (recentVolume > prevVolume * 1.1) {
            score += 1;
            details.push('Volume confirmation');
        }

        // Factor 6: Session / Killzone (use candle timestamp)
        const lastCandle = priceData[priceData.length - 1];
        const killzone = this._checkKillzone(lastCandle.timestamp);
        if (killzone.inKillzone) {
            score += 1;
            details.push(`Killzone: ${killzone.zone}`);
        }

        // Factor 7: CPR PP Alignment
        if (cpr.signal !== 'NEUTRAL' && Math.abs(cpr.distToPP) < 0.03) {
            score += 1;
            details.push('CPR PP aligned');
        }

        // Factor 8: Liquidity Sweep / Wyckoff
        if (liquidity.signal !== 'NEUTRAL') {
            score += 1;
            if (liquidity.isWyckoffConfirmed) details.push('Wyckoff confirmed');
            else details.push('Liquidity sweep');
        }

        // Factor 9: VWAP Alignment
        if (vwap.signal !== 'NEUTRAL' && vwap.strength > 1) {
            score += 1;
            details.push('VWAP aligned');
        }

        // Factor 10: OTE Zone (Fibonacci 62-79%)
        if (ote.signal !== 'NEUTRAL') {
            score += 1;
            details.push('In OTE zone');
        }

        return {
            enabled: this.indicators.confluenceScorer.enabled,
            score: Math.min(score, 10),
            threshold: this.indicators.confluenceScorer.threshold,
            details: details.join(', ')
        };
    }

    // ========== UPGRADED RISK CALCULATOR (Liquidity-Based SL) ==========

    _calculateRiskParameters(priceData) {
        const currentPrice = priceData[priceData.length - 1].price;
        const atr = this._calculateAtr(priceData, 14);
        const liquidity = this._detectLiquiditySweep(priceData);
        const cpr = this._calculateCPR(priceData);

        // Smart SL: priority-based placement
        let slDistanceLong, slDistanceShort;

        if (liquidity.sweepLevel) {
            // Priority 1: Behind swept liquidity level + buffer
            const buffer = atr * 0.2;
            slDistanceLong = Math.abs(currentPrice - liquidity.sweepLevel) + buffer;
            slDistanceShort = slDistanceLong;
        } else if (cpr.bc && cpr.tc) {
            // Priority 2: Behind CPR BC (longs) or TC (shorts)
            slDistanceLong = Math.max(Math.abs(currentPrice - cpr.bc), atr * 1.5);
            slDistanceShort = Math.max(Math.abs(cpr.tc - currentPrice), atr * 1.5);
        } else {
            // Fallback: 1.5x ATR (wider, survives noise)
            slDistanceLong = atr * 1.5;
            slDistanceShort = atr * 1.5;
        }

        // Ensure minimum SL distance to avoid division errors
        slDistanceLong = Math.max(slDistanceLong, atr * 0.5);
        slDistanceShort = Math.max(slDistanceShort, atr * 0.5);

        const tp1Distance = atr * 8.0; // Capturing absolute market extremes
        const tp2Distance = atr * 20.0;

        return {
            enabled: this.indicators.riskCalculator.enabled,
            riskPerTrade: this.indicators.riskCalculator.riskPerTrade,
            stopLoss: {
                long: currentPrice - slDistanceLong,
                short: currentPrice + slDistanceShort
            },
            takeProfit: {
                tp1Long: currentPrice + tp1Distance,
                tp1Short: currentPrice - tp1Distance,
                tp2Long: currentPrice + tp2Distance,
                tp2Short: currentPrice - tp2Distance
            },
            atr,
            slDistanceLong,
            slDistanceShort,
            riskReward: {
                tp1: (tp1Distance / slDistanceLong).toFixed(2),
                tp2: (tp2Distance / slDistanceLong).toFixed(2)
            }
        };
    }

    // ========== UTILITY METHODS (PRESERVED) ==========

    _calculateEma(data, period) {
        if (data.length < period) return data.length > 0 ? [data[data.length - 1]] : [0];
        const ema = [];
        const multiplier = 2 / (period + 1);
        let sma = data.slice(0, period).reduce((sum, price) => sum + price, 0) / period;
        ema.push(sma);
        for (let i = period; i < data.length; i++) {
            ema.push((data[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1]);
        }
        return ema;
    }

    _calculateAtr(priceData, period) {
        if (priceData.length < period + 1) return 0;
        const trueRanges = [];
        for (let i = 1; i < priceData.length; i++) {
            const current = priceData[i];
            const previous = priceData[i - 1];
            const high = current.high || current.price;
            const low = current.low || current.price;
            const prevClose = previous.close || previous.price;
            trueRanges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
        }
        let atr = trueRanges.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;
        for (let i = period; i < trueRanges.length; i++) {
            atr = (atr * (period - 1) + trueRanges[i]) / period;
        }
        return atr;
    }

    /**
     * Calculate RSI (new utility for future use)
     */
    _calculateRSI(closes, period = 14) {
        if (closes.length < period + 1) return 50;
        let gains = 0, losses = 0;
        for (let i = closes.length - period; i < closes.length; i++) {
            const change = closes[i] - closes[i - 1];
            if (change > 0) gains += change;
            else losses += Math.abs(change);
        }
        const avgGain = gains / period;
        const avgLoss = losses / period;
        if (avgLoss === 0) return 100;
        return 100 - (100 / (1 + avgGain / avgLoss));
    }
}

module.exports = AnalysisEngine;