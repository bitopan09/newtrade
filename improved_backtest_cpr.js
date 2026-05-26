/**
 * STANDALONE BACKTEST — uses the same UnifiedStrategy as the live bot.
 * Results from this script will match the bot's internal runBacktest() exactly.
 */
const fetch = require('node-fetch');
const UnifiedStrategy = require('./backend/unifiedStrategy');

async function fetchHistoricalData() {
    console.log('Fetching 6H candles from Coinbase...');
    const productId = 'BTC-USD';
    const granularity = 21600; // 6h candles (same as live bot)
    const totalLimit = 500;

    let end = Math.floor(Date.now() / 1000);
    let allCandles = [];
    let remaining = totalLimit;

    while (remaining > 0) {
        const chunkLimit = Math.min(remaining, 300);
        const start = end - (chunkLimit * granularity);

        const response = await fetch(
            `https://api.exchange.coinbase.com/products/${productId}/candles?granularity=${granularity}&start=${start}&end=${end}`,
            { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }
        );

        if (!response.ok) throw new Error(`Coinbase API error: ${response.status}`);
        const json = await response.json();
        if (!json || json.length === 0) break;

        allCandles = allCandles.concat(json);
        end = start;
        remaining -= chunkLimit;
        await new Promise(r => setTimeout(r, 200));
    }

    const historicalData = allCandles.map(k => ({
        timestamp: new Date(parseInt(k[0]) * 1000),
        low: parseFloat(k[1]),
        high: parseFloat(k[2]),
        open: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        price: parseFloat(k[4])
    })).reverse();

    console.log(`✓ Fetched ${historicalData.length} 6H candles from Coinbase`);
    return historicalData;
}

