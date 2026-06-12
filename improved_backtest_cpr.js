/**
 * STANDALONE BACKTEST v2 — uses the improved UnifiedStrategy.
 * Fixes:
 * - Removed equity floor (no more survivorship bias)
 * - Added news day filter (skips known high-impact event dates)
 * - Shows honest drawdown and real equity curve
 */
const fetch = require('node-fetch');
const UnifiedStrategy = require('./backend/unifiedStrategy');

// Known high-impact news dates (FOMC, CPI, NFP, etc.) in 2026
// In production, this would be fetched from an API
const HIGH_IMPACT_NEWS_DATES = new Set([
    // FOMC Meetings 2026 (2-day meetings, trade-skip on decision day)
    '2026-01-29', '2026-03-19', '2026-05-07', '2026-06-18',
    '2026-07-30', '2026-09-17', '2026-11-05', '2026-12-17',
    // CPI Release Dates 2026 (typically 2nd or 3rd week)
    '2026-01-14', '2026-02-12', '2026-03-12', '2026-04-14',
    '2026-05-13', '2026-06-11', '2026-07-15', '2026-08-12',
    '2026-09-15', '2026-10-14', '2026-11-12', '2026-12-10',
    // NFP (Non-Farm Payrolls) — first Friday of each month
    '2026-01-09', '2026-02-06', '2026-03-06', '2026-04-03',
    '2026-05-01', '2026-06-05', '2026-07-02', '2026-08-07',
    '2026-09-04', '2026-10-02', '2026-11-06', '2026-12-04',
    // Major crypto-specific events
    '2026-04-15', // Tax deadline
]);

