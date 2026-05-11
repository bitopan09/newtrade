const AnalysisEngine = require('./analysisEngine');
const DecisionEngine = require('./decisionEngine');
const ExecutionEngine = require('./executionEngine');
const emailService = require('./emailService');

class TradingBot {
    constructor(db) {
        this.db = db;
        this.analysisEngine = new AnalysisEngine();
        this.decisionEngine = new DecisionEngine();
        this.executionEngine = new ExecutionEngine(db);

        this.isRunning = false;
        this.analysisInterval = null;
        this.priceData = []; // Store recent price data for analysis
        this.maxDataPoints = 100; // Keep last 100 data points

        // Load initial price data (in real implementation, this would come from historical data)
        this._initializePriceData();
    }

    /**
     * Initialize price data with some historical data
     */
    _initializePriceData() {
        // Generate some initial price data for testing
        const basePrice = 30000;
        for (let i = 0; i < 50; i++) {
            const price = basePrice + (Math.random() - 0.5) * 2000; // Random walk around base price
            this.priceData.push({
                timestamp: new Date(Date.now() - (50 - i) * 60000), // Last 50 minutes
                price: price,
                volume: Math.random() * 100
            });
        }
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
        try {
            // Get latest prices from DB
            return new Promise((resolve) => {
                this.db.all('SELECT price, volume, timestamp FROM prices ORDER BY timestamp DESC LIMIT ?', [this.maxDataPoints], async (err, rows) => {
                    if (err || !rows || rows.length === 0) {
                        resolve();
                        return;
                    }

                    // Format for analysis (reverse to get chronological order)
                    this.priceData = rows.map(r => ({
                        price: r.price,
                        volume: r.volume,
                        timestamp: new Date(r.timestamp)
                    })).reverse();

                    // Make sure we have enough data for analysis
                    if (this.priceData.length < 20) {
                        console.log('Waiting for sufficient price data...');
                        resolve();
                        return;
                    }

                    // Perform analysis and make decision
                    const decision = await this.decisionEngine.makeDecision(this.priceData);
                    this.lastAnalysisTime = new Date().toISOString();

                    console.log(`[${this.lastAnalysisTime}] Decision: ${decision.action} - ${decision.reason}`);

                    // If decision is to trade, execute it
                    if (decision.action === 'BUY' || decision.action === 'SELL') {
                        const signal = {
                            action: decision.action,
                            price: this.priceData[this.priceData.length - 1].price
                        };

                        const result = await this.executionEngine.executeTrade(signal, 0.01); // 0.01 BTC trade

                        if (result.success) {
                            console.log(`Trade executed: ${result.message}`);
                            // Send email notification for auto-trade
                            if (process.env.SEND_EMAIL_ON_TRADE === 'true') {
                                emailService.sendTradeNotification(result.trade, `AUTO ${result.trade.action}`);
                            }
                        } else {
                            console.log(`Trade execution failed: ${result.reason}`);
                        }
                    }

                    // Monitor active trades for SL/TP hits
                    const currentPrice = this.priceData[this.priceData.length - 1].price;
                    this.executionEngine.monitorTrades(currentPrice);
                    resolve();
                });
            });

        } catch (error) {
            console.error('Error in trading loop:', error);
        }
    }

    /**
     * Generate a new simulated price point
     * @returns {Object} New price data point
     */
    _generateNewPrice() {
        const lastPrice = this.priceData.length > 0
            ? this.priceData[this.priceData.length - 1].price
            : 30000;

        // Random walk with slight bias
        const change = (Math.random() - 0.5) * 100; // +/- 50 points
        const newPrice = lastPrice + change;

        return {
            timestamp: new Date(),
            price: newPrice,
            volume: Math.random() * 100
        };
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
        return {
            isRunning: this.isRunning,
            priceDataPoints: this.priceData.length,
            activeTrades: this.executionEngine.getActiveTrades().length,
            lastAnalysisTime: this.lastAnalysisTime,
            dailyTradeTaken: this.decisionEngine.dailyTradeTaken,
            dailyLossCount: this.decisionEngine.dailyLossCount,
            circuitBreakerActive: this.decisionEngine.circuitBreakerActive
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

    /**
     * Placeholder for backtesting logic
     * @param {number} days - Number of days to backtest
     * @param {string} strategy - Strategy name
     * @returns {Promise<Object>} Backtest results
     */
    async runBacktest(days, strategy) {
        return {
            totalTrades: 0,
            winRate: 0,
            profitFactor: 0,
            maxDrawdown: 0,
            sharpeRatio: 0,
            totalReturn: 0,
            equityCurve: [],
            trades: []
        };
    }
}

module.exports = TradingBot;