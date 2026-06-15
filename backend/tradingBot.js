const AnalysisEngine = require('./analysisEngine');
const DecisionEngine = require('./decisionEngine');
const ExecutionEngine = require('./executionEngine');
const notificationService = require('./emailService');
const fetch = require('node-fetch');
const { getUnifiedPresetConfig } = require('./strategyConfig');

const LOT_MIN_BTC = 0.01;
const LOT_MAX_BTC = 0.06;
const LOT_STEP_BTC = 0.01;

class TradingBot {
    constructor(db) {
        this.db = db;
        this.analysisEngine = new AnalysisEngine();
        this.decisionEngine = new DecisionEngine();
        this.executionEngine = new ExecutionEngine(this.db);
        
        // Link Execution Engine exits to Decision Engine tracking
        this.executionEngine.onTradeClosed = (trade) => {
            // Only count automated bot trades towards the daily limit, ignore manual user trades
            if (trade.userId === 'default') {
                this.decisionEngine.recordTradeOutcome(trade);
            }
        };

        this.isRunning = false;
        this.analysisInterval = null;
        this.priceData = []; // Store recent price data for analysis
        this.maxDataPoints = 100; // Keep last 100 data points
        this.analysisInProgress = false;
        this.lastExecutedSignalCandle = null;

        this._initializePriceData();
    }

    /**
     * Initialize price data. Real candles are loaded by the live analysis loop.
     */
    _initializePriceData() {
        this.priceData = [];
    }

    /**
     * Start the trading bot
     */
    start() {
        if (this.isRunning) {
            console.log('Trading bot is already running');
            return;
        }

        console.log('Starting trading bot...');
        this.isRunning = true;

        // Set up interval for analysis (every minute)
        this.analysisInterval = setInterval(() => {
            this._analyzeAndTrade();
        }, 60000); // 1 minute

        // Immediately run first analysis
        this._analyzeAndTrade();

        console.log('Trading bot started successfully');
    }

    /**
     * Stop the trading bot
     */
    stop() {
        if (!this.isRunning) {
            console.log('Trading bot is not running');
            return;
        }

        console.log('Stopping trading bot...');
        this.isRunning = false;

        if (this.analysisInterval) {
            clearInterval(this.analysisInterval);
            this.analysisInterval = null;
        }

        console.log('Trading bot stopped');
    }