function isNewsDay(timestamp) {
    const dateStr = timestamp.toISOString().split('T')[0];
    return HIGH_IMPACT_NEWS_DATES.has(dateStr);
}

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

    console.log('\n=== IMPROVED STRATEGY BACKTEST (v2) ===');
    console.log(`Data: Coinbase BTC/USD 6H candles`);
    console.log(`Period: ${historicalData[0].timestamp.toISOString().split('T')[0]} to ${historicalData[historicalData.length - 1].timestamp.toISOString().split('T')[0]}`);
    console.log(`Confluence Threshold: ${strategy.CONFLUENCE_THRESHOLD}/10 (direction-aware)`);
    console.log(`TP1 RR: 1:${strategy.TP1_RR} | TP2 RR: 1:${strategy.TP2_RR}`);
    console.log('========================================\n');

    let equity = 50.0;
    const initialEquity = 50.0;
    const equityCurve = [];
    const trades = [];
    let activeTrade = null;
    let consecutiveLosses = 0;
    let cooldownCandles = 0;
    let newsSkipCount = 0;
    let minEquity = initialEquity;

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

        // Check active trade exit
        if (activeTrade) {
            const exitResult = strategy.checkTradeExit(activeTrade, currentCandle);
            if (exitResult.closed) {
                equity += exitResult.pnl;
                if (equity < minEquity) minEquity = equity;

                if (exitResult.pnl < 0) {
                    consecutiveLosses++;
                    if (consecutiveLosses >= 2) { cooldownCandles = 3; consecutiveLosses = 0; }
                } else {
                    consecutiveLosses = 0;
                    // v4: After profitable exit — NO cooldown, allow immediate trend continuation
                    cooldownCandles = 0;
                }

                activeTrade.pnl = exitResult.pnl;
                activeTrade.exitTimestamp = currentCandle.timestamp;
                activeTrade.exitReason = exitResult.exitReason;
                activeTrade.exitPrice = exitResult.exitPrice;
                activeTrade.status = 'CLOSED';
                activeTrade.equityAfter = equity;
                trades.push({ ...activeTrade });
                activeTrade = null;
            }
        }

        // New entry with session gate + news filter
        if (!activeTrade) {
            const hour = currentCandle.timestamp.getUTCHours();
            const minute = currentCandle.timestamp.getUTCMinutes();
            const timeInMinutes = hour * 60 + minute;
            // v4: Widened session window 6AM-6PM UTC for more opportunities
            const isSessionOpen = (timeInMinutes >= 6 * 60 && timeInMinutes <= 18 * 60);

            if (isNewsDay(currentCandle.timestamp)) {
                newsSkipCount++;
                continue;
            }

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
                    
                    const riskAmount = baseBalance * 0.07;
                    const sl = analysis.signal === 'BUY' ? rp.stopLoss.long : rp.stopLoss.short;
                    const slDistance = Math.max(Math.abs(currentCandle.open - sl), 0.1);
                    const rawQuantity = riskAmount / slDistance;
                    const quantity = parseFloat(Math.min(0.04, Math.max(0.01, rawQuantity)).toFixed(5));
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
                        bullScore: analysis.details.confluenceScorer?.bullScore || 0,
                        bearScore: analysis.details.confluenceScorer?.bearScore || 0,
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
    
    // Calculate max consecutive losses
    let maxConsecLoss = 0, currentConsecLoss = 0;
    completedTrades.forEach(t => {
        if (t.pnl <= 0) { currentConsecLoss++; maxConsecLoss = Math.max(maxConsecLoss, currentConsecLoss); }
        else { currentConsecLoss = 0; }
    });

    console.log('='.repeat(55));
    console.log('     IMPROVED STRATEGY v2 RESULTS (HONEST)');
    console.log('='.repeat(55));
    console.log(`Total Trades:        ${completedTrades.length}`);
    console.log(`Win Rate:            ${(winRate * 100).toFixed(2)}%`);
    console.log(`Profit Factor:       ${profitFactor.toFixed(2)}`);
    console.log(`Max Drawdown:        ${(maxDrawdown * 100).toFixed(2)}%`);
    console.log(`Max Consec. Losses:  ${maxConsecLoss}`);
    console.log(`Total Return:        ${(totalReturn * 100).toFixed(2)}%`);
    console.log(`Initial Equity:      $${initialEquity.toFixed(2)}`);
    console.log(`Final Equity:        $${equity.toFixed(2)}`);
    console.log(`Min Equity:          $${minEquity.toFixed(2)}`);
    console.log(`Net Profit:          $${(equity - initialEquity).toFixed(2)}`);
    console.log(`News Days Skipped:   ${newsSkipCount} candles`);

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
    console.log('         ALL TRADES');
    console.log('-'.repeat(55));
    completedTrades.forEach((t, i) => {
        const date = t.timestamp.toISOString().split('T')[0];
        const exitDate = t.exitTimestamp ? t.exitTimestamp.toISOString().split('T')[0] : '?';
        const pnlStr = t.pnl >= 0 ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`;
        console.log(`${String(i + 1).padStart(2)}. ${date}→${exitDate} ${t.action.padEnd(4)} @ $${t.entryPrice.toFixed(0)} → $${t.exitPrice.toFixed(0)} | ${pnlStr.padStart(8)} | ${t.exitReason.padEnd(20)} | Score: ${t.score} (B:${t.bullScore} S:${t.bearScore}) | ${t.confluence}`);
    });

    console.log('\n' + '='.repeat(55));
    console.log('     v2 IMPROVEMENTS APPLIED');
    console.log('='.repeat(55));
    console.log('✓ Direction-aware confluence scoring (bull/bear separated)');
    console.log('✓ MACD: requires crossover or growing momentum (no free pts)');
    console.log('✓ VWAP: requires <0.5% proximity (no free pts)');
    console.log('✓ RSI: validates momentum direction (rising/falling)');
    console.log('✓ Structure Break: direction-aware BOS/CHoCH');
    console.log('✓ OB/FVG: tracks bullish vs bearish separately');
    console.log('✓ News day filter (FOMC, CPI, NFP dates skipped)');
    console.log('✓ NO equity floor (honest drawdown tracking)');
    console.log(`✓ TP adjusted to 1:${strategy.TP1_RR} (more realistic)`)
    console.log('='.repeat(55));
}

runBacktest().catch(console.error);