async function runBacktest() {
    const historicalData = await fetchHistoricalData();
    const strategy = new UnifiedStrategy();

    console.log('\n=== UNIFIED STRATEGY BACKTEST ===');
    console.log(`Data: Coinbase BTC/USD 6H candles`);
    console.log(`Period: ${historicalData[0].timestamp.toISOString().split('T')[0]} to ${historicalData[historicalData.length - 1].timestamp.toISOString().split('T')[0]}`);
    console.log(`Confluence Threshold: ${strategy.CONFLUENCE_THRESHOLD}/10`);
    console.log(`TP1 RR: 1:${strategy.TP1_RR} | TP2 RR: 1:${strategy.TP2_RR}`);
    console.log('================================\n');

    let equity = 50.0;
    const initialEquity = 50.0;
    const equityCurve = [];
    const trades = [];
    let activeTrade = null;
    let consecutiveLosses = 0;
    let cooldownCandles = 0;

    for (let i = 50; i < historicalData.length; i++) {
        const currentWindow = historicalData.slice(i - 50, i);
        const currentCandle = historicalData[i];

        if (i % 10 === 0) {
            equityCurve.push({ day: equityCurve.length + 1, equity });
        }

        if (cooldownCandles > 0) {
            cooldownCandles--;
            if (!activeTrade) continue;
        }

        // Check active trade exit — identical to tradingBot.js runBacktest
        if (activeTrade) {
            const exitResult = strategy.checkTradeExit(activeTrade, currentCandle);
            if (exitResult.closed) {
                // Apply 0.1% exchange fee on entry and exit
                // const fee = (activeTrade.entryPrice * activeTrade.quantity * 0.001) + (exitResult.exitPrice * activeTrade.quantity * 0.001);
                // exitResult.pnl -= fee;
                
                equity += exitResult.pnl;
                if (equity < initialEquity) equity = initialEquity;

                if (exitResult.pnl < 0) {
                    consecutiveLosses++;
                    if (consecutiveLosses >= 2) { cooldownCandles = 3; consecutiveLosses = 0; }
                } else { consecutiveLosses = 0; }

                activeTrade.pnl = exitResult.pnl;
                activeTrade.exitTimestamp = currentCandle.timestamp;
                activeTrade.exitReason = exitResult.exitReason;
                activeTrade.exitPrice = exitResult.exitPrice;
                activeTrade.status = 'CLOSED';
                trades.push({ ...activeTrade });
                activeTrade = null;
            }
        }

        // New entry with 8:00 AM - 4:00 PM UTC Session Hour Gate
        if (!activeTrade) {
            const hour = currentCandle.timestamp.getUTCHours();
            const minute = currentCandle.timestamp.getUTCMinutes();
            const timeInMinutes = hour * 60 + minute;
            const isSessionOpen = (timeInMinutes >= 8 * 60 && timeInMinutes <= 16 * 60);

            if (isSessionOpen) {
                const analysis = strategy.analyze(currentWindow);

                if (analysis.signal === 'BUY' || analysis.signal === 'SELL') {
                    const rp = analysis.details.riskCalculator;
                    
                    let baseBalance = 50;
                    if (equity >= 100) {
                        while (baseBalance * 2 <= equity) {
                            baseBalance *= 2;
                        }
                    }
                    
                    const riskAmount = baseBalance * 0.10;
                    const sl = analysis.signal === 'BUY' ? rp.stopLoss.long : rp.stopLoss.short;
                    const slDistance = Math.max(Math.abs(currentCandle.open - sl), 0.1);
                    const rawQuantity = riskAmount / slDistance;
                    const quantity = parseFloat(Math.min(0.04, Math.max(0.01, rawQuantity)).toFixed(5)); // Clamp lot to 0.01-0.04
                    activeTrade = {
                        id: trades.length + 1,
                        action: analysis.signal,
                        entryPrice: currentCandle.open,
                        quantity,
                        sl: analysis.signal === 'BUY' ? rp.stopLoss.long : rp.stopLoss.short,
                        originalSl: analysis.signal === 'BUY' ? rp.stopLoss.long : rp.stopLoss.short,
                        tp1: analysis.signal === 'BUY' ? rp.takeProfit.tp1Long : rp.takeProfit.tp1Short,
                        tp2: analysis.signal === 'BUY' ? rp.takeProfit.tp2Long : rp.takeProfit.tp2Short,
                        atr: rp.atr,
                        score: analysis.score,
                        confluence: analysis.details.confluenceScorer?.details || '',
                        timestamp: currentCandle.timestamp,
                        status: 'OPEN'
                    };
                }
            }
        }
    }

    // ==================== RESULTS ====================
    const completedTrades = trades.filter(t => t.status === 'CLOSED');
    const wins = completedTrades.filter(t => t.pnl > 0);
    const losses = completedTrades.filter(t => t.pnl <= 0);
    const winRate = completedTrades.length > 0 ? wins.length / completedTrades.length : 0;
    const totalProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const totalLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 5 : 0;

    let peak = initialEquity, maxDrawdown = 0;
    equityCurve.forEach(p => {
        if (p.equity > peak) peak = p.equity;
        const dd = (peak - p.equity) / peak;
        if (dd > maxDrawdown) maxDrawdown = dd;
    });

    const totalReturn = (equity - initialEquity) / initialEquity;

    console.log('='.repeat(55));
    console.log('         UNIFIED STRATEGY RESULTS');
    console.log('='.repeat(55));
    console.log(`Total Trades:    ${completedTrades.length}`);
    console.log(`Win Rate:        ${(winRate * 100).toFixed(2)}%`);
    console.log(`Profit Factor:   ${profitFactor.toFixed(2)}`);
    console.log(`Max Drawdown:    ${(maxDrawdown * 100).toFixed(2)}%`);
    console.log(`Total Return:    ${(totalReturn * 100).toFixed(2)}%`);
    console.log(`Initial Equity:  $${initialEquity.toFixed(2)}`);
    console.log(`Final Equity:    $${equity.toFixed(2)}`);
    console.log(`Net Profit:      $${(equity - initialEquity).toFixed(2)}`);

    console.log('\n' + '-'.repeat(55));
    console.log('         TRADE STATISTICS');
    console.log('-'.repeat(55));
    console.log(`Total Profit:  $${totalProfit.toFixed(2)}`);
    console.log(`Total Loss:    $${totalLoss.toFixed(2)}`);
    console.log(`Avg Win:       $${(wins.length > 0 ? totalProfit / wins.length : 0).toFixed(2)}`);
    console.log(`Avg Loss:      $${(losses.length > 0 ? totalLoss / losses.length : 0).toFixed(2)}`);
    console.log(`BUY Trades:    ${completedTrades.filter(t => t.action === 'BUY').length}`);
    console.log(`SELL Trades:   ${completedTrades.filter(t => t.action === 'SELL').length}`);
    console.log(`TP Hits:       ${completedTrades.filter(t => t.exitReason === 'Take Profit').length}`);
    console.log(`SL Hits:       ${completedTrades.filter(t => t.exitReason === 'Stop Loss').length}`);
    console.log(`Trail SL:      ${completedTrades.filter(t => t.exitReason.includes('Trailing')).length}`);

    console.log('\n' + '-'.repeat(55));
    console.log('         LAST 10 TRADES');
    console.log('-'.repeat(55));
    completedTrades.slice(-10).forEach((t, i) => {
        const date = t.timestamp.toISOString().split('T')[0];
        console.log(`${i + 1}. ${date} ${t.action} @ $${t.entryPrice.toFixed(2)} -> $${t.exitPrice.toFixed(2)} | PnL: $${t.pnl.toFixed(2)} | ${t.exitReason} | Score: ${t.score}`);
    });

    console.log('\n' + '='.repeat(55));
    console.log('         UNIFIED STRATEGY COMPONENTS');
    console.log('='.repeat(55));
    console.log('✓ 10-Factor Confluence Scoring (7/10 threshold)');
    console.log('✓ EMA 9/21/50 Trend + Momentum');
    console.log('✓ RSI Filter (40-65 buy / 35-60 sell)');
    console.log('✓ MACD Histogram Confirmation');
    console.log('✓ CPR (PP, BC, TC) Pivot Levels');
    console.log('✓ VWAP Institutional Alignment');
    console.log('✓ Liquidity Sweep + Wyckoff Detection');
    console.log('✓ OTE Zone (Fib 62-79%)');
    console.log('✓ Order Block / FVG + CHoCH/BOS');
    console.log('✓ Smart SL (Liquidity > CPR > ATR fallback)');
    console.log(`✓ TP: 1:${strategy.TP1_RR} RR (TP1) / 1:${strategy.TP2_RR} RR (TP2)`);
    console.log('✓ Progressive Trailing Stop Loss');
    console.log('✓ 2-Loss Cooldown (3-candle pause)');
    console.log('✓ Equity Floor Protection');
    console.log('✓ Session Time Gate (8:00 AM - 4:00 PM UTC)');
    console.log('=======================================================');
}

runBacktest().catch(console.error);