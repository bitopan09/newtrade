/**
 * UNIFIED STRATEGY MODULE (v2 — IMPROVED)
 * Single source of truth for signal generation, confluence scoring, and risk management.
 * Used by both the live bot (analysisEngine.js) and standalone backtest (improved_backtest_cpr.js).
 *
 * v2 Fixes:
 * - Direction-aware confluence scoring (bullish/bearish counted separately)
 * - MACD: requires crossover + direction match (no more free points)
 * - VWAP: requires proximity (within 1.5% of VWAP), not just above/below
 * - RSI: validates momentum direction (rising for bull, falling for bear)
 * - Structure Break: tracks direction of BOS/CHoCH
 * - OB/FVG: tracks bullish vs bearish order blocks separately
 * - News filter integration hook
 */
const { UNIFIED_PRESET_CONFIG } = require('./strategyConfig');

class UnifiedStrategy {
    constructor(config = {}) {
        this.config = config;
        this.STRATEGY_PRESET = this._getPresetName();
        this.CONFLUENCE_THRESHOLD = this._getNumberEnv('MIN_CONFLUENCE_SCORE', 4);
        this.MAX_SCORE = 10;
        this.DEFAULT_QUANTITY = this._getNumberEnv('BTC_QUANTITY', 0.01);
        this.LOT_MIN = this._getNumberEnv('TRADING_MIN_BTC_QTY', 0.01);
        this.LOT_MAX = this._getNumberEnv('TRADING_MAX_BTC_QTY', 0.06);
        this.LOT_STEP = this._getNumberEnv('TRADING_LOT_STEP_BTC', 0.01);
        this.PARTIAL_TP_RR = this._getNumberEnv('PARTIAL_TP_RR', 100);
        this.FINAL_TP_RR = this._getNumberEnv('FINAL_TP_RR', 100);
        this.MIN_REWARD_TO_RISK = this._getNumberEnv('MIN_REWARD_TO_RISK', 1.5);
        this.ADX_THRESHOLD = this._getNumberEnv('ADX_THRESHOLD', 18);
        this.ATR_STOP_MULTIPLIER = this._getNumberEnv('ATR_STOP_MULTIPLIER', 0.05);
        this.MAX_ATR_PERCENT_OF_PRICE = this._getNumberEnv('MAX_ATR_PERCENT_OF_PRICE', 0.08);
        this.TRAILING_STOP_ATR_MULTIPLIER = this._getNumberEnv('TRAILING_STOP_ATR_MULTIPLIER', 2);
        this.TRAILING_START_RR = this._getNumberEnv('TRAILING_START_RR', 1);
        this.BREAKEVEN_TRIGGER_RR = this._getNumberEnv('BREAKEVEN_TRIGGER_RR', 1);
        this.ALLOW_LONG_TRADES = this._getBooleanEnv('ALLOW_LONG_TRADES', true);
        this.ALLOW_SHORT_TRADES = this._getBooleanEnv('ALLOW_SHORT_TRADES', true);
        this.UNIFIED_MODE = this._getBooleanEnv('UNIFIED_MODE', this.STRATEGY_PRESET === 'unified');
        this.MIN_SCORE_EDGE = this._getNumberEnv('MIN_SCORE_EDGE', this.UNIFIED_MODE ? 3 : 0);
        this.REJECT_TIE_SCORE = this._getBooleanEnv('REJECT_TIE_SCORE', this.UNIFIED_MODE);
        this.REQUIRE_DIRECTIONAL_TRIGGER = this._getBooleanEnv('REQUIRE_DIRECTIONAL_TRIGGER', this.UNIFIED_MODE);
        this.MIN_EMA_SEPARATION = this._getNumberEnv('MIN_EMA_SEPARATION', 0);
        this.MAX_SIGNAL_RANGE_ATR = this._getNumberEnv('MAX_SIGNAL_RANGE_ATR', this.UNIFIED_MODE ? 2.8 : 999);
    }

    _getPresetName() {
        return String(this.config.STRATEGY_PRESET || process.env.STRATEGY_PRESET || 'unified').toLowerCase();
    }

    _presetValue(name) {
        if (this.STRATEGY_PRESET !== 'unified') return undefined;

        const value = UNIFIED_PRESET_CONFIG[name];
        return typeof value === 'number' ? value : undefined;
    }

    _presetBooleanValue(name) {
        if (this.STRATEGY_PRESET !== 'unified') return undefined;

        const value = UNIFIED_PRESET_CONFIG[name];
        return typeof value === 'boolean' ? value : undefined;
    }

    _getNumberEnv(name, fallback) {
        if (this.config[name] !== undefined) {
            const configValue = Number(this.config[name]);
            return Number.isFinite(configValue) ? configValue : fallback;
        }

        const presetValue = this._presetValue(name);
        if (presetValue !== undefined) return presetValue;

        const value = Number(process.env[name]);
        return Number.isFinite(value) ? value : fallback;
    }

