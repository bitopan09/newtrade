const assert = require('assert');

const UnifiedStrategy = require('../backend/unifiedStrategy');
const DecisionEngine = require('../backend/decisionEngine');
const TradingBot = require('../backend/tradingBot');
const ExecutionEngine = require('../backend/executionEngine');
const sqlite3 = require('sqlite3').verbose();
const terminalStore = require('../backend/terminalStore');
const { UNIFIED_PRESET_CONFIG, getUnifiedPresetConfig } = require('../backend/strategyConfig');

function makeTradingBotHarness() {
    return Object.create(TradingBot.prototype);
}

function makeExecutionEngineHarness() {
    const engine = Object.create(ExecutionEngine.prototype);
    engine.activeTrades = new Map();
    engine.lotMin = 0.01;
    engine.lotMax = 0.06;
    engine.lotStep = 0.01;
    engine.strategy = new UnifiedStrategy();
    engine._sendAlert = () => Promise.resolve();
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
        equity: 100,
        entryPrice: 50000,
        stopLoss: 49950,
        config: {
            RISK_PERCENTAGE: 1,
            MAX_DOLLAR_RISK: 0.5,
            TRADING_MIN_BTC_QTY: 0.01,
            TRADING_MAX_BTC_QTY: 0.08,
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
        equity: 100,
        entryPrice: 50000,
        stopLoss: 40000,
        config: {
            RISK_PERCENTAGE: 1,
            MAX_DOLLAR_RISK: 0.5,
            TRADING_MIN_BTC_QTY: 0.01,
            TRADING_MAX_BTC_QTY: 0.08,
            MAX_SL_PERCENT_OF_PRICE: 0.5
        }
    });

    assert.strictEqual(result.allowed, false);
    assert.match(result.reason, /minimum lot|Calculated size below minimum/i);
}

