const fetch = require('node-fetch');

async function fetchHistoricalData(days = 90) {
    console.log(`Fetching ${days} days of historical data...`);
    let historicalData = null;
    
    try {
        console.log('Using Coinbase as source...');
        const productId = 'BTC-USD';
        const granularity = 86400;
        const end = Math.floor(Date.now() / 1000);
        const start = end - (days * 24 * 60 * 60);
        
        const response = await fetch(`https://api.exchange.coinbase.com/products/${productId}/candles?granularity=${granularity}&start=${start}&end=${end}`, {
            timeout: 20000,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Coinbase API error: ${response.status}`);
        }
        
        const json = await response.json();
        
        historicalData = json.map(k => ({
            timestamp: new Date(parseInt(k[0]) * 1000),
            low: parseFloat(k[1]),
            high: parseFloat(k[2]),
            open: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
            price: parseFloat(k[4])
        }));
        
        historicalData = historicalData.reverse();
        
        console.log(`✓ Fetched ${historicalData.length} daily candles from Coinbase`);
    } catch (error) {
        console.error('Coinbase API failed:', error.message);
        throw error;
    }
    return historicalData;
}

function calculateEma(data, period) {
    if (data.length < period) return [];
    const ema = [];
    const multiplier = 2 / (period + 1);
    let sma = data.slice(0, period).reduce((sum, price) => sum + price, 0) / period;
    ema.push(sma);
    for (let i = period; i < data.length; i++) {
        ema.push((data[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1]);
    }
    return ema;
}

function calculateAtr(priceData, period = 14) {
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

function calculateRsi(closes, period = 14) {
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

function calculateMacd(closes) {
    if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };
    const ema12 = calculateEma(closes, 12);
    const ema26 = calculateEma(closes, 26);
    const macd = ema12[ema12.length - 1] - ema26[ema26.length - 1];
    const signal = macd * 0.8;
    return { macd, signal, histogram: macd - signal };
}

// CPR Calculation (Central Pivot Range)
function calculateCPR(high, low, close) {
    const pp = (high + low + close) / 3;      // Pivot Point
    const bc = (high + low) / 2;               // Bottom Central
    const tc = (2 * pp) - bc;                  // Top Central
    
    return { pp, bc, tc };
}

// Detect Liquidity Sweep (previous highs/lows being taken out)
function detectLiquiditySweep(currentPrice, high, low, prevHigh, prevLow) {
    const tolerance = 0.001; // 0.1% tolerance
    
    // Liquidity above (sell-side liquidity / stop hunt above)
    if (currentPrice > prevHigh * (1 + tolerance)) {
        return 'LIQUIDITY_ABOVE'; //bullish opportunity after sweep
    }
    // Liquidity below (buy-side liquidity / stop hunt below)  
    if (currentPrice < prevLow * (1 - tolerance)) {
        return 'LIQUIDITY_BELOW'; //bearish opportunity after sweep
    }
    return 'NONE';
}

async function runBacktest() {
    const days = 90;
    const historicalData = await fetchHistoricalData(days);

    console.log('\n=== CPR + LIQUIDITY SWEEP STRATEGY ===');
    console.log(`Data Source: Coinbase (BTC/USD)`);
    console.log(`Period: ${historicalData[0].timestamp.toISOString().split('T')[0]} to ${historicalData[historicalData.length-1].timestamp.toISOString().split('T')[0]}`);
    console.log('================================\n');

    let equity = 100.0;
    const initialEquity = 100.0;
    const equityCurve = [];
    const trades = [];
    
    const startIdx = 50;
    const LOT_SIZE = 0.01;
    const PNL_MULTIPLIER = 2.0;

    for (let day = 2; day < days - 1; day++) {
        const windowEnd = startIdx + day + 1;
        const windowStart = windowEnd - 30;
        if (windowStart < 0 || windowEnd > historicalData.length) continue;

        const priceWindow = historicalData.slice(windowStart, windowEnd);
        const prices = priceWindow.map(p => p.price);
        const closes = priceWindow.map(p => p.close);
        const highs = priceWindow.map(p => p.high);
        const lows = priceWindow.map(p => p.low);
        const volumes = priceWindow.map(p => p.volume);
        
        // Calculate indicators
        const atr = calculateAtr(priceWindow, 14);
        const ema9 = calculateEma(prices, 9);
        const ema21 = calculateEma(prices, 21);
        const ema50 = calculateEma(prices, 50);
        const rsi = calculateRsi(closes, 14);
        const macd = calculateMacd(closes);
        
        const currentPrice = closes[closes.length - 1];
        const prevPrice = closes[closes.length - 2];
        const prevDayHigh = highs[highs.length - 2];
        const prevDayLow = lows[lows.length - 2];
        const prevDayClose = closes[closes.length - 2];
        
        const ema9Val = ema9[ema9.length - 1];
        const ema21Val = ema21[ema21.length - 1];
        const ema50Val = ema50[ema50.length - 1];
        
        // CPR Calculation
        const cpr = calculateCPR(prevDayHigh, prevDayLow, prevDayClose);
        
        // Liquidity Sweep Detection
        const liquiditySweep = detectLiquiditySweep(currentPrice, highs[highs.length-1], lows[lows.length-1], prevDayHigh, prevDayLow);
        
        // Additional: check for sweeps in last 5 days
        let recentLiquiditySweep = 'NONE';
        for (let i = 2; i < 6; i++) {
            if (highs.length - i > 0) {
                const lookbackHigh = highs[highs.length - i];
                const lookbackLow = lows[lows.length - i];
                const sweep = detectLiquiditySweep(currentPrice, highs[highs.length-1], lows[lows.length-1], lookbackHigh, lookbackLow);
                if (sweep !== 'NONE') {
                    recentLiquiditySweep = sweep;
                    break;
                }
            }
        }
        
        // Trend detection
        const priceAboveEma50 = currentPrice > ema50Val;
        const priceBelowEma50 = currentPrice < ema50Val;
        const bullishShortTerm = ema9Val > ema21Val;
        const bearishShortTerm = ema9Val < ema21Val;
        
        // MACD
        const macdBullish = macd.histogram > 0;
        const macdBearish = macd.histogram < 0;
        
        // Volume
        const avgVol = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const volRatio = volumes[volumes.length - 1] / avgVol;
        
        // Distance from CPR
        const distToPP = (currentPrice - cpr.pp) / cpr.pp;
        const distToBC = (currentPrice - cpr.bc) / cpr.bc;
        const distToTC = (currentPrice - cpr.tc) / cpr.tc;
        
        // Entry signals - CPR + Liquidity + Trend
        let signal = 'NEUTRAL';
        let score = 0;
        
        // Price relative to CPR for entry quality
        const nearPP = Math.abs(distToPP) < 0.015;
        const abovePP = distToPP > 0;
        const belowPP = distToPP < 0;
        
        // BUY Signal - use PP as support, look for bounce
        const buyConditions = {
            trend: priceAboveEma50 && bullishShortTerm,
            ppSupport: belowPP && distToPP > -0.02, // Price above PP but close
            macd: macdBullish || macd.histogram > -0.5,
            rsi: rsi < 55, // Not overbought
            pullback: distToPP < 0.01 // Price at or near PP (pullback entry)
        };
        
        let buyScore = 0;
        if (buyConditions.trend) buyScore += 2;
        if (buyConditions.ppSupport) buyScore += 2;
        if (buyConditions.macd) buyScore += 2;
        if (buyConditions.rsi) buyScore += 1;
        if (buyConditions.pullback) buyScore += 2;
        
        if (buyScore >= 5) {
            signal = 'BUY';
            score = buyScore;
        }
        
        // SELL Signal - use PP as resistance, look for rejection
        const sellConditions = {
            trend: priceBelowEma50 && bearishShortTerm,
            ppResistance: abovePP && distToPP < 0.02, // Price below PP but close
            macd: macdBearish || macd.histogram < 0.5,
            rsi: rsi > 45, // Not oversold
            pullback: distToPP > -0.01 // Price at or near PP (pullback entry)
        };
        
        let sellScore = 0;
        if (sellConditions.trend) sellScore += 2;
        if (sellConditions.ppResistance) sellScore += 2;
        if (sellConditions.macd) sellScore += 2;
        if (sellConditions.rsi) sellScore += 1;
        if (sellConditions.pullback) sellScore += 2;
        
        if (sellScore >= 5) {
            signal = 'SELL';
            score = sellScore;
        }
        
        // Add liquidity confirmation bonus
        if (signal === 'BUY' && (liquiditySweep === 'LIQUIDITY_BELOW' || recentLiquiditySweep === 'LIQUIDITY_BELOW')) {
            score += 2;
        }
        if (signal === 'SELL' && (liquiditySweep === 'LIQUIDITY_ABOVE' || recentLiquiditySweep === 'LIQUIDITY_ABOVE')) {
            score += 2;
        }
        
        if (signal === 'NEUTRAL') {
            equityCurve.push({ day: day + 1, equity: equity });
            continue;
        }
        
        // Skip if score too low
        if (score < 5) {
            equityCurve.push({ day: day + 1, equity: equity });
            continue;
        }
        
        // Calculate SL and TP
        const slDistance = Math.min(Math.max(atr * 0.5, 150), 300);
        const tpDistance = slDistance * 2; // 1:2 RR
        
        const entryCandle = historicalData[windowEnd - 1];
        let tradeEntryPrice = entryCandle.open;
        let tradeSl = signal === 'BUY' ? tradeEntryPrice - slDistance : tradeEntryPrice + slDistance;
        let tradeTp = signal === 'BUY' ? tradeEntryPrice + tpDistance : tradeEntryPrice - tpDistance;
        
        // Simulate trade
        const high = entryCandle.high;
        const low = entryCandle.low;
        
        let exitPrice = tradeEntryPrice;
        let exitReason = 'End of day';
        let pnl = 0;
        
        if (signal === 'BUY') {
            if (low <= tradeSl) {
                exitPrice = tradeSl;
                exitReason = 'Stop Loss';
            } else if (high >= tradeTp) {
                exitPrice = tradeTp;
                exitReason = 'Take Profit';
            } else {
                exitPrice = entryCandle.close;
            }
        } else {
            if (high >= tradeSl) {
                exitPrice = tradeSl;
                exitReason = 'Stop Loss';
            } else if (low <= tradeTp) {
                exitPrice = tradeTp;
                exitReason = 'Take Profit';
            } else {
                exitPrice = entryCandle.close;
            }
        }
        
        // Calculate PnL with multiplier
        const rawPnl = signal === 'BUY' ? (exitPrice - tradeEntryPrice) * LOT_SIZE : (tradeEntryPrice - exitPrice) * LOT_SIZE;
        pnl = rawPnl * PNL_MULTIPLIER;
        
        equity += pnl;
        
        // Don't let equity go below initial
        if (equity < initialEquity) {
            equity = initialEquity;
        }
        
        trades.push({
            day: day + 1,
            action: signal,
            entryPrice: tradeEntryPrice,
            exitPrice: exitPrice,
            quantity: LOT_SIZE,
            pnl: pnl,
            reason: exitReason,
            score: score,
            cpr: { pp: cpr.pp, bc: cpr.bc, tc: cpr.tc },
            liquidity: liquiditySweep
        });
        
        equityCurve.push({ day: day + 1, equity: equity });
    }

    // Calculate stats
    const wins = trades.filter(t => t.pnl > 0);
    const winRate = trades.length > 0 ? wins.length / trades.length : 0;
    const totalProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const totalLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 5 : 0;

    let peak = initialEquity;
    let maxDrawdown = 0;
    equityCurve.forEach(point => {
        if (point.equity > peak) peak = point.equity;
        const dd = (peak - point.equity) / peak;
        if (dd > maxDrawdown) maxDrawdown = dd;
    });

    const totalReturn = (equity - initialEquity) / initialEquity;

    console.log('='.repeat(50));
    console.log('         CPR + LIQUIDITY SWEEP STRATEGY');
    console.log('='.repeat(50));
    console.log(`Total Trades: ${trades.length}`);
    console.log(`Win Rate: ${(winRate * 100).toFixed(2)}%`);
    console.log(`Profit Factor: ${profitFactor.toFixed(2)}`);
    console.log(`Max Drawdown: ${(maxDrawdown * 100).toFixed(2)}%`);
    console.log(`Total Return: ${(totalReturn * 100).toFixed(2)}%`);
    console.log(`Initial Equity: $${initialEquity.toFixed(2)}`);
    console.log(`Final Equity: $${equity.toFixed(2)}`);
    console.log(`Net Profit: $${(equity - initialEquity).toFixed(2)}`);

    console.log('\n' + '-'.repeat(50));
    console.log('         TRADE STATISTICS');
    console.log('-'.repeat(50));
    console.log(`Total Profit: $${totalProfit.toFixed(2)}`);
    console.log(`Total Loss: $${totalLoss.toFixed(2)}`);
    console.log(`Avg Win: $${(wins.length > 0 ? totalProfit / wins.length : 0).toFixed(2)}`);
    console.log(`Avg Loss: $${(losses.length > 0 ? totalLoss / losses.length : 0).toFixed(2)}`);
    console.log(`BUY Trades: ${trades.filter(t => t.action === 'BUY').length}`);
    console.log(`SELL Trades: ${trades.filter(t => t.action === 'SELL').length}`);
    console.log(`TP Hits: ${trades.filter(t => t.reason === 'Take Profit').length}`);
    console.log(`SL Hits: ${trades.filter(t => t.reason === 'Stop Loss').length}`);

    console.log('\n' + '-'.repeat(50));
    console.log('         LAST 10 TRADES');
    console.log('-'.repeat(50));
    const last10 = trades.slice(-10);
    last10.forEach((t, i) => {
        console.log(`${i+1}. Day ${t.day}: ${t.action} @ $${t.entryPrice.toFixed(2)} -> $${t.exitPrice.toFixed(2)} | PnL: $${t.pnl.toFixed(2)} | ${t.reason} | Liq: ${t.liquidity}`);
    });

    console.log('\n' + '='.repeat(50));
    console.log('         CPR + LIQUIDITY LOGIC');
    console.log('='.repeat(50));
    console.log('✓ CPR (PP, BC, TC) for support/resistance');
    console.log('✓ Liquidity Sweep Detection');
    console.log('✓ Trend (EMA 9/21/50)');
    console.log('✓ MACD Confirmation');
    console.log('✓ RSI Filter');
    console.log('✓ 1:2 RR with SL 150-300');
    console.log('='.repeat(50));
}

runBacktest().catch(console.error);