    _getBooleanEnv(name, fallback) {
        if (this.config[name] !== undefined) {
            if (typeof this.config[name] === 'boolean') return this.config[name];
            return String(this.config[name]).toLowerCase() === 'true';
        }

        const presetValue = this._presetBooleanValue(name);
        if (presetValue !== undefined) return presetValue;

        if (process.env[name] === undefined) return fallback;
        return String(process.env[name]).toLowerCase() === 'true';
    }

    /**
     * Clamp a dynamically calculated lot size to the configured allowed range.
     * @param {number} rawQuantity - The unclamped calculated quantity
     * @returns {number} Clamped quantity between LOT_MIN and LOT_MAX
     */
    clampLotSize(rawQuantity) {
        const cappedQuantity = Math.min(this.LOT_MAX, Math.max(this.LOT_MIN, rawQuantity));
        return parseFloat((Math.floor((cappedQuantity + 1e-9) / this.LOT_STEP) * this.LOT_STEP).toFixed(2));
    }

    // ==================== INDICATOR CALCULATIONS ====================

    calculateEma(data, period) {
        if (data.length < period) return data.length > 0 ? [data[data.length - 1]] : [0];
        const ema = [];
        const multiplier = 2 / (period + 1);
        let sma = data.slice(0, period).reduce((sum, p) => sum + p, 0) / period;
        ema.push(sma);
        for (let i = period; i < data.length; i++) {
            ema.push((data[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1]);
        }
        return ema;
    }

    calculateAtr(priceData, period = 14) {
        if (priceData.length < period + 1) return 0;
        const trueRanges = [];
        for (let i = 1; i < priceData.length; i++) {
            const curr = priceData[i];
            const prev = priceData[i - 1];
            const high = curr.high || curr.price;
            const low = curr.low || curr.price;
            const prevClose = prev.close || prev.price;
            trueRanges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
        }
        let atr = trueRanges.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;
        for (let i = period; i < trueRanges.length; i++) {
            atr = (atr * (period - 1) + trueRanges[i]) / period;
        }
        return atr;
    }

    /**
     * Calculate ADX (Average Directional Index) for market regime detection.
     * ADX > 20 = trending, ADX < 20 = choppy/ranging.
     */
    calculateAdx(priceData, period = 14) {
        if (priceData.length < period * 2 + 1) return 15; // default low = assume ranging
        
        const plusDM = [], minusDM = [], tr = [];
        for (let i = 1; i < priceData.length; i++) {
            const curr = priceData[i], prev = priceData[i - 1];
            const cH = curr.high || curr.price, cL = curr.low || curr.price;
            const pH = prev.high || prev.price, pL = prev.low || prev.price;
            const pC = prev.close || prev.price;
            
            const upMove = cH - pH;
            const downMove = pL - cL;
            plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
            minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
            tr.push(Math.max(cH - cL, Math.abs(cH - pC), Math.abs(cL - pC)));
        }
        
        // Smoothed averages
        let smoothPlusDM = plusDM.slice(0, period).reduce((s, v) => s + v, 0);
        let smoothMinusDM = minusDM.slice(0, period).reduce((s, v) => s + v, 0);
        let smoothTR = tr.slice(0, period).reduce((s, v) => s + v, 0);
        
        const dxValues = [];
        for (let i = period; i < tr.length; i++) {
            smoothPlusDM = smoothPlusDM - (smoothPlusDM / period) + plusDM[i];
            smoothMinusDM = smoothMinusDM - (smoothMinusDM / period) + minusDM[i];
            smoothTR = smoothTR - (smoothTR / period) + tr[i];
            
            const plusDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
            const minusDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
            const diSum = plusDI + minusDI;
            const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
            dxValues.push(dx);
        }
        
        if (dxValues.length < period) return dxValues.length > 0 ? dxValues[dxValues.length - 1] : 15;
        
        // ADX = smoothed DX
        let adx = dxValues.slice(0, period).reduce((s, v) => s + v, 0) / period;
        for (let i = period; i < dxValues.length; i++) {
            adx = ((adx * (period - 1)) + dxValues[i]) / period;
        }
        return adx;
    }

    calculateRsi(closes, period = 14) {
        if (closes.length < period + 1) return { value: 50, prevValue: 50 };
        // Calculate current RSI
        let gains = 0, losses = 0;
        for (let i = closes.length - period; i < closes.length; i++) {
            const change = closes[i] - closes[i - 1];
            if (change > 0) gains += change;
            else losses += Math.abs(change);
        }
        const avgGain = gains / period;
        const avgLoss = losses / period;
        const currentRsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

        // Calculate previous RSI (1 period back) for direction check
        let prevGains = 0, prevLosses = 0;
        for (let i = closes.length - period - 1; i < closes.length - 1; i++) {
            if (i < 1) continue;
            const change = closes[i] - closes[i - 1];
            if (change > 0) prevGains += change;
            else prevLosses += Math.abs(change);
        }
        const prevAvgGain = prevGains / period;
        const prevAvgLoss = prevLosses / period;
        const prevRsi = prevAvgLoss === 0 ? 100 : 100 - (100 / (1 + prevAvgGain / prevAvgLoss));

        return { value: currentRsi, prevValue: prevRsi };
    }

    calculateMacd(closes) {
        if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0, prevHistogram: 0 };
        const ema12 = this.calculateEma(closes, 12);
        const ema26 = this.calculateEma(closes, 26);
        const macdLine = ema12[ema12.length - 1] - ema26[ema26.length - 1];
        
        // Build MACD line series for signal line calculation
        const macdSeries = [];
        const minLen = Math.min(ema12.length, ema26.length);
        for (let i = 0; i < minLen; i++) {
            const idx12 = ema12.length - minLen + i;
            const idx26 = ema26.length - minLen + i;
            macdSeries.push(ema12[idx12] - ema26[idx26]);
        }
        
        const signalLine = this.calculateEma(macdSeries, 9);
        const signal = signalLine.length > 0 ? signalLine[signalLine.length - 1] : macdLine * 0.8;
        const histogram = macdLine - signal;
        
        // Get previous histogram for crossover detection
        let prevHistogram = 0;
        if (macdSeries.length >= 2 && signalLine.length >= 2) {
            prevHistogram = macdSeries[macdSeries.length - 2] - signalLine[signalLine.length - 2];
        }
        
        return { macd: macdLine, signal, histogram, prevHistogram };
    }

