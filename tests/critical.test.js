const assert = require('assert');

const UnifiedStrategy = require('../backend/unifiedStrategy');
const DecisionEngine = require('../backend/decisionEngine');
const TradingBot = require('../backend/tradingBot');
const ExecutionEngine = require('../backend/executionEngine');
const sqlite3 = require('sqlite3').verbose();
const terminalStore = require('../backend/terminalStore');

function makeTradingBotHarness() {
    return Object.create(TradingBot.prototype);
}

function makeExecutionEngineHarness() {
    const engine = Object.create(ExecutionEngine.prototype);
    engine.activeTrades = new Map();
    return engine;
}

function buildCandles(count = 60, options = {}) {
    const {
        start = 50000,
        step = 40,
        range = 180,
        volume = 1000,
        startTime = Date.UTC(2026, 0, 1)
    } = options;

    return Array.from({ length: count }, (_, index) => {
        const base = start + (index * step);
        const open = base - step / 2;
        const close = base + step / 2;
        return {
            timestamp: new Date(startTime + index * 6 * 60 * 60 * 1000),
            open,
            high: Math.max(open, close) + range / 2,
            low: Math.min(open, close) - range / 2,
            close,
            price: close,
            volume: volume + index
        };
    });
}

function testPositionSizingAllowsOnePercentRisk() {
    const bot = makeTradingBotHarness();
    const result = bot._calculatePositionSize({
        equity: 50,
        entryPrice: 50000,
        stopLoss: 49950,
        config: {
            RISK_PERCENTAGE: 1,
            MAX_DOLLAR_RISK: 0.5,
            TRADING_MIN_BTC_QTY: 0.0001,
            TRADING_MAX_BTC_QTY: 0.04,
            MAX_SL_PERCENT_OF_PRICE: 0.02
        }
    });

    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.quantity, 0.01);
    assert.ok(result.actualRisk <= 0.5 * 1.05, `actual risk ${result.actualRisk} exceeded cap`);
}

function testPositionSizingRejectsMinimumLotOverRisk() {
    const bot = makeTradingBotHarness();
    const result = bot._calculatePositionSize({
        equity: 50,
        entryPrice: 50000,
        stopLoss: 40000,
        config: {
            RISK_PERCENTAGE: 1,
            MAX_DOLLAR_RISK: 0.5,
            TRADING_MIN_BTC_QTY: 0.0001,
            TRADING_MAX_BTC_QTY: 0.04,
            MAX_SL_PERCENT_OF_PRICE: 0.5
        }
    });

    assert.strictEqual(result.allowed, false);
    assert.match(result.reason, /minimum lot|Calculated size below minimum/i);
}

function testTieredFivePercentRiskCap() {
    const bot = makeTradingBotHarness();
    const underDouble = bot._calculatePositionSize({
        equity: 99,
        entryPrice: 50000,
        stopLoss: 49750,
        config: {
            RISK_PERCENTAGE: 30,
            MAX_SL_PERCENT_OF_PRICE: 0.02
        }
    });
    const doubled = bot._calculatePositionSize({
        equity: 100,
        entryPrice: 50000,
        stopLoss: 49750,
        config: {
            RISK_PERCENTAGE: 30,
            MAX_SL_PERCENT_OF_PRICE: 0.02
        }
    });

    assert.strictEqual(underDouble.allowed, true);
    assert.strictEqual(underDouble.riskAmount, 2.5);
    assert.strictEqual(underDouble.quantity, 0.01);
    assert.ok(underDouble.actualRisk <= 2.5 * 1.05, `actual risk ${underDouble.actualRisk} exceeded $2.50 cap`);

    assert.strictEqual(doubled.allowed, true);
    assert.strictEqual(doubled.riskAmount, 5);
    assert.strictEqual(doubled.quantity, 0.02);
    assert.ok(doubled.actualRisk <= 5 * 1.05, `actual risk ${doubled.actualRisk} exceeded $5.00 cap`);
}

function testPositionSizingUsesDiscreteLotSteps() {
    const bot = makeTradingBotHarness();
    const result = bot._calculatePositionSize({
        equity: 100,
        entryPrice: 50000,
        stopLoss: 49840,
        config: {
            RISK_PERCENTAGE: 5,
            MAX_SL_PERCENT_OF_PRICE: 0.02
        }
    });

    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.quantity, 0.03);
    assert.ok(result.actualRisk <= result.riskAmount, `actual risk ${result.actualRisk} exceeded cap ${result.riskAmount}`);
}

function testClampLotSizeUsesDiscreteLotSteps() {
    const strategy = new UnifiedStrategy();

    assert.strictEqual(strategy.clampLotSize(0.019), 0.01);
    assert.strictEqual(strategy.clampLotSize(0.031), 0.03);
    assert.strictEqual(strategy.clampLotSize(0.05), 0.04);
}

function testStrategyConfigAndRiskParameters() {
    const strategy = new UnifiedStrategy({
        MIN_CONFLUENCE_SCORE: 7,
        ADX_THRESHOLD: 25,
        ATR_STOP_MULTIPLIER: 1,
        FINAL_TP_RR: 1.8,
        MIN_REWARD_TO_RISK: 1.5,
        MAX_ATR_PERCENT_OF_PRICE: 0.02
    });
    const data = buildCandles();
    const risk = strategy.calculateRiskParameters(data);

    assert.strictEqual(strategy.CONFLUENCE_THRESHOLD, 7);
    assert.strictEqual(strategy.ADX_THRESHOLD, 25);
    assert.strictEqual(risk.riskReward.final, 1.8);
    assert.ok(Number.isFinite(risk.atrPercent));
    assert.ok(risk.atrPercent >= 0);
}

