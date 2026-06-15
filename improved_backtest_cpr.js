/**
 * Unified live/backtest strategy runner.
 *
 * Uses the same TradingBot.runBacktest() engine and strategy defaults that the
 * live bot uses for signal generation.
 */
const dotenv = require('dotenv');
const sqlite3 = require('sqlite3').verbose();
const TradingBot = require('./backend/tradingBot');
const { getUnifiedPresetConfig } = require('./backend/strategyConfig');

dotenv.config();

function getNumberEnv(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function buildBacktestConfig() {
    return getUnifiedPresetConfig({
        BACKTEST_FEE_RATE: getNumberEnv('BACKTEST_FEE_RATE', 0.001),
        BACKTEST_SLIPPAGE_RATE: getNumberEnv('BACKTEST_SLIPPAGE_RATE', 0.0005),
        BACKTEST_SPREAD_RATE: getNumberEnv('BACKTEST_SPREAD_RATE', 0.0002)
    });
}

function formatPct(value) {
    return `${(value * 100).toFixed(2)}%`;
}

function formatMoney(value) {
    return `$${Number(value || 0).toFixed(2)}`;
}

function printResult(result) {
    console.log('\n=== BTC BACKTEST ===');
    console.log(`Mode:          ${result.simulationMode}`);
    console.log(`Engine:        ${result.backtestEngine} (${result.backtestEngineVersion})`);
    console.log(`Data:          ${result.dataSource} | ${result.candlesUsed} candles`);
    console.log(`Trades:        ${result.totalTrades}`);
    console.log(`Win Rate:      ${formatPct(result.winRate)}`);
    console.log(`Profit Factor: ${Number(result.profitFactor || 0).toFixed(2)}`);
    console.log(`Max Drawdown:  ${formatPct(result.maxDrawdown)}`);
    console.log(`Total Return:  ${formatPct(result.totalReturn)}`);
    console.log(`Final Equity:  ${formatMoney(result.finalEquity)}`);
    console.log(`Expectancy:    ${formatMoney(result.expectancy)}`);
    console.log(`Average R:     ${Number(result.averageRMultiple || 0).toFixed(2)}R`);
    console.log(`Fees:          ${formatMoney(result.totalFees)}`);
    console.log(`Slippage Cost: ${formatMoney(result.totalSlippageCost)}`);
    console.log(`Skipped:       ${result.skippedSignals || 0}`);

    console.log('\nEffective Config:');
    console.log(JSON.stringify(result.effectiveConfig, null, 2));

    if (result.skippedReasons && Object.keys(result.skippedReasons).length > 0) {
        console.log('\nSkipped Reasons:');
        Object.entries(result.skippedReasons).forEach(([reason, count]) => {
            console.log(`- ${reason}: ${count}`);
        });
    }

    if (result.trades && result.trades.length > 0) {
        console.log('\nTrades:');
        result.trades.forEach((trade, index) => {
            const pnl = trade.pnl >= 0 ? `+${formatMoney(trade.pnl)}` : `-${formatMoney(Math.abs(trade.pnl))}`;
            console.log(`${String(index + 1).padStart(2)}. ${trade.action} ${trade.entryTimestamp} -> ${trade.exitTimestamp || '?'} | ${formatMoney(trade.entryPrice)} -> ${formatMoney(trade.exitPrice)} | ${pnl} | ${trade.exitReason}`);
        });
    }
}

async function run() {
    const days = Number.parseInt(process.argv[2] || '90', 10) || 90;
    const db = new sqlite3.Database(':memory:');
    const bot = new TradingBot(db);

    try {
        const result = await bot.runBacktest(days, 'confluence_scoring', buildBacktestConfig());
        printResult(result);
    } finally {
        await new Promise((resolve, reject) => db.close(err => err ? reject(err) : resolve()));
    }
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