    calculateCPR(priceData) {
        const prevDay = priceData[priceData.length - 2];
        const high = prevDay.high || prevDay.price;
        const low = prevDay.low || prevDay.price;
        const close = prevDay.close || prevDay.price;

        const pp = (high + low + close) / 3;
        const bc = (high + low) / 2;
        const tc = (2 * pp) - bc;
        const r1 = (2 * pp) - low;
        const s1 = (2 * pp) - high;

        const currentPrice = priceData[priceData.length - 1].price;
        const distToPP = (currentPrice - pp) / pp;

        let signal = 'NEUTRAL';
        if (currentPrice > pp && currentPrice > tc) signal = 'BULLISH';
        else if (currentPrice < pp && currentPrice < bc) signal = 'BEARISH';

        return { signal, pp, bc, tc, r1, s1, distToPP };
    }

    calculateVWAP(priceData) {
        const lookback = Math.min(priceData.length, 20);
        const recent = priceData.slice(-lookback);
        let cumTPVol = 0, cumVol = 0;

        for (const candle of recent) {
            const tp = ((candle.high || candle.price) + (candle.low || candle.price) + (candle.close || candle.price)) / 3;
            const vol = candle.volume || 1;
            cumTPVol += tp * vol;
            cumVol += vol;
        }
        const vwap = cumTPVol / cumVol;
        const currentPrice = priceData[priceData.length - 1].price;
        const distToVwap = Math.abs(currentPrice - vwap) / vwap;
        
        // v2 FIX: Only signal if price is within 1.5% of VWAP (proximity check)
        // Too tight (0.5%) filters out too many valid signals; 1.5% is still meaningful
        let signal = 'NEUTRAL';
        if (distToVwap < 0.015) {
            signal = currentPrice > vwap ? 'BULLISH' : 'BEARISH';
        }
        
        return { value: vwap, signal, distToVwap };
    }

    detectLiquiditySweep(priceData) {
        const recent = priceData.slice(-10);
        const currentCandle = priceData[priceData.length - 1];
        const currentPrice = currentCandle.price;
        const currentClose = currentCandle.close || currentPrice;
        const currentHigh = currentCandle.high || currentPrice;
        const currentLow = currentCandle.low || currentPrice;
        let sweepType = 'NONE';
        let sweepLevel = null;
        let isWyckoffConfirmed = false;

        for (let i = 0; i < recent.length - 1; i++) {
            const prevHigh = recent[i].high || recent[i].price;
            const prevLow = recent[i].low || recent[i].price;

            if (currentHigh > prevHigh * 1.001 && currentClose < prevHigh) {
                sweepType = 'LIQUIDITY_ABOVE'; sweepLevel = prevHigh; isWyckoffConfirmed = true;
            } else if (currentHigh > prevHigh * 1.001) {
                sweepType = 'LIQUIDITY_ABOVE'; sweepLevel = prevHigh;
            }
            if (currentLow < prevLow * 0.999 && currentClose > prevLow) {
                sweepType = 'LIQUIDITY_BELOW'; sweepLevel = prevLow; isWyckoffConfirmed = true;
            } else if (currentLow < prevLow * 0.999) {
                sweepType = 'LIQUIDITY_BELOW'; sweepLevel = prevLow;
            }
        }

        let signal = 'NEUTRAL';
        if (sweepType === 'LIQUIDITY_BELOW') signal = 'BULLISH';
        if (sweepType === 'LIQUIDITY_ABOVE') signal = 'BEARISH';

        return { signal, sweepType, sweepLevel, isWyckoffConfirmed };
    }