function testSameCandleStopWinsOverTakeProfit() {
    const strategy = new UnifiedStrategy();
    const trade = {
        action: 'BUY',
        entryPrice: 50000,
        quantity: 0.01,
        sl: 49500,
        originalSl: 49500,
        partialTp: 50500,
        finalTp: 51000,
        partialClosed: false,
        atr: 200
    };
    const result = strategy.checkTradeExit(trade, {
        high: 50600,
        low: 49400,
        close: 50000,
        price: 50000
    });

    assert.strictEqual(result.closed, true);
    assert.strictEqual(result.exitPrice, 49500);
    assert.strictEqual(result.exitReason, 'Stop Loss');
}

function testTrailingMovesStopToBreakevenAfterOneR() {
    const strategy = new UnifiedStrategy({ BREAKEVEN_TRIGGER_RR: 1, TRAILING_START_RR: 1 });
    const trade = {
        action: 'BUY',
        entryPrice: 50000,
        quantity: 0.01,
        sl: 49500,
        originalSl: 49500,
        partialTp: 50750,
        finalTp: 51000,
        partialClosed: false,
        atr: 100
    };

    strategy.applyTrailingStop(trade, { high: 50510, low: 50000, close: 50400, price: 50400 });
    assert.ok(trade.sl >= trade.entryPrice, `stop ${trade.sl} did not move to breakeven`);
}

async function testDecisionEngineDailyTradeLimit() {
    const engine = new DecisionEngine();
    engine.dailyTradeLimit = 1;
    engine.lastTradeDate = new Date().toDateString();
    engine.recordTradeEntry();
    engine.analysisEngine = {
        analyze: () => ({
            signal: 'BUY',
            score: 10,
            details: { qualityFilters: [], analysis: {} }
        })
    };

    const decision = await engine.makeDecision(buildCandles());
    assert.strictEqual(decision.action, 'SKIP');
    assert.match(decision.reason, /Daily trade limit reached/);
    assert.strictEqual(engine.dailyTradeCount, 1);
}

async function testExecutionRejectsOutOfRangeLotSize() {
    const engine = makeExecutionEngineHarness();
    const tooSmall = await engine.executeTrade({ action: 'BUY', price: 50000 }, 0.009, 'lot-test');
    const tooLarge = await engine.executeTrade({ action: 'BUY', price: 50000 }, 0.041, 'lot-test');
    const invalidStep = await engine.executeTrade({ action: 'BUY', price: 50000 }, 0.015, 'lot-test');

    assert.strictEqual(tooSmall.success, false);
    assert.match(tooSmall.reason, /between 0.01 and 0.04 BTC/);
    assert.strictEqual(tooLarge.success, false);
    assert.match(tooLarge.reason, /between 0.01 and 0.04 BTC/);
    assert.strictEqual(invalidStep.success, false);
    assert.match(invalidStep.reason, /0.01, 0.02, 0.03, or 0.04 BTC/);
}

async function makeTerminalTestDb() {
    const db = new sqlite3.Database(':memory:');
    await terminalStore.dbRun(db, `CREATE TABLE balance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT DEFAULT 'default',
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        usd_balance REAL,
        btc_balance REAL
    )`);
    await terminalStore.createTerminalTables(db);
    return db;
}

async function closeDb(db) {
    await new Promise((resolve, reject) => db.close(err => err ? reject(err) : resolve()));
}

async function testTerminalArchiveRestoreAndStartingBalance() {
    const db = await makeTerminalTestDb();
    try {
        const terminal = await terminalStore.createTerminal(db, { displayName: 'Bitopan' });
        const balance = await terminalStore.dbGet(db, `SELECT * FROM balance WHERE userId = ?`, [terminal.userId]);

        assert.strictEqual(terminal.displayName, 'Bitopan');
        assert.strictEqual(balance.usd_balance, 50);
        assert.strictEqual(balance.btc_balance, 0);

        await terminalStore.archiveTerminal(db, terminal.userId);
        const active = await terminalStore.listTerminals(db, false);
        const all = await terminalStore.listTerminals(db, true);
        assert.strictEqual(active.length, 0);
        assert.strictEqual(all.length, 1);
        assert.strictEqual(all[0].archived, 1);

        await terminalStore.restoreTerminal(db, terminal.userId);
        const restored = await terminalStore.listTerminals(db, false);
        assert.strictEqual(restored.length, 1);
        assert.strictEqual(restored[0].archived, 0);
    } finally {
        await closeDb(db);
    }
}

async function testManualExitRejectsOtherTerminalTrade() {
    const engine = makeExecutionEngineHarness();
    engine.activeTrades.set(1, {
        id: 1,
        userId: 'terminal_a',
        action: 'BUY',
        entry_price: 50000,
        quantity: 0.01,
        status: 'OPEN'
    });

    const result = await engine.manualExitTrade(1, 50100, 'terminal_b');
    assert.strictEqual(result.success, false);
    assert.match(result.reason, /this terminal/);
}

async function run() {
    const tests = [
        testPositionSizingAllowsOnePercentRisk,
        testPositionSizingRejectsMinimumLotOverRisk,
        testTieredFivePercentRiskCap,
        testPositionSizingUsesDiscreteLotSteps,
        testClampLotSizeUsesDiscreteLotSteps,
        testStrategyConfigAndRiskParameters,
        testSameCandleStopWinsOverTakeProfit,
        testTrailingMovesStopToBreakevenAfterOneR,
        testDecisionEngineDailyTradeLimit,
        testExecutionRejectsOutOfRangeLotSize,
        testTerminalArchiveRestoreAndStartingBalance,
        testManualExitRejectsOtherTerminalTrade
    ];

    for (const test of tests) {
        await test();
        console.log(`PASS ${test.name}`);
    }

    console.log(`Critical tests passed: ${tests.length}`);
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