    /**
     * Main analysis and trading loop
     */
    async _analyzeAndTrade() {
        if (this.analysisInProgress) {
            console.log('Trade analysis skipped: previous analysis still running');
            return;
        }

        this.analysisInProgress = true;
        try {
            // Fetch live 6H candles from Coinbase for proper institutional analysis
            const productId = 'BTC-USD';
            const granularity = 21600; // 6h candles
            
            const response = await fetch(`https://api.exchange.coinbase.com/products/${productId}/candles?granularity=${granularity}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Accept': 'application/json'
                }
            });
            
            if (!response.ok) {
                console.error('Failed to fetch live candles for analysis:', response.status);
                return;
            }
            
            const json = await response.json();
            if (!json || json.length === 0) return;
            
            // Format for analysis (reverse to get chronological order)
            this.priceData = json.map(candle => ({
                timestamp: new Date(candle[0] * 1000),
                open: candle[3],
                high: candle[2],
                low: candle[1],
                close: candle[4],
                volume: candle[5],
                price: candle[4]
            })).reverse();

            this.priceData = this._filterClosedCandles(this.priceData, granularity);
            if (this.priceData.length < 50) {
                console.log('Trade analysis skipped: insufficient closed candle history');
                return;
            }

            // Perform analysis and make decision
            const decision = await this.decisionEngine.makeDecision(this.priceData);
            this.lastAnalysisTime = new Date().toISOString();

            console.log(`[${this.lastAnalysisTime}] Decision: ${decision.action} - ${decision.reason}`);

            // Save current live score for frontend dashboard
            this.lastScore = decision.details ? decision.details.score : 0;
            this.lastSignal = decision.action;

            const latestPrice = this.priceData[this.priceData.length - 1]?.price || null;
            this._logSignal({
                source: 'live',
                action: decision.action,
                score: this.lastScore,
                price: latestPrice,
                reason: decision.reason,
                details: decision.details
            });

            // If decision is to trade, execute it
            if (decision.action === 'BUY' || decision.action === 'SELL') {
                const signalCandle = this.priceData[this.priceData.length - 1];
                const signalCandleKey = `${decision.action}:${new Date(signalCandle.timestamp).toISOString()}`;

                if (this.lastExecutedSignalCandle === signalCandleKey) {
                    const reason = 'Duplicate signal candle blocked';
                    console.log(`Trade skipped: ${reason}`);
                    this._logSignal({
                        source: 'duplicate_guard',
                        action: 'SKIP',
                        score: decision.details.score,
                        price: signalCandle.price,
                        reason,
                        details: { signalCandle: signalCandleKey, decision: decision.details }
                    });
                    return;
                }

                const latestMarketPrice = await this._getLatestMarketPrice();
                const currentPrice = Number.isFinite(latestMarketPrice) ? latestMarketPrice : signalCandle.price;
                const riskParams = decision.details.analysis.riskCalculator;
                const slDistance = riskParams.slDistance;
                const partialTpDistance = slDistance * riskParams.riskReward.partial;
                const finalTpDistance = slDistance * riskParams.riskReward.final;
                const sl = decision.action === 'BUY' ? currentPrice - slDistance : currentPrice + slDistance;
                const partialTp = decision.action === 'BUY' ? currentPrice + partialTpDistance : currentPrice - partialTpDistance;
                const finalTp = decision.action === 'BUY' ? currentPrice + finalTpDistance : currentPrice - finalTpDistance;
                // Get current balance and calculate dynamic quantity based on tiered risk
                const balanceRow = await new Promise((resolve) => {
                    this.db.get(`SELECT * FROM balance WHERE userId = 'default' ORDER BY timestamp DESC LIMIT 1`, [], (err, row) => {
                        resolve(row);
                    });
                });
                
                const currentBalance = balanceRow ? balanceRow.usd_balance : 50;
                const size = this._calculatePositionSize({
                    equity: currentBalance,
                    entryPrice: currentPrice,
                    stopLoss: sl,
                    config: getUnifiedPresetConfig(),
                    score: decision.details.score
                });

                if (!size.allowed) {
                    console.log(`Trade skipped by sizing guard: ${size.reason}`);
                    this._logSignal({
                        source: 'sizing_guard',
                        action: 'SKIP',
                        score: decision.details.score,
                        price: currentPrice,
                        reason: size.reason,
                        details: { sizing: size, decision: decision.details }
                    });
                    return;
                }

                const signal = {
                    action: decision.action,
                    price: currentPrice,
                    quantity: size.quantity,
                    sl: sl,
                    originalSl: sl,
                    partialTp: partialTp,
                    finalTp: finalTp,
                    partialClosed: false,
                    atr: riskParams.atr,
                    score: decision.details.score,
                    notes: decision.details.analysis.confluenceScorer?.details || ''
                };

                const result = await this.executionEngine.executeTrade(signal);

                if (result.success) {
                    console.log(`Trade executed: ${result.message}`);
                    this.lastExecutedSignalCandle = signalCandleKey;
                    if (typeof this.decisionEngine.recordTradeEntry === 'function') {
                        this.decisionEngine.recordTradeEntry();
                    }
                    // Send Telegram notification for auto-trade
                    if (process.env.SEND_TELEGRAM_ON_TRADE !== 'false') {
                        notificationService.sendTradeNotification(result.trade, `AUTO ${result.trade.action}`);
                    }
                } else {
                    console.log(`Trade execution failed: ${result.reason}`);
                }
            }

            // Monitor active trades for SL/TP hits using the latest real-time tick price
            this.db.get('SELECT price FROM prices ORDER BY timestamp DESC LIMIT 1', (err, row) => {
                if (!err && row) {
                    this.executionEngine.monitorTrades(row.price);
                } else {
                    // Fallback to the latest candle close price if DB fetch fails
                    this.executionEngine.monitorTrades(this.priceData[this.priceData.length - 1].price);
                }
            });
            
        } catch (error) {
            console.error('Error in trading loop:', error);
        } finally {
            this.analysisInProgress = false;
        }
    }

    _getLatestMarketPrice() {
        return new Promise((resolve) => {
            if (!this.db) return resolve(null);
            this.db.get('SELECT price FROM prices ORDER BY timestamp DESC LIMIT 1', (err, row) => {
                const price = Number(row?.price);
                resolve(!err && Number.isFinite(price) ? price : null);
            });
        });
    }

    /**
     * Add new price data to our stored data
     * @param {Object} priceData - New price data point
     */
    _addPriceData(priceData) {
        this.priceData.push(priceData);

        // Keep only the last N data points
        if (this.priceData.length > this.maxDataPoints) {
            this.priceData = this.priceData.slice(-this.maxDataPoints);
        }
    }

    /**
     * Get current status of the bot
     * @returns {Object} Bot status information
     */
    getStatus() {
        const effectiveConfig = this._getEffectiveBacktestConfig({ STRATEGY_PRESET: this._getStrategyPreset() });

        return {
            isRunning: this.isRunning,
            priceDataPoints: this.priceData.length,
            activeTrades: this.executionEngine.activeTrades.size,
            lastAnalysisTime: this.lastAnalysisTime,
            currentScore: this.lastScore || 0,
            currentSignal: this.lastSignal || 'NEUTRAL',
            dailyTradeTaken: this.decisionEngine.dailyTradeTaken,
            dailyTradeCount: this.decisionEngine.dailyTradeCount || 0,
            dailyLossCount: this.decisionEngine.dailyLossCount,
            circuitBreakerActive: this.decisionEngine.circuitBreakerActive,
            config: {
                strategyPreset: effectiveConfig.STRATEGY_PRESET,
                useClosedCandleSignals: effectiveConfig.USE_CLOSED_CANDLE_SIGNALS,
                riskPercentage: this._getRiskFraction(effectiveConfig) * 100,
                maxDailyTrades: effectiveConfig.DAILY_TRADE_LIMIT,
                maxDailyLosses: effectiveConfig.MAX_DAILY_LOSSES,
                minConfluenceScore: effectiveConfig.MIN_CONFLUENCE_SCORE,
                adxThreshold: effectiveConfig.ADX_THRESHOLD,
                atrStopMultiplier: effectiveConfig.ATR_STOP_MULTIPLIER,
                maxAtrPercentOfPrice: effectiveConfig.MAX_ATR_PERCENT_OF_PRICE,
                partialTpRr: effectiveConfig.PARTIAL_TP_RR,
                finalTpRr: effectiveConfig.FINAL_TP_RR,
                minRewardToRisk: effectiveConfig.MIN_REWARD_TO_RISK,
                trailingStartRr: effectiveConfig.TRAILING_START_RR,
                minQuantity: effectiveConfig.TRADING_MIN_BTC_QTY,
                maxQuantity: effectiveConfig.TRADING_MAX_BTC_QTY,
                lotStep: effectiveConfig.TRADING_LOT_STEP_BTC,
                sessionUtc: `${effectiveConfig.BOT_START_HOUR}:00-${effectiveConfig.BOT_END_HOUR}:00`
            }
        };
    }

    /**
     * Get recent trades
     * @param {number} limit - Maximum number of trades to return
     * @returns {Promise<Array>} Recent trades
     */
    async getRecentTrades(limit = 10) {
        return await this.executionEngine.getTrades(limit);
    }

    _getNumberEnv(name, fallback) {
        const value = Number(process.env[name]);
        return Number.isFinite(value) ? value : fallback;
    }

    _getConfigNumber(name, fallback, config = {}) {
        if (config[name] !== undefined) {
            const value = Number(config[name]);
            return Number.isFinite(value) ? value : fallback;
        }

        return this._getNumberEnv(name, fallback);
    }

    _clampConfigNumber(name, fallback, min, max, config = {}) {
        const value = this._getConfigNumber(name, fallback, config);
        if (!Number.isFinite(value)) return fallback;
        return Math.min(max, Math.max(min, value));
    }

    _publicConfig(config = {}) {
        return Object.fromEntries(Object.entries(config).filter(([key]) => !key.startsWith('__')));
    }

    _getConfigBoolean(name, fallback, config = {}) {
        if (config[name] !== undefined) {
            if (typeof config[name] === 'boolean') return config[name];
            return String(config[name]).toLowerCase() === 'true';
        }

        if (process.env[name] === undefined) return fallback;
        return String(process.env[name]).toLowerCase() === 'true';
    }

    _getStrategyPreset(config = {}) {
        return String(config.STRATEGY_PRESET || process.env.STRATEGY_PRESET || 'unified').toLowerCase();
    }

    _unifiedPresetConfig() {
        return getUnifiedPresetConfig();
    }

    _applyStrategyPreset(config = {}) {
        const internalKeys = Object.fromEntries(Object.entries(config).filter(([key]) => key.startsWith('__')));
        return { ...this._unifiedPresetConfig(), ...config, ...internalKeys };
    }

    _shouldUseClosedCandleSignals(config = {}) {
        if (config.USE_CLOSED_CANDLE_SIGNALS !== undefined) {
            return this._getConfigBoolean('USE_CLOSED_CANDLE_SIGNALS', false, config);
        }

        if (this._getStrategyPreset(config) === 'unified') return true;

        return this._getConfigBoolean('USE_CLOSED_CANDLE_SIGNALS', false, config);
    }

    _filterClosedCandles(candles, granularitySeconds = 21600, config = {}) {
        if (!this._shouldUseClosedCandleSignals(config) || !Array.isArray(candles) || candles.length === 0) {
            return candles;
        }

        const now = Date.now();
        return candles.filter(candle => {
            const timestamp = candle.timestamp instanceof Date ? candle.timestamp.getTime() : new Date(candle.timestamp).getTime();
            return Number.isFinite(timestamp) && timestamp + granularitySeconds * 1000 <= now;
        });
    }

    _getBacktestSimulationMode(config = {}) {
        return 'unified-live';
    }

    _getEffectiveBacktestConfig(config = {}) {
        config = this._applyStrategyPreset(config);
        const simulationMode = this._getBacktestSimulationMode(config);

        return {
            simulationMode,
            SIMULATION_MODE: simulationMode,
            BACKTEST_INITIAL_EQUITY: this._clampConfigNumber('BACKTEST_INITIAL_EQUITY', 50, 1, 1000000, config),
            STRATEGY_PRESET: this._getStrategyPreset(config),
            USE_CLOSED_CANDLE_SIGNALS: this._shouldUseClosedCandleSignals(config),
            UNIFIED_MODE: this._getConfigBoolean('UNIFIED_MODE', this._getStrategyPreset(config) === 'unified', config),
            RISK_PERCENTAGE: this._getConfigNumber('RISK_PERCENTAGE', 5, config),
            DAILY_TRADE_LIMIT: this._clampConfigNumber('DAILY_TRADE_LIMIT', 1, 1, 10, config),
            MAX_DAILY_LOSSES: this._clampConfigNumber('MAX_DAILY_LOSSES', 1, 1, 10, config),
            MIN_CONFLUENCE_SCORE: this._getConfigNumber('MIN_CONFLUENCE_SCORE', 6, config),
            ADX_THRESHOLD: this._getConfigNumber('ADX_THRESHOLD', 33, config),
            ATR_STOP_MULTIPLIER: this._getConfigNumber('ATR_STOP_MULTIPLIER', 0.2, config),
            MAX_ATR_PERCENT_OF_PRICE: this._getConfigNumber('MAX_ATR_PERCENT_OF_PRICE', 0.04, config),
            PARTIAL_TP_RR: this._getConfigNumber('PARTIAL_TP_RR', 100, config),
            FINAL_TP_RR: this._getConfigNumber('FINAL_TP_RR', 2, config),
            MIN_REWARD_TO_RISK: this._getConfigNumber('MIN_REWARD_TO_RISK', 1.2, config),
            MAX_DOLLAR_RISK: this._getConfigNumber('MAX_DOLLAR_RISK', 0, config),
            BREAKEVEN_TRIGGER_RR: this._getConfigNumber('BREAKEVEN_TRIGGER_RR', 1.5, config),
            TRAILING_START_RR: this._getConfigNumber('TRAILING_START_RR', 0.6, config),
            TRAILING_STOP_ATR_MULTIPLIER: this._getConfigNumber('TRAILING_STOP_ATR_MULTIPLIER', 1, config),
            MAX_SL_PERCENT_OF_PRICE: this._getConfigNumber('MAX_SL_PERCENT_OF_PRICE', 0.04, config),
            CONFLUENCE_LOT_SCALING: this._getConfigBoolean('CONFLUENCE_LOT_SCALING', true, config),
            CONFLUENCE_LOT_START_SCORE: this._getConfigNumber('CONFLUENCE_LOT_START_SCORE', 7, config),
            CONFLUENCE_MAX_RISK_PERCENTAGE: this._getConfigNumber('CONFLUENCE_MAX_RISK_PERCENTAGE', 7.5, config),
            TRADING_MIN_BTC_QTY: this._getConfigNumber('TRADING_MIN_BTC_QTY', LOT_MIN_BTC, config),
            TRADING_MAX_BTC_QTY: this._getConfigNumber('TRADING_MAX_BTC_QTY', LOT_MAX_BTC, config),
            TRADING_LOT_STEP_BTC: this._getConfigNumber('TRADING_LOT_STEP_BTC', LOT_STEP_BTC, config),
            BOT_START_HOUR: this._clampConfigNumber('BOT_START_HOUR', 0, 0, 23, config),
            BOT_END_HOUR: this._clampConfigNumber('BOT_END_HOUR', 23, 0, 23, config),
            BACKTEST_FEE_RATE: this._clampConfigNumber('BACKTEST_FEE_RATE', 0.001, 0, 0.01, config),
            BACKTEST_SLIPPAGE_RATE: this._clampConfigNumber('BACKTEST_SLIPPAGE_RATE', 0.0005, 0, 0.01, config),
            BACKTEST_SPREAD_RATE: this._clampConfigNumber('BACKTEST_SPREAD_RATE', 0.0002, 0, 0.01, config),
            MIN_SCORE_EDGE: this._getConfigNumber('MIN_SCORE_EDGE', 3, config),
            REJECT_TIE_SCORE: this._getConfigBoolean('REJECT_TIE_SCORE', false, config),
            REQUIRE_DIRECTIONAL_TRIGGER: this._getConfigBoolean('REQUIRE_DIRECTIONAL_TRIGGER', false, config),
            MIN_EMA_SEPARATION: this._getConfigNumber('MIN_EMA_SEPARATION', 0, config),
            MAX_SIGNAL_RANGE_ATR: this._getConfigNumber('MAX_SIGNAL_RANGE_ATR', 3.5, config),
            ALLOW_LONG_TRADES: this._getConfigBoolean('ALLOW_LONG_TRADES', true, config),
            ALLOW_SHORT_TRADES: this._getConfigBoolean('ALLOW_SHORT_TRADES', true, config)
        };
    }

    _getRiskFraction(config = {}) {
        const configured = this._getConfigNumber('RISK_PERCENTAGE', 5, config);
        const riskFraction = configured >= 1 ? configured / 100 : configured;
        return Math.min(0.05, Math.max(0, riskFraction));
    }

    _getTieredBaseBalance(equity, config = {}) {
        const initialEquity = this._clampConfigNumber('BACKTEST_INITIAL_EQUITY', 50, 1, 1000000, config);
        let baseBalance = this._clampConfigNumber('RISK_BASE_BALANCE', initialEquity, 1, 1000000, config);
        while (baseBalance * 2 <= equity) {
            baseBalance *= 2;
        }
        return baseBalance;
    }

    _floorLotStep(quantity, lotStep = LOT_STEP_BTC) {
        return parseFloat((Math.floor((Number(quantity) + 1e-9) / lotStep) * lotStep).toFixed(2));
    }

    _getFractionConfig(name, fallbackPercent, config = {}) {
        const configured = this._getConfigNumber(name, fallbackPercent, config);
        const fraction = configured >= 1 ? configured / 100 : configured;
        return Math.max(0, fraction);
    }

    _getConfluenceSizing({ score, minQty, maxQty, lotStep, baseRiskFraction, config = {} }) {
        const scalingEnabled = this._getConfigBoolean('CONFLUENCE_LOT_SCALING', true, config);
        const hasScore = score !== null && score !== undefined && score !== '';
        const numericScore = Number(score);

        if (!scalingEnabled || !hasScore || !Number.isFinite(numericScore)) {
            return {
                enabled: false,
                score: Number.isFinite(numericScore) ? numericScore : null,
                normalized: 0,
                targetQuantity: maxQty,
                riskFraction: baseRiskFraction
            };
        }

        const minScore = this._getConfigNumber('MIN_CONFLUENCE_SCORE', 5, config);
        const configuredStartScore = this._getConfigNumber('CONFLUENCE_LOT_START_SCORE', 7, config);
        const startScore = Math.min(10, Math.max(minScore, configuredStartScore));

        if (numericScore < startScore) {
            return {
                enabled: true,
                score: numericScore,
                normalized: 0,
                startScore,
                targetQuantity: minQty,
                riskFraction: baseRiskFraction
            };
        }

        const scoreSpan = Math.max(1, 10 - startScore + 1);
        const normalized = Math.min(1, Math.max(0, (numericScore - startScore + 1) / scoreSpan));
        const maxRiskFraction = Math.max(
            baseRiskFraction,
            this._getFractionConfig('CONFLUENCE_MAX_RISK_PERCENTAGE', 7.5, config)
        );
        const targetQuantity = this._floorLotStep(minQty + ((maxQty - minQty) * normalized), lotStep);

        return {
            enabled: true,
            score: numericScore,
            normalized,
            startScore,
            targetQuantity: Math.min(maxQty, Math.max(minQty, targetQuantity)),
            riskFraction: baseRiskFraction + ((maxRiskFraction - baseRiskFraction) * normalized)
        };
    }

    _calculatePositionSize({ equity, entryPrice, stopLoss, config = {}, score = null }) {
        if (Object.keys(config).length === 0) {
            config = this._applyStrategyPreset(config);
        }
        const baseRiskFraction = this._getRiskFraction(config);
        const baseBalance = this._getTieredBaseBalance(equity, config);
        const slDistance = Math.max(Math.abs(entryPrice - stopLoss), 0.1);
        const minQty = Math.max(LOT_MIN_BTC, this._getConfigNumber('TRADING_MIN_BTC_QTY', LOT_MIN_BTC, config));
        const maxQty = this._getConfigNumber('TRADING_MAX_BTC_QTY', LOT_MAX_BTC, config);
        const lotStep = Math.max(LOT_STEP_BTC, this._getConfigNumber('TRADING_LOT_STEP_BTC', LOT_STEP_BTC, config));
        const confluenceSizing = this._getConfluenceSizing({ score, minQty, maxQty, lotStep, baseRiskFraction, config });
        const riskFraction = confluenceSizing.riskFraction;
        const configuredMaxDollarRisk = this._getConfigNumber('MAX_DOLLAR_RISK', 0, config);
        const maxDollarRisk = Number.isFinite(configuredMaxDollarRisk) && configuredMaxDollarRisk > 0 ? configuredMaxDollarRisk : Infinity;
        const riskAmount = Math.min(baseBalance * riskFraction, maxDollarRisk);
        const rawQuantity = riskAmount / slDistance;
        const cappedQuantity = Math.min(maxQty, confluenceSizing.targetQuantity, rawQuantity);
        const quantity = this._floorLotStep(cappedQuantity, lotStep);
        const actualRisk = quantity * slDistance;
        const minQtyRisk = minQty * slDistance;
        const maxSlPercent = this._getConfigNumber('MAX_SL_PERCENT_OF_PRICE', 0.02, config);

        if (slDistance / entryPrice > maxSlPercent) {
            return { allowed: false, reason: `Stop distance too wide: ${(slDistance / entryPrice * 100).toFixed(2)}%`, riskAmount, slDistance, confluenceSizing };
        }

        if (quantity < minQty) {
            return { allowed: false, reason: `Calculated size below minimum lot; min lot would risk $${minQtyRisk.toFixed(2)}`, riskAmount, slDistance, confluenceSizing };
        }

        if (actualRisk > riskAmount * 1.05) {
            return { allowed: false, reason: `Actual risk $${actualRisk.toFixed(2)} exceeds allowed risk $${riskAmount.toFixed(2)}`, riskAmount, slDistance, confluenceSizing };
        }

        return {
            allowed: true,
            quantity,
            riskAmount,
            actualRisk,
            slDistance,
            confluenceSizing,
            confluenceTargetQuantity: confluenceSizing.targetQuantity,
            confluenceRiskPercentage: riskFraction * 100
        };
    }

    _calculatePartialCloseQuantity(quantity, config = {}) {
        const minQty = Math.max(LOT_MIN_BTC, this._getConfigNumber('TRADING_MIN_BTC_QTY', LOT_MIN_BTC, config));
        const lotStep = Math.max(LOT_STEP_BTC, this._getConfigNumber('TRADING_LOT_STEP_BTC', LOT_STEP_BTC, config));
        const quantitySteps = Math.round(Number(quantity) / lotStep);
        const partialSteps = Math.floor(quantitySteps / 2);
        const partialQuantity = parseFloat((partialSteps * lotStep).toFixed(2));
        const remainingQuantity = parseFloat((Number(quantity) - partialQuantity).toFixed(2));

        if (partialQuantity < minQty || remainingQuantity < minQty) {
            return null;
        }

        return partialQuantity;
    }

    _calculateSharpeRatio(equityCurve) {
        const returns = [];
        for (let i = 1; i < equityCurve.length; i++) {
            const prev = equityCurve[i - 1].equity;
            const curr = equityCurve[i].equity;
            if (prev > 0) returns.push((curr - prev) / prev);
        }

        if (returns.length < 2) return 0;
        const avg = returns.reduce((sum, value) => sum + value, 0) / returns.length;
        const variance = returns.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / (returns.length - 1);
        const stdDev = Math.sqrt(variance);
        if (stdDev === 0) return 0;
        return (avg / stdDev) * Math.sqrt(365);
    }

    _logSignal({ source, action, score, price, reason, details }) {
        if (!this.db) return;

        let safeDetails = null;
        if (details) {
            try {
                safeDetails = JSON.stringify(details).slice(0, 5000);
            } catch (error) {
                safeDetails = JSON.stringify({ error: 'Could not serialize signal details' });
            }
        }
        this.db.run(
            `INSERT INTO signal_logs (source, action, score, price, reason, details) VALUES (?, ?, ?, ?, ?, ?)`,
            [source, action, score || 0, price, reason || '', safeDetails],
            (err) => {
                if (err) console.error('Error logging signal:', err.message);
            }
        );
    }

    /**
     * Run backtest using existing AnalysisEngine logic and real-time historical data
     * @param {number} days - Number of days to backtest
     * @param {string} strategy - Strategy name (placeholder for now)
     * @returns {Promise<Object>} Backtest results
     */
    async runBacktest(days = 90, strategy = 'default', config = {}) {
        config = this._applyStrategyPreset(config);
        days = this._clampConfigNumber('BACKTEST_DAYS', parseInt(days, 10) || 90, 1, 365, { BACKTEST_DAYS: days });
        console.log(`Starting real-time data backtest for ${days} days...`);
        
        try {
            // 1. Try fetching historical data - multiple sources for reliability
            let historicalData = null;
            let dataSource = 'unknown';

            if (Array.isArray(config.__historicalData)) {
                historicalData = config.__historicalData;
                dataSource = config.__dataSource || 'Provided';
                console.log(`✓ Using ${historicalData.length} provided candles for simulation`);
            } else if (this._reuseBacktestData && this._cachedHistoricalData?.days === days) {
                historicalData = this._cachedHistoricalData.historicalData;
                dataSource = this._cachedHistoricalData.dataSource;
                console.log(`✓ Reusing ${historicalData.length} ${dataSource} candles for optimization`);
            } else {
            
            // Try Coinbase first (less likely to be blocked)
            try {
                console.log('Attempting to fetch from Coinbase API...');
                const productId = 'BTC-USD';
                // Coinbase valid granularities: 60, 300, 900, 3600 (1h), 21600 (6h), 86400 (1d)
                const granularity = 21600; // 6h candles
                const totalLimit = 500;
                
                let end = Math.floor(Date.now() / 1000);
                let allCandles = [];
                let remaining = totalLimit;
                
                while (remaining > 0) {
                    const chunkLimit = Math.min(remaining, 300); // Coinbase max is 300
                    const start = end - (chunkLimit * granularity);
                    
                    const response = await fetch(`https://api.exchange.coinbase.com/products/${productId}/candles?granularity=${granularity}&start=${start}&end=${end}`, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0',
                            'Accept': 'application/json'
                        }
                    });
                    