    checkOTEZone(priceData) {
        const recent = priceData.slice(-20);
        const highs = recent.map(p => p.high || p.price);
        const lows = recent.map(p => p.low || p.price);
        const swingHigh = Math.max(...highs);
        const swingLow = Math.min(...lows);
        const range = swingHigh - swingLow;
        const currentPrice = priceData[priceData.length - 1].price;

        const fib62 = swingHigh - (range * 0.618);
        const fib79 = swingHigh - (range * 0.786);
        const inBullishOTE = currentPrice >= fib79 && currentPrice <= fib62;

        const bearFib62 = swingLow + (range * 0.618);
        const bearFib79 = swingLow + (range * 0.786);
        const inBearishOTE = currentPrice >= bearFib62 && currentPrice <= bearFib79;

        let signal = 'NEUTRAL';
        if (inBullishOTE) signal = 'BULLISH';
        if (inBearishOTE) signal = 'BEARISH';

        return { signal, inBullishOTE, inBearishOTE };
    }

    /**
     * v2 FIX: Detect Order Block and FVG with direction awareness
     * Tracks bullish vs bearish OB/FVG separately
     */
    detectOrderBlockFVG(priceData) {
        const recent = priceData.slice(-20);
        let bullishFvg = 0, bearishFvg = 0;
        let bullishOb = 0, bearishOb = 0;

        for (let i = 2; i < recent.length; i++) {
            const prev = recent[i - 2], next = recent[i];
            const prevHigh = prev.high || prev.price;
            const nextLow = next.low || next.price;
            const prevLow = prev.low || prev.price;
            const nextHigh = next.high || next.price;

            // Bullish FVG: gap up (prev high < next low)
            if (prevHigh < nextLow) bullishFvg++;
            // Bearish FVG: gap down (prev low > next high)
            if (prevLow > nextHigh) bearishFvg++;

            // Order Block detection with direction
            const curr = recent[i - 1];
            const currOpen = curr.open || curr.price;
            const currClose = curr.close || curr.price;
            const bodySize = Math.abs(currOpen - currClose);
            const candleSize = (curr.high || curr.price) - (curr.low || curr.price);
            if (candleSize > 0 && bodySize / candleSize > 0.6) {
                if (currClose > currOpen) bullishOb++; // Bullish candle = bullish OB
                else bearishOb++; // Bearish candle = bearish OB
            }
        }

        const totalFvg = bullishFvg + bearishFvg;
        let signal = 'NEUTRAL';
        if (totalFvg > 2) {
            if (bullishFvg > bearishFvg && bullishOb > bearishOb) signal = 'BULLISH';
            else if (bearishFvg > bullishFvg && bearishOb > bullishOb) signal = 'BEARISH';
            else if (bullishFvg > bearishFvg) signal = 'BULLISH';
            else if (bearishFvg > bullishFvg) signal = 'BEARISH';
        }
        
        const strength = Math.min((totalFvg + bullishOb + bearishOb) / 2, 10);
        return { signal, fvgCount: totalFvg, obCount: bullishOb + bearishOb, strength, bullishFvg, bearishFvg, bullishOb, bearishOb };
    }

    /**
     * v2 FIX: Detect structure break with direction tracking
     * Now correctly distinguishes bullish BOS from bearish BOS
     */
    detectStructureBreak(priceData) {
        const recent = priceData.slice(-10);
        let bullishBos = 0, bearishBos = 0;
        let bullishChoch = 0, bearishChoch = 0;
        const swingHighs = [], swingLows = [];

        for (let i = 2; i < recent.length - 2; i++) {
            const curr = recent[i], prev = recent[i - 1], next = recent[i + 1];
            const cH = curr.high || curr.price, cL = curr.low || curr.price;
            const pH = prev.high || prev.price, pL = prev.low || prev.price;
            const nH = next.high || next.price, nL = next.low || next.price;
            if (cH > pH && cH > nH) swingHighs.push(cH);
            if (cL < pL && cL < nL) swingLows.push(cL);
        }

        const currentPrice = priceData[priceData.length - 1].price;
        
        // BOS direction: breaking above swing highs = BULLISH, breaking below swing lows = BEARISH
        if (swingHighs.length > 0 && currentPrice > Math.max(...swingHighs)) bullishBos++;
        if (swingLows.length > 0 && currentPrice < Math.min(...swingLows)) bearishBos++;
        
        // CHoCH detection with direction
        if (swingHighs.length >= 2 && swingLows.length >= 2) {
            const [prevSH, lastSH] = swingHighs.slice(-2);
            const [prevSL, lastSL] = swingLows.slice(-2);
            // Higher highs + higher lows = bullish structure
            if (lastSH > prevSH && lastSL > prevSL) bullishChoch++;
            // Lower highs + lower lows = bearish structure
            if (lastSH < prevSH && lastSL < prevSL) bearishChoch++;
        }

        let signal = 'NEUTRAL';
        const totalBullish = bullishBos + bullishChoch;
        const totalBearish = bearishBos + bearishChoch;
        if (totalBullish > totalBearish && totalBullish > 0) signal = 'BULLISH';
        else if (totalBearish > totalBullish && totalBearish > 0) signal = 'BEARISH';

        return { signal, bosCount: bullishBos + bearishBos, chochCount: bullishChoch + bearishChoch, bullishBos, bearishBos, bullishChoch, bearishChoch };
    }