function testTieredFivePercentRiskCap() {
    const bot = makeTradingBotHarness();
    const underDouble = bot._calculatePositionSize({
        equity: 199,
        entryPrice: 50000,
        stopLoss: 49750,
        config: {
            RISK_PERCENTAGE: 30,
            MAX_SL_PERCENT_OF_PRICE: 0.02
        }
    });
    const doubled = bot._calculatePositionSize({
        equity: 200,
        entryPrice: 50000,
        stopLoss: 49750,
        config: {
            RISK_PERCENTAGE: 30,
            MAX_SL_PERCENT_OF_PRICE: 0.02
        }
    });

    assert.strictEqual(underDouble.allowed, true);
    assert.strictEqual(underDouble.riskAmount, 5);
    assert.strictEqual(underDouble.quantity, 0.02);
    assert.ok(underDouble.actualRisk <= 5 * 1.05, `actual risk ${underDouble.actualRisk} exceeded $5.00 cap`);

    assert.strictEqual(doubled.allowed, true);
    assert.strictEqual(doubled.riskAmount, 10);
    assert.strictEqual(doubled.quantity, 0.04);
    assert.ok(doubled.actualRisk <= 10 * 1.05, `actual risk ${doubled.actualRisk} exceeded $10.00 cap`);
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

function testConfluenceScoreScalesLotSize() {
    const bot = makeTradingBotHarness();
    const base = {
        equity: 100,
        entryPrice: 50000,
        stopLoss: 49750,
        config: {
            RISK_PERCENTAGE: 5,
            MIN_CONFLUENCE_SCORE: 5,
            CONFLUENCE_LOT_SCALING: true,
            CONFLUENCE_LOT_START_SCORE: 8,
            CONFLUENCE_MAX_RISK_PERCENTAGE: 20,
            MAX_SL_PERCENT_OF_PRICE: 0.02
        }
    };

    const thresholdScore = bot._calculatePositionSize({ ...base, score: 5 });
    const strongScore = bot._calculatePositionSize({ ...base, score: 8 });
    const maxScore = bot._calculatePositionSize({ ...base, score: 10 });

    assert.strictEqual(thresholdScore.allowed, true);
    assert.strictEqual(strongScore.allowed, true);
    assert.strictEqual(maxScore.allowed, true);
    assert.strictEqual(thresholdScore.quantity, 0.01);
    assert.ok(strongScore.quantity > thresholdScore.quantity, `expected strong score lot > threshold lot, got ${strongScore.quantity}`);
    assert.strictEqual(maxScore.quantity, 0.08);
    assert.strictEqual(maxScore.confluenceTargetQuantity, 0.08);
    assert.strictEqual(maxScore.confluenceRiskPercentage, 20);
}

function testClampLotSizeUsesDiscreteLotSteps() {
    const strategy = new UnifiedStrategy();

    assert.strictEqual(strategy.clampLotSize(0.019), 0.01);
    assert.strictEqual(strategy.clampLotSize(0.031), 0.03);
    assert.strictEqual(strategy.clampLotSize(0.09), 0.06);
}

function testUnifiedStrategyDefaults() {
    const strategy = new UnifiedStrategy();

    assert.strictEqual(strategy.UNIFIED_MODE, true);
    assert.strictEqual(strategy.CONFLUENCE_THRESHOLD, 6);
    assert.strictEqual(strategy.ADX_THRESHOLD, 33);
    assert.strictEqual(strategy.ATR_STOP_MULTIPLIER, 0.2);
    assert.strictEqual(strategy.MIN_SCORE_EDGE, 3);
    assert.strictEqual(strategy.REQUIRE_DIRECTIONAL_TRIGGER, false);
    assert.strictEqual(strategy.LOT_MIN, 0.01);
    assert.strictEqual(strategy.LOT_MAX, 0.06);
    assert.strictEqual(strategy.LOT_STEP, 0.01);
    assert.strictEqual(strategy.ALLOW_LONG_TRADES, true);
    assert.strictEqual(strategy.ALLOW_SHORT_TRADES, true);
}

function testChampionPresetIsLockedForFiftyDollarBacktest() {
    const preset = getUnifiedPresetConfig();

    assert.deepStrictEqual(preset, UNIFIED_PRESET_CONFIG, 'getUnifiedPresetConfig without overrides should match the locked preset');
    assert.strictEqual(preset.BACKTEST_INITIAL_EQUITY, 50);
    assert.strictEqual(preset.STRATEGY_PRESET, 'unified');
    assert.strictEqual(preset.SIMULATION_MODE, 'unified-live');
    assert.strictEqual(preset.USE_CLOSED_CANDLE_SIGNALS, true);
    assert.strictEqual(preset.MIN_CONFLUENCE_SCORE, 6);
    assert.strictEqual(preset.ADX_THRESHOLD, 33);
    assert.strictEqual(preset.ATR_STOP_MULTIPLIER, 0.2);
    assert.strictEqual(preset.FINAL_TP_RR, 2);
    assert.strictEqual(preset.BREAKEVEN_TRIGGER_RR, 1.5);
    assert.strictEqual(preset.TRAILING_START_RR, 0.6);
    assert.strictEqual(preset.TRAILING_STOP_ATR_MULTIPLIER, 1);
    assert.strictEqual(preset.CONFLUENCE_LOT_SCALING, true);
    assert.strictEqual(preset.CONFLUENCE_LOT_START_SCORE, 7);
    assert.strictEqual(preset.CONFLUENCE_MAX_RISK_PERCENTAGE, 7.5);
    assert.strictEqual(preset.TRADING_MIN_BTC_QTY, 0.01);
    assert.strictEqual(preset.TRADING_MAX_BTC_QTY, 0.06);
    assert.strictEqual(preset.TRADING_LOT_STEP_BTC, 0.01);
    assert.strictEqual(preset.BOT_START_HOUR, 8);
    assert.strictEqual(preset.BOT_END_HOUR, 23);
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
    const tooLarge = await engine.executeTrade({ action: 'BUY', price: 50000 }, 0.061, 'lot-test');
    const invalidStep = await engine.executeTrade({ action: 'BUY', price: 50000 }, 0.015, 'lot-test');

    assert.strictEqual(tooSmall.success, false);
    assert.match(tooSmall.reason, /between 0.01 and 0.06 BTC/);
    assert.strictEqual(tooLarge.success, false);
    assert.match(tooLarge.reason, /between 0.01 and 0.06 BTC/);
    assert.strictEqual(invalidStep.success, false);
    assert.match(invalidStep.reason, /align to 0.01 BTC steps/);
}

function testPartialCloseQuantityUsesTwoDecimalLotSteps() {
    const engine = makeExecutionEngineHarness();

    assert.strictEqual(engine._getPartialCloseQuantity(0.06), 0.03);
    assert.strictEqual(engine._getPartialCloseQuantity(0.03), 0.01);
    assert.strictEqual(engine._getPartialCloseQuantity(0.01), null);
}

function testExecutionMonitorUsesUnifiedStrategyExit() {
    const engine = makeExecutionEngineHarness();
    let receivedTrade = null;
    let receivedCandle = null;
    let closedTrade = null;

    engine.strategy = {
        checkTradeExit: (trade, candle) => {
            receivedTrade = { ...trade };
            receivedCandle = { ...candle };
            return { closed: true, exitPrice: 49500, exitReason: 'Stop Loss' };
        }
    };
    engine._closeTrade = (tradeId, exitPrice, reason) => {
        closedTrade = { tradeId, exitPrice, reason };
        engine.activeTrades.delete(tradeId);
    };

    engine.activeTrades.set(7, {
        id: 7,
        userId: 'default',
        action: 'BUY',
        entry_price: 50000,
        quantity: 0.02,
        status: 'OPEN',
        sl: 49500,
        tp1: 51000,
        tp2: 52000,
        atr: 100,
        partialClosed: false
    });

    engine.monitorTrades(49500);

    assert.strictEqual(receivedTrade.entryPrice, 50000);
    assert.strictEqual(receivedTrade.originalSl, 49500);
    assert.strictEqual(receivedTrade.partialTp, 51000);
    assert.strictEqual(receivedTrade.finalTp, 52000);
    assert.deepStrictEqual(receivedCandle, { high: 49500, low: 49500, close: 49500, price: 49500 });
    assert.deepStrictEqual(closedTrade, { tradeId: 7, exitPrice: 49500, reason: 'Stop Loss' });
}

function testExecutionMonitorHandlesUnifiedPartialClose() {
    const engine = makeExecutionEngineHarness();
    let partialClose = null;

    engine.strategy = {
        checkTradeExit: () => ({ closed: false, partialClose: true, exitPrice: 51000 })
    };
    engine._partialCloseTrade = (tradeId, exitPrice) => {
        partialClose = { tradeId, exitPrice };
        return true;
    };
    engine._closeTrade = () => assert.fail('partial close should not fully close trade');

    engine.activeTrades.set(8, {
        id: 8,
        userId: 'default',
        action: 'BUY',
        entry_price: 50000,
        quantity: 0.06,
        status: 'OPEN',
        sl: 49500,
        tp1: 51000,
        tp2: 52000,
        atr: 100,
        partialClosed: false
    });

    engine.monitorTrades(51000);

    assert.deepStrictEqual(partialClose, { tradeId: 8, exitPrice: 51000 });
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
        const terminal = await terminalStore.createTerminal(db, { displayName: 'Bitopan', pin: '1234', termsAccepted: true });
        const balance = await terminalStore.dbGet(db, `SELECT * FROM balance WHERE userId = ?`, [terminal.userId]);

        assert.strictEqual(terminal.displayName, 'Bitopan');
        assert.strictEqual(terminal.hasPin, true);
        assert.strictEqual(terminal.pinHash, undefined);
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

async function testTerminalPinAccessAndTerms() {
    const db = await makeTerminalTestDb();
    try {
        await assert.rejects(
            () => terminalStore.createTerminal(db, { displayName: 'No Terms', pin: '1234' }),
            /accept the terminal access terms/i
        );

        const terminal = await terminalStore.createTerminal(db, { displayName: 'Protected', pin: '2468', termsAccepted: true });

        await assert.rejects(
            () => terminalStore.authenticateTerminal(db, terminal.userId, '1357'),
            /Incorrect PIN/i
        );

        const session = await terminalStore.authenticateTerminal(db, terminal.userId, '2468');
        assert.strictEqual(session.terminal.userId, terminal.userId);
        assert.ok(session.accessToken.length >= 32);
        assert.strictEqual(await terminalStore.verifyAccessToken(db, terminal.userId, session.accessToken), true);
        assert.strictEqual(await terminalStore.verifyAccessToken(db, terminal.userId, 'bad-token'), false);
    } finally {
        await closeDb(db);
    }
}

async function testUntouchedStartingBalanceSyncOnlyChangesUntradedAccounts() {
    const db = await makeTerminalTestDb();
    try {
        await terminalStore.dbRun(db, `CREATE TABLE trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT DEFAULT 'default'
        )`);
        await terminalStore.dbRun(db, `INSERT INTO balance (userId, usd_balance, btc_balance) VALUES ('legacy_clean', 100, 0)`);
        await terminalStore.dbRun(db, `INSERT INTO balance (userId, usd_balance, btc_balance) VALUES ('legacy_traded', 100, 0)`);
        await terminalStore.dbRun(db, `INSERT INTO trades (userId) VALUES ('legacy_traded')`);

        await terminalStore.syncUntouchedStartingBalancesToDefault(db);

        const clean = await terminalStore.dbGet(db, `SELECT * FROM balance WHERE userId = 'legacy_clean' ORDER BY id DESC LIMIT 1`);
        const traded = await terminalStore.dbGet(db, `SELECT * FROM balance WHERE userId = 'legacy_traded' ORDER BY id DESC LIMIT 1`);

        assert.strictEqual(clean.usd_balance, 50);
        assert.strictEqual(traded.usd_balance, 100);
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

async function testTerminalTradeReadsIncludeGlobalBotTradesOnly() {
    const db = await makeTerminalTestDb();
    try {
        await terminalStore.dbRun(db, `CREATE TABLE trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT DEFAULT 'default',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            action TEXT,
            status TEXT DEFAULT 'OPEN'
        )`);
        await terminalStore.dbRun(db, `INSERT INTO trades (userId, action, status) VALUES ('default', 'BUY', 'OPEN')`);
        await terminalStore.dbRun(db, `INSERT INTO trades (userId, action, status) VALUES ('terminal_a', 'SELL', 'OPEN')`);
        await terminalStore.dbRun(db, `INSERT INTO trades (userId, action, status) VALUES ('terminal_b', 'BUY', 'OPEN')`);

        const rows = await terminalStore.dbAll(
            db,
            `SELECT * FROM trades WHERE userId = ? OR userId = 'default' ORDER BY timestamp DESC LIMIT ?`,
            ['terminal_a', 50]
        );
        const activeRows = await terminalStore.dbAll(
            db,
            `SELECT * FROM trades WHERE (userId = ? OR userId = 'default') AND status = 'OPEN' ORDER BY timestamp DESC`,
            ['terminal_a']
        );

        assert.deepStrictEqual(new Set(rows.map(row => row.userId)), new Set(['default', 'terminal_a']));
        assert.deepStrictEqual(new Set(activeRows.map(row => row.userId)), new Set(['default', 'terminal_a']));
    } finally {
        await closeDb(db);
    }
}

function testBacktestEffectiveConfigMetadata() {
    const bot = makeTradingBotHarness();
    const effective = bot._getEffectiveBacktestConfig({
        SIMULATION_MODE: 'unified-live',
        RISK_PERCENTAGE: 2.5,
        DAILY_TRADE_LIMIT: 3,
        MAX_DAILY_LOSSES: 2,
        MIN_CONFLUENCE_SCORE: 6,
        ADX_THRESHOLD: 24,
        ATR_STOP_MULTIPLIER: 0.75,
        FINAL_TP_RR: 3,
        BACKTEST_FEE_RATE: 0.002,
        ALLOW_SHORT_TRADES: false
    });

    assert.strictEqual(effective.simulationMode, 'unified-live');
    assert.strictEqual(effective.SIMULATION_MODE, 'unified-live');
    assert.strictEqual(effective.RISK_PERCENTAGE, 2.5);
    assert.strictEqual(effective.DAILY_TRADE_LIMIT, 3);
    assert.strictEqual(effective.MAX_DAILY_LOSSES, 2);
    assert.strictEqual(effective.MIN_CONFLUENCE_SCORE, 6);
    assert.strictEqual(effective.ADX_THRESHOLD, 24);
    assert.strictEqual(effective.ATR_STOP_MULTIPLIER, 0.75);
    assert.strictEqual(effective.FINAL_TP_RR, 3);
    assert.strictEqual(effective.PARTIAL_TP_RR, 100);
    assert.strictEqual(effective.CONFLUENCE_LOT_SCALING, true);
    assert.strictEqual(effective.CONFLUENCE_LOT_START_SCORE, 7);
    assert.strictEqual(effective.CONFLUENCE_MAX_RISK_PERCENTAGE, 7.5);
    assert.strictEqual(effective.TRADING_MIN_BTC_QTY, 0.01);
    assert.strictEqual(effective.TRADING_MAX_BTC_QTY, 0.06);
    assert.strictEqual(effective.TRADING_LOT_STEP_BTC, 0.01);
    assert.strictEqual(effective.BACKTEST_FEE_RATE, 0.002);
    assert.strictEqual(effective.ALLOW_LONG_TRADES, true);
    assert.strictEqual(effective.ALLOW_SHORT_TRADES, false);
}

async function testProvidedDataBacktestReturnsDashboardMetadata() {
    const bot = makeTradingBotHarness();
    const result = await bot.runBacktest(90, 'confluence_scoring', {
        __historicalData: buildCandles(65),
        __dataSource: 'UnitTest',
        MIN_CONFLUENCE_SCORE: 10,
        BACKTEST_FEE_RATE: 0.001
    });

    assert.strictEqual(result.simulationMode, 'unified-live');
    assert.strictEqual(result.backtestEngine, 'TradingBot.runBacktest');
    assert.strictEqual(result.backtestEngineVersion, 'unified-live-v1');
    assert.strictEqual(result.dataSource, 'UnitTest');
    assert.strictEqual(result.candlesUsed, 65);
    assert.strictEqual(result.effectiveConfig.MIN_CONFLUENCE_SCORE, 10);
    assert.strictEqual(result.config.__historicalData, undefined);
    assert.strictEqual(result.config.__dataSource, undefined);
}

async function testRealisticBacktestGroupsPartialLifecycle() {
    const bot = makeTradingBotHarness();
    const originalAnalyze = UnifiedStrategy.prototype.analyze;
    const originalCheckTradeExit = UnifiedStrategy.prototype.checkTradeExit;
    let analyzeCalls = 0;
    let exitCalls = 0;

    UnifiedStrategy.prototype.analyze = function () {
        analyzeCalls++;
        if (analyzeCalls > 1) return { signal: 'NEUTRAL', score: 0, details: { confluenceScorer: {}, riskCalculator: {}, qualityFilters: [] } };
        return {
            signal: 'BUY',
            score: 10,
            details: {
                confluenceScorer: { details: 'unit-test' },
                riskCalculator: {
                    stopLoss: { long: 100, short: 104 },
                    takeProfit: { partialLong: 104, partialShort: 100, finalLong: 106, finalShort: 98 },
                    atr: 1
                },
                qualityFilters: []
            }
        };
    };
    UnifiedStrategy.prototype.checkTradeExit = function () {
        exitCalls++;
        if (exitCalls === 1) return { closed: false, partialClose: true, exitPrice: 104 };
        return { closed: true, exitPrice: 106, exitReason: 'Final TP' };
    };

    try {
        const result = await bot.runBacktest(90, 'confluence_scoring', {
            __historicalData: buildCandles(52, { start: 102, step: 0, range: 0 }),
            __dataSource: 'UnitTest',
            SIMULATION_MODE: 'unified-live',
            MAX_SL_PERCENT_OF_PRICE: 0.5,
            BACKTEST_FEE_RATE: 0,
            BACKTEST_SLIPPAGE_RATE: 0,
            BACKTEST_SPREAD_RATE: 0
        });

        assert.strictEqual(result.simulationMode, 'unified-live');
        assert.strictEqual(result.tradeLifecycleAccounting, 'single-position');
        assert.strictEqual(result.entryCandleExitCheck, true);
        assert.strictEqual(result.totalTrades, 1);
        assert.strictEqual(result.trades[0].exitReason, 'Final TP');
        assert.strictEqual(result.trades[0].partialClosed, true);
        assert.strictEqual(result.trades[0].partialExitPrice, 104);
        assert.ok(result.trades[0].partialPnl > 0);
    } finally {
        UnifiedStrategy.prototype.analyze = originalAnalyze;
        UnifiedStrategy.prototype.checkTradeExit = originalCheckTradeExit;
    }
}

async function testRealisticBacktestForceClosesOpenTrade() {
    const bot = makeTradingBotHarness();
    const originalAnalyze = UnifiedStrategy.prototype.analyze;
    const originalCheckTradeExit = UnifiedStrategy.prototype.checkTradeExit;
    let analyzeCalls = 0;

    UnifiedStrategy.prototype.analyze = function () {
        analyzeCalls++;
        if (analyzeCalls > 1) return { signal: 'NEUTRAL', score: 0, details: { confluenceScorer: {}, riskCalculator: {}, qualityFilters: [] } };
        return {
            signal: 'BUY',
            score: 10,
            details: {
                confluenceScorer: { details: 'unit-test' },
                riskCalculator: {
                    stopLoss: { long: 100, short: 104 },
                    takeProfit: { partialLong: 104, partialShort: 100, finalLong: 106, finalShort: 98 },
                    atr: 1
                },
                qualityFilters: []
            }
        };
    };
    UnifiedStrategy.prototype.checkTradeExit = function () {
        return { closed: false };
    };

    try {
        const result = await bot.runBacktest(90, 'confluence_scoring', {
            __historicalData: buildCandles(51, { start: 102, step: 0, range: 0 }),
            __dataSource: 'UnitTest',
            SIMULATION_MODE: 'unified-live',
            MAX_SL_PERCENT_OF_PRICE: 0.5,
            BACKTEST_FEE_RATE: 0,
            BACKTEST_SLIPPAGE_RATE: 0,
            BACKTEST_SPREAD_RATE: 0
        });

        assert.strictEqual(result.simulationMode, 'unified-live');
        assert.strictEqual(result.endOfBacktestClose, true);
        assert.strictEqual(result.totalTrades, 1);
        assert.strictEqual(result.trades[0].exitReason, 'End of Backtest');
    } finally {
        UnifiedStrategy.prototype.analyze = originalAnalyze;
        UnifiedStrategy.prototype.checkTradeExit = originalCheckTradeExit;
    }
}

async function run() {
    const tests = [
        testPositionSizingAllowsOnePercentRisk,
        testPositionSizingRejectsMinimumLotOverRisk,
        testTieredFivePercentRiskCap,
        testPositionSizingUsesDiscreteLotSteps,
        testConfluenceScoreScalesLotSize,
        testClampLotSizeUsesDiscreteLotSteps,
        testUnifiedStrategyDefaults,
        testChampionPresetIsLockedForFiftyDollarBacktest,
        testStrategyConfigAndRiskParameters,
        testSameCandleStopWinsOverTakeProfit,
        testTrailingMovesStopToBreakevenAfterOneR,
        testDecisionEngineDailyTradeLimit,
        testExecutionRejectsOutOfRangeLotSize,
        testPartialCloseQuantityUsesTwoDecimalLotSteps,
        testExecutionMonitorUsesUnifiedStrategyExit,
        testExecutionMonitorHandlesUnifiedPartialClose,
        testTerminalArchiveRestoreAndStartingBalance,
        testTerminalPinAccessAndTerms,
        testUntouchedStartingBalanceSyncOnlyChangesUntradedAccounts,
        testManualExitRejectsOtherTerminalTrade,
        testTerminalTradeReadsIncludeGlobalBotTradesOnly,
        testBacktestEffectiveConfigMetadata,
        testProvidedDataBacktestReturnsDashboardMetadata,
        testRealisticBacktestGroupsPartialLifecycle,
        testRealisticBacktestForceClosesOpenTrade
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