                    if (!response.ok) {
                        throw new Error(`Coinbase API error: ${response.status}`);
                    }
                    
                    const json = await response.json();
                    if (!json || json.length === 0) break;
                    
                    allCandles = allCandles.concat(json);
                    
                    end = start; // Next chunk ends where this one started
                    remaining -= chunkLimit;
                    
                    // Small delay to respect rate limits
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                
                historicalData = allCandles.map(k => ({
                    timestamp: new Date(parseInt(k[0]) * 1000),
                    low: parseFloat(k[1]),
                    high: parseFloat(k[2]),
                    open: parseFloat(k[3]),
                    close: parseFloat(k[4]),
                    volume: parseFloat(k[5]),
                    price: parseFloat(k[4])
                }));
                
                historicalData = historicalData.reverse();
                dataSource = 'Coinbase';
                console.log(`✓ Fetched ${historicalData.length} candles from Coinbase`);
                
            } catch (coinbaseError) {
                console.warn('Coinbase API failed, trying Bybit...', coinbaseError.message);
                
                // Try Bybit
                try {
                    console.log('Attempting to fetch from Bybit API...');
                    const symbol = 'BTCUSDT';
                    const interval = days > 30 ? '240' : '60'; // 4h or 1h candles
                    const limit = days > 30 ? 500 : 720;
                    
                    const response = await fetch(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${interval}&limit=${limit}`);
                    const json = await response.json();
                    
                    if (json.retCode === 0 && json.result?.list) {
                        historicalData = json.result.list.reverse().map(k => ({
                            timestamp: new Date(parseInt(k[0])),
                            open: parseFloat(k[1]),
                            high: parseFloat(k[2]),
                            low: parseFloat(k[3]),
                            close: parseFloat(k[4]),
                            volume: parseFloat(k[5]),
                            price: parseFloat(k[4])
                        }));
                        dataSource = 'Bybit';
                        console.log(`✓ Fetched ${historicalData.length} candles from Bybit`);
                    } else {
                        throw new Error('Invalid Bybit response');
                    }
                } catch (bybitError) {
                    console.warn('Bybit API failed, trying Binance...', bybitError.message);
                    
                    // Fallback to Binance
                    try {
                        const symbol = 'BTCUSDT';
                        const interval = days > 30 ? '4h' : '1h';
                        const limit = days > 30 ? 500 : 720;
                        
                        const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
                        
                        if (!response.ok) throw new Error('Binance API error');
                        const json = await response.json();
                        
                        historicalData = json.map(k => ({
                            timestamp: new Date(k[0]),
                            open: parseFloat(k[1]),
                            high: parseFloat(k[2]),
                            low: parseFloat(k[3]),
                            close: parseFloat(k[4]),
                            volume: parseFloat(k[5]),
                            price: parseFloat(k[4])
                        }));
                        dataSource = 'Binance';
                        console.log(`✓ Fetched ${historicalData.length} candles from Binance`);
                    } catch (binanceError) {
                        console.warn('Binance API also failed:', binanceError.message);
                        throw new Error('All real exchange data sources failed; refusing to run backtest with synthetic candles');
                    }
                }
            }

                if (this._reuseBacktestData) {
                    this._cachedHistoricalData = { days, dataSource, historicalData };
                }
            }

            if (!Array.isArray(config.__historicalData)) {
                const last = historicalData[historicalData.length - 1];
                const prev = historicalData[historicalData.length - 2];
                const inferredGranularity = last && prev
                    ? Math.max(60, Math.round((new Date(last.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000))
                    : 21600;
                historicalData = this._filterClosedCandles(historicalData, inferredGranularity, config);
            }

            if (!Array.isArray(config.__historicalData)) {
                const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
                const filtered = historicalData.filter(candle => new Date(candle.timestamp).getTime() >= cutoff);
                if (filtered.length >= 60) {
                    historicalData = filtered;
                }
            }

            // 2. Initialize simulation variables
            const trades = [];
            const initialEquity = this._clampConfigNumber('BACKTEST_INITIAL_EQUITY', 50, 1, 1000000, config);
            let equity = initialEquity;
            const equityCurve = [];
            let activeTrade = null;
            let consecutiveLosses = 0;
            let cooldownCandles = 0;
            let skippedSignals = 0;
            const skippedReasons = {};
            const dailySkipKeys = new Set();
            let totalFees = 0;
            let totalSlippageCost = 0;
            let longestLosingStreak = 0;
            let dailyTradeDate = null;
            let dailyTradeCount = 0;
            let dailyLossCount = 0;
            const feeRate = this._clampConfigNumber('BACKTEST_FEE_RATE', 0.001, 0, 0.01, config);
            const slippageRate = this._clampConfigNumber('BACKTEST_SLIPPAGE_RATE', 0.0005, 0, 0.01, config);
            const spreadRate = this._clampConfigNumber('BACKTEST_SPREAD_RATE', 0.0002, 0, 0.01, config);
            const maxDailyLosses = this._clampConfigNumber('MAX_DAILY_LOSSES', 1, 1, 10, config);
            const dailyTradeLimit = this._clampConfigNumber('DAILY_TRADE_LIMIT', 1, 1, 10, config);
            const sessionStartHour = this._clampConfigNumber('BOT_START_HOUR', 0, 0, 23, config);
            const sessionEndHour = this._clampConfigNumber('BOT_END_HOUR', 23, 0, 23, config);
            const effectiveConfig = this._getEffectiveBacktestConfig(config);
            const simulationMode = effectiveConfig.simulationMode;
            const isRealisticValidation = true;
            const recordSkip = (reason) => {
                skippedSignals++;
                skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
            };
            const recordDailySkip = (reason) => {
                const key = `${dailyTradeDate}:${reason}`;
                if (dailySkipKeys.has(key)) return;
                dailySkipKeys.add(key);
                recordSkip(reason);
            };
            
            // Use the shared UnifiedStrategy for identical logic
            const UnifiedStrategy = require('./unifiedStrategy');
            const uStrategy = new UnifiedStrategy(config);
            
            const HIGH_IMPACT_NEWS_DATES = new Set([
                '2026-01-29', '2026-03-19', '2026-05-07', '2026-06-18',
                '2026-07-30', '2026-09-17', '2026-11-05', '2026-12-17',
                '2026-01-14', '2026-02-12', '2026-03-12', '2026-04-14',
                '2026-05-13', '2026-06-11', '2026-07-15', '2026-08-12',
                '2026-09-15', '2026-10-14', '2026-11-12', '2026-12-10',
                '2026-01-09', '2026-02-06', '2026-03-06', '2026-04-03',
                '2026-05-01', '2026-06-05', '2026-07-02', '2026-08-07',
                '2026-09-04', '2026-10-02', '2026-11-06', '2026-12-04',
                '2026-04-15'
            ]);

            function isNewsDay(timestamp) {
                if (!(timestamp instanceof Date)) timestamp = new Date(timestamp);
                const dateStr = timestamp.toISOString().split('T')[0];
                return HIGH_IMPACT_NEWS_DATES.has(dateStr);
            }

            const closeActiveTrade = (referenceExitPrice, exitReason, exitTimestamp) => {
                if (!activeTrade) return null;

                const exitPrice = activeTrade.action === 'BUY'
                    ? referenceExitPrice * (1 - slippageRate - spreadRate / 2)
                    : referenceExitPrice * (1 + slippageRate + spreadRate / 2);
                const grossPnl = activeTrade.action === 'BUY'
                    ? (exitPrice - activeTrade.entryPrice) * activeTrade.quantity
                    : (activeTrade.entryPrice - exitPrice) * activeTrade.quantity;
                const exitFee = exitPrice * activeTrade.quantity * feeRate;
                const netPnl = grossPnl - activeTrade.entryFee - exitFee;

                equity += grossPnl - exitFee;
                totalFees += exitFee;
                totalSlippageCost += Math.abs(exitPrice - referenceExitPrice) * activeTrade.quantity;

                const lifecyclePnl = isRealisticValidation
                    ? netPnl + (activeTrade.realizedPartialPnl || 0)
                    : netPnl;

                if (lifecyclePnl < 0) {
                    consecutiveLosses++;
                    dailyLossCount++;
                    longestLosingStreak = Math.max(longestLosingStreak, consecutiveLosses);
                    if (consecutiveLosses >= maxDailyLosses) { cooldownCandles = 3; consecutiveLosses = 0; }
                } else {
                    consecutiveLosses = 0;
                    cooldownCandles = 0;
                }

                activeTrade.pnl = lifecyclePnl;
                activeTrade.grossPnl = isRealisticValidation
                    ? grossPnl + (activeTrade.realizedPartialGrossPnl || 0)
                    : grossPnl;
                activeTrade.fees = activeTrade.entryFee + exitFee + (isRealisticValidation ? (activeTrade.realizedPartialFees || 0) : 0);
                activeTrade.exitTimestamp = exitTimestamp;
                activeTrade.exitReason = exitReason;
                activeTrade.exitPrice = exitPrice;
                activeTrade.status = 'CLOSED';
                trades.push({ ...activeTrade });
                activeTrade = null;

                return 'closed';
            };

            const processExitResult = (exitResult, currentCandle) => {
                if (!activeTrade || !exitResult) return null;

                if (exitResult.partialClose) {
                    const halfQty = this._calculatePartialCloseQuantity(activeTrade.quantity, config);
                    if (!halfQty) {
                        return closeActiveTrade(exitResult.exitPrice, 'Partial TP (Full Close)', currentCandle.timestamp);
                    }

                    const exitPrice = activeTrade.action === 'BUY'
                        ? exitResult.exitPrice * (1 - slippageRate - spreadRate / 2)
                        : exitResult.exitPrice * (1 + slippageRate + spreadRate / 2);
                    const grossPartialPnl = activeTrade.action === 'BUY'
                        ? (exitPrice - activeTrade.entryPrice) * halfQty
                        : (activeTrade.entryPrice - exitPrice) * halfQty;
                    const exitFee = exitPrice * halfQty * feeRate;
                    const entryFeeShare = activeTrade.entryFee * 0.5;
                    const partialPnl = grossPartialPnl - entryFeeShare - exitFee;

                    equity += grossPartialPnl - exitFee;
                    activeTrade.quantity = parseFloat((activeTrade.quantity - halfQty).toFixed(2));
                    activeTrade.entryFee -= entryFeeShare;
                    activeTrade.partialClosed = true;
                    totalFees += exitFee;
                    totalSlippageCost += Math.abs(exitPrice - exitResult.exitPrice) * halfQty;

                    if (isRealisticValidation) {
                        activeTrade.realizedPartialPnl = (activeTrade.realizedPartialPnl || 0) + partialPnl;
                        activeTrade.realizedPartialGrossPnl = (activeTrade.realizedPartialGrossPnl || 0) + grossPartialPnl;
                        activeTrade.realizedPartialFees = (activeTrade.realizedPartialFees || 0) + entryFeeShare + exitFee;
                        activeTrade.partialExitPrice = exitPrice;
                        activeTrade.partialExitTimestamp = currentCandle.timestamp;
                        activeTrade.partialQuantity = halfQty;
                    } else {
                        trades.push({
                            ...activeTrade,
                            quantity: halfQty,
                            pnl: partialPnl,
                            exitTimestamp: currentCandle.timestamp,
                            exitReason: 'Partial TP (50%)',
                            exitPrice,
                            status: 'CLOSED_PARTIAL'
                        });
                    }

                    return 'partial';
                }

                if (exitResult.closed) {
                    return closeActiveTrade(exitResult.exitPrice, exitResult.exitReason, currentCandle.timestamp);
                }

                return null;
            };

            // 3. Loop through data using UnifiedStrategy logic
            for (let i = 50; i < historicalData.length; i++) {
                const currentWindow = historicalData.slice(i - 50, i);
                const currentCandle = historicalData[i];
                const currentDate = (currentCandle.timestamp instanceof Date) ? currentCandle.timestamp : new Date(currentCandle.timestamp);
                const currentDateKey = currentDate.toISOString().split('T')[0];

                if (currentDateKey !== dailyTradeDate) {
                    dailyTradeDate = currentDateKey;
                    dailyTradeCount = 0;
                    dailyLossCount = 0;
                }

                if (cooldownCandles > 0) {
                    cooldownCandles--;
                    if (!activeTrade) continue;
                }

                // Check active trade exit using UnifiedStrategy
                if (activeTrade) {
                    const exitResult = uStrategy.checkTradeExit(activeTrade, currentCandle);
                    const exitOutcome = processExitResult(exitResult, currentCandle);
                    if (exitOutcome === 'partial') continue;
                }

                if (!activeTrade) {
                    const hour = currentDate.getUTCHours();
                    const minute = currentDate.getUTCMinutes();
                    const timeInMinutes = hour * 60 + minute;
                    const isSessionOpen = (timeInMinutes >= sessionStartHour * 60 && timeInMinutes <= sessionEndHour * 60);

                    if (dailyLossCount >= maxDailyLosses) {
                        recordDailySkip(`Daily loss limit reached (${maxDailyLosses})`);
                    } else if (dailyTradeCount >= dailyTradeLimit) {
                        recordDailySkip(`Daily trade limit reached (${dailyTradeLimit})`);
                    } else if (isNewsDay(currentDate)) {
                        recordSkip('High-impact news day');
                    } else if (isSessionOpen) {
                        const analysis = uStrategy.analyze(currentWindow);
                        
                        if (analysis.signal === 'BUY' || analysis.signal === 'SELL') {
                            const rp = analysis.details.riskCalculator;
                            
                            const sl = analysis.signal === 'BUY' ? rp.stopLoss.long : rp.stopLoss.short;
                            const rawEntryPrice = currentCandle.open;
                            const entryPrice = analysis.signal === 'BUY'
                                ? rawEntryPrice * (1 + slippageRate + spreadRate / 2)
                                : rawEntryPrice * (1 - slippageRate - spreadRate / 2);
                            const size = this._calculatePositionSize({ equity, entryPrice, stopLoss: sl, config, score: analysis.score });
                            if (!size.allowed) {
                                recordSkip(size.reason);
                                continue;
                            }
                            const entryFee = entryPrice * size.quantity * feeRate;
                            equity -= entryFee;
                            totalFees += entryFee;
                            totalSlippageCost += Math.abs(entryPrice - rawEntryPrice) * size.quantity;
                            
                            activeTrade = {
                                id: trades.length + 1,
                                action: analysis.signal,
                                entryPrice,
                                quantity: size.quantity,
                                originalQuantity: size.quantity,
                                sl: analysis.signal === 'BUY' ? rp.stopLoss.long : rp.stopLoss.short,
                                originalSl: analysis.signal === 'BUY' ? rp.stopLoss.long : rp.stopLoss.short,
                                partialTp: analysis.signal === 'BUY' ? rp.takeProfit.partialLong : rp.takeProfit.partialShort,
                                finalTp: analysis.signal === 'BUY' ? rp.takeProfit.finalLong : rp.takeProfit.finalShort,
                                partialClosed: false,
                                entryFee,
                                riskAmount: size.riskAmount,
                                actualRisk: size.actualRisk,
                                confluenceTargetQuantity: size.confluenceTargetQuantity,
                                confluenceRiskPercentage: size.confluenceRiskPercentage,
                                atr: rp.atr,
                                score: analysis.score,
                                confluence: analysis.details.confluenceScorer?.details || '',
                                timestamp: currentCandle.timestamp,
                                status: 'OPEN'
                            };
                            dailyTradeCount++;

                            if (isRealisticValidation) {
                                const sameCandleExit = uStrategy.checkTradeExit(activeTrade, currentCandle);
                                processExitResult(sameCandleExit, currentCandle);
                            }
                        } else if (analysis.score >= uStrategy.CONFLUENCE_THRESHOLD) {
                            const qualityFilters = analysis.details.qualityFilters || [];
                            recordSkip(qualityFilters.length > 0 ? qualityFilters.join('; ') : 'Trend filters blocked trade');
                        }
                    }
                }

                equityCurve.push({ day: equityCurve.length + 1, timestamp: currentCandle.timestamp, equity });
            }

            if (isRealisticValidation && activeTrade && historicalData.length > 0) {
                const finalCandle = historicalData[historicalData.length - 1];
                const finalTimestamp = finalCandle.timestamp instanceof Date ? finalCandle.timestamp : new Date(finalCandle.timestamp);
                const finalReferencePrice = finalCandle.close || finalCandle.price || activeTrade.entryPrice;
                closeActiveTrade(finalReferencePrice, 'End of Backtest', finalTimestamp);
                equityCurve.push({ day: equityCurve.length + 1, timestamp: finalTimestamp, equity });
            }

            // 4. Calculate final metrics
            const completedTrades = trades.filter(t => t.status === 'CLOSED' || t.status === 'CLOSED_PARTIAL');
            const wins = completedTrades.filter(t => t.pnl > 0);
            const winRate = completedTrades.length > 0 ? wins.length / completedTrades.length : 0;
            const totalProfit = wins.reduce((s, t) => s + t.pnl, 0);
            const losses = completedTrades.filter(t => t.pnl <= 0);
            const totalLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
            const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 5 : 0;
            const averageWin = wins.length > 0 ? totalProfit / wins.length : 0;
            const averageLoss = losses.length > 0 ? totalLoss / losses.length : 0;
            const expectancy = completedTrades.length > 0
                ? (winRate * averageWin) - ((1 - winRate) * averageLoss)
                : 0;
            const totalRisk = completedTrades.reduce((sum, t) => sum + (t.actualRisk || t.riskAmount || 0), 0);
            const averageRMultiple = totalRisk > 0
                ? completedTrades.reduce((sum, t) => sum + (t.pnl / (t.actualRisk || t.riskAmount || 1)), 0) / completedTrades.length
                : 0;
            const longTrades = completedTrades.filter(t => t.action === 'BUY');
            const shortTrades = completedTrades.filter(t => t.action === 'SELL');
            const longWins = longTrades.filter(t => t.pnl > 0).length;
            const shortWins = shortTrades.filter(t => t.pnl > 0).length;
            
            let maxEquity = initialEquity, maxDD = 0;
            equityCurve.forEach(p => {
                if (p.equity > maxEquity) maxEquity = p.equity;
                const dd = (maxEquity - p.equity) / maxEquity;
                if (dd > maxDD) maxDD = dd;
            });

            const sharpeRatio = this._calculateSharpeRatio(equityCurve);

            const result = {
                simulationMode,
                backtestEngine: 'TradingBot.runBacktest',
                backtestEngineVersion: 'unified-live-v1',
                tradeLifecycleAccounting: 'single-position',
                entryCandleExitCheck: isRealisticValidation,
                endOfBacktestClose: isRealisticValidation,
                totalTrades: completedTrades.length,
                winRate,
                profitFactor: Math.min(profitFactor, 10),
                maxDrawdown: maxDD,
                sharpeRatio,
                totalReturn: (equity - initialEquity) / initialEquity,
                finalEquity: equity,
                config: this._publicConfig(config),
                effectiveConfig,
                dataSource,
                candlesUsed: historicalData.length,
                skippedSignals,
                skippedReasons,
                totalFees,
                totalSlippageCost,
                expectancy,
                averageRMultiple,
                averageWin,
                averageLoss,
                longestLosingStreak,
                longWinRate: longTrades.length > 0 ? longWins / longTrades.length : 0,
                shortWinRate: shortTrades.length > 0 ? shortWins / shortTrades.length : 0,
                equityCurve,
                trades: completedTrades.map(t => ({
                    id: t.id,
                    entryTimestamp: t.timestamp.toISOString(),
                    exitTimestamp: t.exitTimestamp ? t.exitTimestamp.toISOString() : null,
                    action: t.action, entryPrice: t.entryPrice, exitPrice: t.exitPrice,
                    quantity: isRealisticValidation ? (t.originalQuantity || t.quantity) : t.quantity,
                    remainingQuantity: t.quantity,
                    originalQuantity: t.originalQuantity || t.quantity,
                    pnl: t.pnl, sl: t.sl, originalSl: t.originalSl,
                    tp1: t.partialTp, tp2: t.finalTp, score: t.score, confluence: t.confluence,
                    fees: t.fees || 0, riskAmount: t.riskAmount, actualRisk: t.actualRisk,
                    confluenceTargetQuantity: t.confluenceTargetQuantity,
                    confluenceRiskPercentage: t.confluenceRiskPercentage,
                    exitReason: t.exitReason,
                    partialClosed: !!t.partialClosed,
                    partialExitPrice: t.partialExitPrice || null,
                    partialExitTimestamp: t.partialExitTimestamp ? t.partialExitTimestamp.toISOString() : null,
                    partialQuantity: t.partialQuantity || null,
                    partialPnl: t.realizedPartialPnl || 0
                }))
            };

            if (config.__captureHistoricalData) {
                result.historicalData = historicalData;
            }

            return result;

        } catch (error) {
            console.error('Backtest error:', error);
            throw error;
        }
    }

    _getOptimizationCandidates() {
        const growthBaseConfig = {
            STRATEGY_PRESET: 'unified',
            RISK_PERCENTAGE: 5,
            DAILY_TRADE_LIMIT: 1,
            MAX_DAILY_LOSSES: 1,
            MIN_CONFLUENCE_SCORE: 4,
            ADX_THRESHOLD: 18,
            ATR_STOP_MULTIPLIER: 0.05,
            MAX_ATR_PERCENT_OF_PRICE: 0.08,
            PARTIAL_TP_RR: 100,
            FINAL_TP_RR: 100,
            BREAKEVEN_TRIGGER_RR: 1,
            TRAILING_START_RR: 1,
            TRAILING_STOP_ATR_MULTIPLIER: 2,
            MAX_SL_PERCENT_OF_PRICE: 0.02,
            CONFLUENCE_LOT_SCALING: true,
            CONFLUENCE_LOT_START_SCORE: 8,
            CONFLUENCE_MAX_RISK_PERCENTAGE: 20,
            TRADING_MIN_BTC_QTY: 0.01,
            TRADING_MAX_BTC_QTY: 0.08,
            TRADING_LOT_STEP_BTC: 0.01,
            BACKTEST_FEE_RATE: 0.001,
            BACKTEST_SLIPPAGE_RATE: 0.0005,
            BACKTEST_SPREAD_RATE: 0.0002
        };

        const unifiedBaseConfig = {
            ...growthBaseConfig,
            MIN_CONFLUENCE_SCORE: 6,
            MIN_SCORE_EDGE: 3,
            REJECT_TIE_SCORE: false,
            REQUIRE_DIRECTIONAL_TRIGGER: false,
            MIN_EMA_SEPARATION: 0,
            MAX_SIGNAL_RANGE_ATR: 3.5,
            ADX_THRESHOLD: 33,
            ATR_STOP_MULTIPLIER: 0.2,
            FINAL_TP_RR: 2,
            BREAKEVEN_TRIGGER_RR: 1.5,
            TRAILING_START_RR: 0.6,
            TRAILING_STOP_ATR_MULTIPLIER: 1,
            MAX_ATR_PERCENT_OF_PRICE: 0.04,
            MAX_SL_PERCENT_OF_PRICE: 0.04,
            CONFLUENCE_LOT_SCALING: true,
            CONFLUENCE_MAX_RISK_PERCENTAGE: 7.5,
            DAILY_TRADE_LIMIT: 1,
            TRADING_MAX_BTC_QTY: 0.06,
            BOT_START_HOUR: 8,
            BOT_END_HOUR: 23
        };

        const safeBaseConfig = {
            ...unifiedBaseConfig,
            RISK_PERCENTAGE: 1,
            MAX_DOLLAR_RISK: 0.5,
            MIN_CONFLUENCE_SCORE: 6,
            ADX_THRESHOLD: 22,
            ATR_STOP_MULTIPLIER: 1.25,
            FINAL_TP_RR: 2.5,
            MAX_ATR_PERCENT_OF_PRICE: 0.025,
            CONFLUENCE_LOT_SCALING: false,
            MAX_SL_PERCENT_OF_PRICE: 0.02
        };

        return [
            { label: 'growth_profile_4_100r', config: growthBaseConfig },
            { label: 'growth_relaxed_edge_4_100r', config: { ...growthBaseConfig, MIN_SCORE_EDGE: 1, REJECT_TIE_SCORE: false, REQUIRE_DIRECTIONAL_TRIGGER: false, MIN_EMA_SEPARATION: 0 } },
            { label: 'growth_directional_4_100r', config: { ...growthBaseConfig, MIN_SCORE_EDGE: 1, REJECT_TIE_SCORE: true, REQUIRE_DIRECTIONAL_TRIGGER: true, MIN_EMA_SEPARATION: 0 } },
            { label: 'selected_unified_adaptive_v5', config: unifiedBaseConfig },
            { label: 'balanced_relaxed_4_2r', config: { ...unifiedBaseConfig, MIN_CONFLUENCE_SCORE: 4, MIN_SCORE_EDGE: 2, MIN_EMA_SEPARATION: 0 } },
            { label: 'balanced_wide_target_4_3r', config: { ...unifiedBaseConfig, MIN_CONFLUENCE_SCORE: 4, MIN_SCORE_EDGE: 2, MIN_EMA_SEPARATION: 0, FINAL_TP_RR: 3 } },
            { label: 'safe_baseline_1pct', config: safeBaseConfig },
            { label: 'strict_quality_1pct', config: { ...safeBaseConfig, MIN_CONFLUENCE_SCORE: 7, ADX_THRESHOLD: 25 } },
            { label: 'tighter_stop_1pct', config: { ...safeBaseConfig, ATR_STOP_MULTIPLIER: 1.0 } },
            { label: 'faster_partial_1pct', config: { ...safeBaseConfig, PARTIAL_TP_RR: 1.2, FINAL_TP_RR: 1.8, TRAILING_START_RR: 0.8 } },
            { label: 'wider_target_1pct', config: { ...safeBaseConfig, PARTIAL_TP_RR: 1.5, FINAL_TP_RR: 3.0 } },
            { label: 'risk_1_5pct', config: { ...safeBaseConfig, RISK_PERCENTAGE: 1.5, MAX_DOLLAR_RISK: 0.75 } },
            { label: 'shorts_only_1pct', config: { ...safeBaseConfig, ALLOW_LONG_TRADES: false, ALLOW_SHORT_TRADES: true } },
            { label: 'ny_session_1pct', config: { ...safeBaseConfig, BOT_START_HOUR: 13, BOT_END_HOUR: 20 } }
        ];
    }

    async optimizeBacktest(days = 90, strategy = 'confluence_scoring') {
        const candidates = this._getOptimizationCandidates();

        const results = [];
        this._reuseBacktestData = true;
        this._cachedHistoricalData = null;

        try {
            for (const candidate of candidates) {
                const result = await this.runBacktest(days, strategy, candidate.config);
                const summary = {
                    label: candidate.label,
                    config: candidate.config,
                    dataSource: result.dataSource,
                    candlesUsed: result.candlesUsed,
                    totalTrades: result.totalTrades,
                    winRate: result.winRate,
                    profitFactor: result.profitFactor,
                    maxDrawdown: result.maxDrawdown,
                    sharpeRatio: result.sharpeRatio,
                    totalReturn: result.totalReturn,
                    finalEquity: result.finalEquity,
                    expectancy: result.expectancy,
                    averageRMultiple: result.averageRMultiple,
                    skippedSignals: result.skippedSignals,
                    score: result.totalTrades >= 3 && result.profitFactor > 1 && result.totalReturn > 0 && result.maxDrawdown <= 0.9
                        ? result.totalReturn - result.maxDrawdown + Math.min(result.profitFactor, 5) * 0.01 + Math.max(result.expectancy, 0) * 0.001
                        : -999
                };
                results.push(summary);
            }
        } finally {
            this._reuseBacktestData = false;
            this._cachedHistoricalData = null;
        }

        results.sort((a, b) => b.score - a.score);

        return {
            days,
            strategy,
            tested: results.length,
            best: results[0] || null,
            results,
            realDataOnly: results.every(result => ['Coinbase', 'Bybit', 'Binance', 'Provided', 'Captured'].includes(result.dataSource))
        };
    }

    async runWalkForwardBacktest(days = 180, strategy = 'confluence_scoring', config = {}, folds = 3) {
        const foldCount = Math.min(6, Math.max(2, parseInt(folds, 10) || 3));
        const capture = await this.runBacktest(days, strategy, { ...config, __captureHistoricalData: true });
        const historicalData = capture.historicalData || [];

        if (historicalData.length < foldCount * 60) {
            throw new Error(`Not enough candles for ${foldCount}-fold walk-forward test`);
        }

        const candidates = this._getOptimizationCandidates();
        const foldSize = Math.floor(historicalData.length / foldCount);
        const results = [];

        for (let fold = 1; fold < foldCount; fold++) {
            const trainData = historicalData.slice(0, fold * foldSize);
            const testStart = fold * foldSize;
            const testEnd = fold === foldCount - 1 ? historicalData.length : (fold + 1) * foldSize;
            const testData = historicalData.slice(testStart, testEnd);

            if (trainData.length < 60 || testData.length < 60) continue;

            const trainingResults = [];
            for (const candidate of candidates) {
                const candidateConfig = { ...candidate.config, __historicalData: trainData, __dataSource: capture.dataSource || 'Captured' };
                const trainResult = await this.runBacktest(days, strategy, candidateConfig);
                trainingResults.push({
                    label: candidate.label,
                    config: candidate.config,
                    totalTrades: trainResult.totalTrades,
                    profitFactor: trainResult.profitFactor,
                    maxDrawdown: trainResult.maxDrawdown,
                    totalReturn: trainResult.totalReturn,
                    score: trainResult.totalTrades >= 2 ? trainResult.totalReturn - trainResult.maxDrawdown + (trainResult.profitFactor > 1 ? 0.01 : 0) : -999
                });
            }

            trainingResults.sort((a, b) => b.score - a.score);
            const selected = trainingResults[0];
            const testResult = await this.runBacktest(days, strategy, {
                ...selected.config,
                __historicalData: testData,
                __dataSource: capture.dataSource || 'Captured'
            });

            results.push({
                fold,
                trainCandles: trainData.length,
                testCandles: testData.length,
                selectedLabel: selected.label,
                selectedConfig: selected.config,
                trainingScore: selected.score,
                test: {
                    totalTrades: testResult.totalTrades,
                    winRate: testResult.winRate,
                    profitFactor: testResult.profitFactor,
                    maxDrawdown: testResult.maxDrawdown,
                    totalReturn: testResult.totalReturn,
                    finalEquity: testResult.finalEquity,
                    expectancy: testResult.expectancy,
                    averageRMultiple: testResult.averageRMultiple,
                    skippedSignals: testResult.skippedSignals
                }
            });
        }

        const completed = results.filter(result => result.test.totalTrades > 0);
        const average = completed.length > 0
            ? {
                totalReturn: completed.reduce((sum, result) => sum + result.test.totalReturn, 0) / completed.length,
                maxDrawdown: completed.reduce((sum, result) => sum + result.test.maxDrawdown, 0) / completed.length,
                profitFactor: completed.reduce((sum, result) => sum + result.test.profitFactor, 0) / completed.length,
                trades: completed.reduce((sum, result) => sum + result.test.totalTrades, 0)
            }
            : { totalReturn: 0, maxDrawdown: 0, profitFactor: 0, trades: 0 };

        return {
            days,
            strategy,
            folds: foldCount,
            dataSource: capture.dataSource,
            candlesUsed: historicalData.length,
            evaluatedFolds: results.length,
            completedFolds: completed.length,
            average,
            results,
            decisionRule: 'Do not change defaults unless walk-forward folds show stable positive return, profit factor > 1, and acceptable drawdown.'
        };
    }

}

module.exports = TradingBot;