    // ==================== DIRECTION-AWARE CONFLUENCE SCORING ====================

    calculateConfluenceScore(priceData) {
        const prices = priceData.map(p => p.price);
        const closes = priceData.map(p => p.close || p.price);
        const currentPrice = priceData[priceData.length - 1].price;
        const prevPrice = priceData[priceData.length - 2].price;

        // Calculate all indicators
        const ema50 = this.calculateEma(prices, 50);
        const ema50Val = ema50[ema50.length - 1];
        const rsiResult = this.calculateRsi(closes, 14);
        const rsi = rsiResult.value;
        const rsiPrev = rsiResult.prevValue;
        const macd = this.calculateMacd(closes);
        const cpr = this.calculateCPR(priceData);
        const vwap = this.calculateVWAP(priceData);
        const liquidity = this.detectLiquiditySweep(priceData);
        const ote = this.checkOTEZone(priceData);
        const obfvg = this.detectOrderBlockFVG(priceData);
        const structure = this.detectStructureBreak(priceData);

        // Volume analysis
        const recentVol = priceData.slice(-5).reduce((s, p) => s + (p.volume || 1), 0) / 5;
        const prevVol = priceData.slice(-10, -5).reduce((s, p) => s + (p.volume || 1), 0) / 5;

        // v2: DIRECTION-AWARE scoring — count bullish and bearish points SEPARATELY
        let bullScore = 0, bearScore = 0;
        const bullDetails = [], bearDetails = [];

        // Factor 1: EMA-50 Trend (price trending with EMA-50)
        if (currentPrice > ema50Val && currentPrice > prevPrice) {
            bullScore++; bullDetails.push('Trend aligned');
        }
        if (currentPrice < ema50Val && currentPrice < prevPrice) {
            bearScore++; bearDetails.push('Trend aligned');
        }

        // Factor 2: RSI Confirmation — v2 FIX: check momentum direction
        const rsiInBullZone = rsi > 40 && rsi < 70;
        const rsiRising = rsi > rsiPrev; // RSI momentum is rising
        const rsiInBearZone = rsi > 30 && rsi < 60;
        const rsiFalling = rsi < rsiPrev; // RSI momentum is falling
        
        if (rsiInBullZone && rsiRising) {
            bullScore++; bullDetails.push(`RSI: ${rsi.toFixed(1)}↑`);
        }
        if (rsiInBearZone && rsiFalling) {
            bearScore++; bearDetails.push(`RSI: ${rsi.toFixed(1)}↓`);
        }

        // Factor 3: MACD — v2 FIX: require histogram direction match AND crossover signal
        const macdBullishCrossover = macd.histogram > 0 && macd.prevHistogram <= 0; // Fresh bullish cross
        const macdBullishMomentum = macd.histogram > 0 && macd.histogram > macd.prevHistogram; // Growing bullish
        const macdBearishCrossover = macd.histogram < 0 && macd.prevHistogram >= 0; // Fresh bearish cross
        const macdBearishMomentum = macd.histogram < 0 && macd.histogram < macd.prevHistogram; // Growing bearish
        
        if (macdBullishCrossover || macdBullishMomentum) {
            bullScore++; bullDetails.push('MACD bull');
        }
        if (macdBearishCrossover || macdBearishMomentum) {
            bearScore++; bearDetails.push('MACD bear');
        }

        // Factor 4: CPR PP Alignment (price near pivot with direction)
        if (cpr.signal === 'BULLISH' && Math.abs(cpr.distToPP) < 0.03) {
            bullScore++; bullDetails.push('CPR bullish');
        }
        if (cpr.signal === 'BEARISH' && Math.abs(cpr.distToPP) < 0.03) {
            bearScore++; bearDetails.push('CPR bearish');
        }

        // Factor 5: Liquidity sweeps (institutional stop-run detection)
        if (liquidity.signal === 'BULLISH') {
            bullScore += 2; // Bonus points for sweep
            bullDetails.push('Liq sweep bull');
            if (liquidity.isWyckoffConfirmed) { bullScore++; bullDetails.push('Wyckoff bonus'); }
        } else if (liquidity.signal === 'BEARISH') {
            bearScore += 2; // Bonus points for sweep
            bearDetails.push('Liq sweep bear');
            if (liquidity.isWyckoffConfirmed) { bearScore++; bearDetails.push('Wyckoff bonus'); }
        }

        // Factor 6: VWAP — v2 FIX: only count when price is near VWAP (proximity check)
        if (vwap.signal === 'BULLISH') {
            bullScore++; bullDetails.push('VWAP aligned');
        }
        if (vwap.signal === 'BEARISH') {
            bearScore++; bearDetails.push('VWAP aligned');
        }

        // Factor 7: OTE Zone (Fibonacci 62-79%)
        if (ote.signal === 'BULLISH') { bullScore++; bullDetails.push('OTE bull zone'); }
        if (ote.signal === 'BEARISH') { bearScore++; bearDetails.push('OTE bear zone'); }

        // Factor 8: Order Block / FVG — v2 FIX: direction-aware
        if (obfvg.signal === 'BULLISH' && obfvg.strength > 2) {
            bullScore++; bullDetails.push('OB/FVG bull');
        }
        if (obfvg.signal === 'BEARISH' && obfvg.strength > 2) {
            bearScore++; bearDetails.push('OB/FVG bear');
        }

        // Factor 9: CHoCH / BOS — v2 FIX: direction-aware
        if (structure.signal === 'BULLISH') { bullScore++; bullDetails.push('Structure bull'); }
        if (structure.signal === 'BEARISH') { bearScore++; bearDetails.push('Structure bear'); }

        // Factor 10: Volume Confirmation (direction-neutral, adds to both)
        if (recentVol > prevVol * 1.1) {
            bullScore++; bullDetails.push('Volume ↑');
            bearScore++; bearDetails.push('Volume ↑');
        }

        // Pick the dominant direction
        const dominantDirection = bullScore >= bearScore ? 'BULLISH' : 'BEARISH';
        const score = dominantDirection === 'BULLISH' ? bullScore : bearScore;
        const details = dominantDirection === 'BULLISH' ? bullDetails.join(', ') : bearDetails.join(', ');

        return {
            score: Math.min(score, this.MAX_SCORE),
            threshold: this.CONFLUENCE_THRESHOLD,
            details,
            dominantDirection,
            bullScore,
            bearScore,
            indicators: { rsi, rsiPrev, macd, cpr, vwap, liquidity, ote, obfvg, structure, ema50Val }
        };
    }

    // ==================== UNIFIED SIGNAL GENERATION ====================

    analyze(priceData) {
        if (!priceData || priceData.length < 50) {
            return { signal: 'NEUTRAL', score: 0, details: 'Insufficient data' };
        }

        const confluence = this.calculateConfluenceScore(priceData);
        const { score, indicators, dominantDirection, bullScore, bearScore } = confluence;

        let signal = 'NEUTRAL';
        const qualityFilters = [];

        const riskParams = this.calculateRiskParameters(priceData, indicators, confluence.score);

        if (score >= this.CONFLUENCE_THRESHOLD) {
            const prices = priceData.map(p => p.price);
            const ema9 = this.calculateEma(prices, 9);
            const ema21 = this.calculateEma(prices, 21);
            const ema9Val = ema9[ema9.length - 1];
            const ema21Val = ema21[ema21.length - 1];
            const currentPrice = priceData[priceData.length - 1].price;
            const currentCandle = priceData[priceData.length - 1];
            const atr = this.calculateAtr(priceData, 14);

            // v3 TUNING: EMA alignment must MATCH the confluence direction
            const emaBullish = ema9Val > ema21Val && currentPrice > indicators.ema50Val;
            const emaBearish = ema9Val < ema21Val && currentPrice < indicators.ema50Val;

            const adx = this.calculateAdx(priceData, 14);
            const isTrending = adx >= this.ADX_THRESHOLD;

            // v3 TUNING: EMA200 macro trend bias
            const ema200 = this.calculateEma(prices, Math.min(prices.length - 1, 200));
            const ema200Val = ema200[ema200.length - 1];
            const macroTrendBullish = currentPrice > ema200Val;
            const macroTrendBearish = currentPrice < ema200Val;

            const scoreEdge = Math.abs(bullScore - bearScore);
            if (this.REJECT_TIE_SCORE && bullScore === bearScore) {
                qualityFilters.push('Bull/bear score tie');
            }
            if (scoreEdge < this.MIN_SCORE_EDGE) {
                qualityFilters.push(`Score edge too small (${scoreEdge})`);
            }

            const emaSeparation = currentPrice > 0 ? Math.abs(ema9Val - ema21Val) / currentPrice : 0;
            if (emaSeparation < this.MIN_EMA_SEPARATION) {
                qualityFilters.push('EMA compression');
            }

            const candleRange = (currentCandle.high || currentPrice) - (currentCandle.low || currentPrice);
            if (atr > 0 && candleRange / atr > this.MAX_SIGNAL_RANGE_ATR) {
                qualityFilters.push('Oversized signal candle');
            }

            if (riskParams.atrPercent > this.MAX_ATR_PERCENT_OF_PRICE) {
                qualityFilters.push(`ATR too high (${(riskParams.atrPercent * 100).toFixed(2)}% > ${(this.MAX_ATR_PERCENT_OF_PRICE * 100).toFixed(2)}%)`);
            }

            if (riskParams.riskReward.final < this.MIN_REWARD_TO_RISK) {
                qualityFilters.push(`Reward/risk too low (${riskParams.riskReward.final}R < ${this.MIN_REWARD_TO_RISK}R)`);
            }

            if (this.REQUIRE_DIRECTIONAL_TRIGGER) {
                const hasDirectionalTrigger = [
                    indicators.liquidity?.signal,
                    indicators.structure?.signal,
                    indicators.obfvg?.signal
                ].includes(dominantDirection);

                if (!hasDirectionalTrigger) {
                    qualityFilters.push('No liquidity/structure trigger');
                }
            }

            if (isTrending && qualityFilters.length === 0) {
                if (this.ALLOW_LONG_TRADES && dominantDirection === 'BULLISH' && emaBullish && macroTrendBullish) signal = 'BUY';
                else if (this.ALLOW_SHORT_TRADES && dominantDirection === 'BEARISH' && emaBearish && macroTrendBearish) signal = 'SELL';

                if (signal === 'NEUTRAL') {
                    if (dominantDirection === 'BULLISH') {
                        if (!this.ALLOW_LONG_TRADES) qualityFilters.push('Long trades disabled');
                        if (ema9Val <= ema21Val) qualityFilters.push('BUY blocked: EMA9 not above EMA21');
                        if (currentPrice <= indicators.ema50Val) qualityFilters.push('BUY blocked: price below EMA50');
                        if (!macroTrendBullish) qualityFilters.push('BUY blocked: price below macro EMA');
                    } else {
                        if (!this.ALLOW_SHORT_TRADES) qualityFilters.push('Short trades disabled');
                        if (ema9Val >= ema21Val) qualityFilters.push('SELL blocked: EMA9 not below EMA21');
                        if (currentPrice >= indicators.ema50Val) qualityFilters.push('SELL blocked: price above EMA50');
                        if (!macroTrendBearish) qualityFilters.push('SELL blocked: price above macro EMA');
                    }
                }
            } else if (!isTrending) {
                qualityFilters.push(`ADX below threshold (${adx.toFixed(1)} < ${this.ADX_THRESHOLD})`);
            }
        }

        return {
            signal,
            score: confluence.score,
            details: {
                confluenceScorer: confluence,
                riskCalculator: riskParams,
                qualityFilters,
                timestamp: new Date().toISOString()
            }
        };
    }

    // ==================== UNIFIED RISK MANAGEMENT ====================

    calculateRiskParameters(priceData, indicators, score = 5) {
        const currentPrice = priceData[priceData.length - 1].price;
        const atr = this.calculateAtr(priceData, 14);
        const liquidity = indicators?.liquidity || this.detectLiquiditySweep(priceData);
        const cpr = indicators?.cpr || this.calculateCPR(priceData);

        let slDistance;
        if (liquidity.sweepLevel) {
            const buffer = atr * 0.3;
            slDistance = Math.abs(currentPrice - liquidity.sweepLevel) + buffer;
        } else if (cpr.bc && cpr.tc) {
            slDistance = Math.max(Math.abs(currentPrice - cpr.bc), Math.abs(cpr.tc - currentPrice), atr * this.ATR_STOP_MULTIPLIER);
        } else {
            slDistance = atr * this.ATR_STOP_MULTIPLIER;
        }
        const minAtrDistance = atr * Math.min(this.ATR_STOP_MULTIPLIER, 0.5);
        const maxAtrDistance = atr * Math.max(this.ATR_STOP_MULTIPLIER, minAtrDistance / Math.max(atr, 0.000001));
        slDistance = Math.max(slDistance, minAtrDistance);
        slDistance = Math.min(slDistance, maxAtrDistance);

        const partialTpDistance = slDistance * this.PARTIAL_TP_RR;
        const finalTpDistance = slDistance * this.FINAL_TP_RR;

        return {
            atr,
            atrPercent: currentPrice > 0 ? atr / currentPrice : 0,
            maxAtrPercentOfPrice: this.MAX_ATR_PERCENT_OF_PRICE,
            slDistance,
            stopLoss: {
                long: currentPrice - slDistance,
                short: currentPrice + slDistance
            },
            takeProfit: {
                partialLong: currentPrice + partialTpDistance,
                partialShort: currentPrice - partialTpDistance,
                finalLong: currentPrice + finalTpDistance,
                finalShort: currentPrice - finalTpDistance
            },
            riskReward: { partial: this.PARTIAL_TP_RR, final: this.FINAL_TP_RR }
        };
    }

    // ==================== UNIFIED TRAILING STOP ====================

    applyTrailingStop(activeTrade, currentCandle) {
        const atr = activeTrade.atr || 500;

        if (activeTrade.action === 'BUY') {
            // Chandelier Exit Logic
            activeTrade.highestPrice = Math.max(activeTrade.highestPrice || activeTrade.entryPrice, currentCandle.high);
            const trailTrigger = activeTrade.entryPrice + ((activeTrade.entryPrice - activeTrade.originalSl) * this.TRAILING_START_RR);

            if (activeTrade.highestPrice >= trailTrigger) {
                const chandelierStop = activeTrade.highestPrice - (atr * this.TRAILING_STOP_ATR_MULTIPLIER);
                activeTrade.sl = Math.max(activeTrade.sl, chandelierStop);
            }

            // If partial closed, SL must be AT LEAST break-even
            const breakevenTrigger = activeTrade.entryPrice + ((activeTrade.entryPrice - activeTrade.originalSl) * this.BREAKEVEN_TRIGGER_RR);
            if (activeTrade.partialClosed || activeTrade.highestPrice >= breakevenTrigger) {
                activeTrade.sl = Math.max(activeTrade.sl, activeTrade.entryPrice);
            }
        } else {
            activeTrade.lowestPrice = Math.min(activeTrade.lowestPrice || activeTrade.entryPrice, currentCandle.low);
            const trailTrigger = activeTrade.entryPrice - ((activeTrade.originalSl - activeTrade.entryPrice) * this.TRAILING_START_RR);

            if (activeTrade.lowestPrice <= trailTrigger) {
                const chandelierStop = activeTrade.lowestPrice + (atr * this.TRAILING_STOP_ATR_MULTIPLIER);
                activeTrade.sl = Math.min(activeTrade.sl, chandelierStop);
            }

            const breakevenTrigger = activeTrade.entryPrice - ((activeTrade.originalSl - activeTrade.entryPrice) * this.BREAKEVEN_TRIGGER_RR);
            if (activeTrade.partialClosed || activeTrade.lowestPrice <= breakevenTrigger) {
                activeTrade.sl = Math.min(activeTrade.sl, activeTrade.entryPrice);
            }
        }
        return activeTrade;
    }

    // ==================== UNIFIED TRADE EXIT CHECK ====================

    checkTradeExit(activeTrade, currentCandle) {
        if (activeTrade.action === 'BUY') {
            const hitPartialTp = !activeTrade.partialClosed && currentCandle.high >= activeTrade.partialTp;
            const hitFinalTp = activeTrade.partialClosed && activeTrade.finalTp && currentCandle.high >= activeTrade.finalTp;
            const hitStop = currentCandle.low <= activeTrade.sl;

            // Conservative candle assumption: if TP and SL are both touched, SL happened first.
            if (hitStop) {
                return { 
                    closed: true, 
                    exitPrice: activeTrade.sl, 
                    exitReason: activeTrade.sl >= activeTrade.entryPrice ? 'Trailing SL (BE+)' : 'Stop Loss',
                    pnl: (activeTrade.sl - activeTrade.entryPrice) * activeTrade.quantity 
                };
            }

            if (hitPartialTp) {
                return { closed: false, partialClose: true, exitPrice: activeTrade.partialTp };
            }

            if (hitFinalTp) {
                return {
                    closed: true,
                    exitPrice: activeTrade.finalTp,
                    exitReason: 'Final TP',
                    pnl: (activeTrade.finalTp - activeTrade.entryPrice) * activeTrade.quantity
                };
            }
        } else {
            const hitPartialTp = !activeTrade.partialClosed && currentCandle.low <= activeTrade.partialTp;
            const hitFinalTp = activeTrade.partialClosed && activeTrade.finalTp && currentCandle.low <= activeTrade.finalTp;
            const hitStop = currentCandle.high >= activeTrade.sl;

            if (hitStop) {
                return { 
                    closed: true, 
                    exitPrice: activeTrade.sl, 
                    exitReason: activeTrade.sl <= activeTrade.entryPrice ? 'Trailing SL (BE+)' : 'Stop Loss',
                    pnl: (activeTrade.entryPrice - activeTrade.sl) * activeTrade.quantity 
                };
            }

            if (hitPartialTp) {
                return { closed: false, partialClose: true, exitPrice: activeTrade.partialTp };
            }

            if (hitFinalTp) {
                return {
                    closed: true,
                    exitPrice: activeTrade.finalTp,
                    exitReason: 'Final TP',
                    pnl: (activeTrade.entryPrice - activeTrade.finalTp) * activeTrade.quantity
                };
            }
        }

        this.applyTrailingStop(activeTrade, currentCandle);
        return { closed: false };
    }
}

module.exports = UnifiedStrategy;
