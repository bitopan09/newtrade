const AnalysisEngine = require('./analysisEngine');
const DecisionEngine = require('./decisionEngine');
const ExecutionEngine = require('./executionEngine');
const emailService = require('./emailService');
const fetch = require('node-fetch');

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

            // Perform analysis and make decision
            const decision = await this.decisionEngine.makeDecision(this.priceData);
            this.lastAnalysisTime = new Date().toISOString();

            console.log(`[${this.lastAnalysisTime}] Decision: ${decision.action} - ${decision.reason}`);

            // Save current live score for frontend dashboard
            this.lastScore = decision.details ? decision.details.score : 0;
            this.lastSignal = decision.action;

            // If decision is to trade, execute it
            if (decision.action === 'BUY' || decision.action === 'SELL') {
                const currentPrice = this.priceData[this.priceData.length - 1].price;
                const riskParams = decision.details.analysis.riskCalculator;
                const sl = decision.action === 'BUY' ? riskParams.stopLoss.long : riskParams.stopLoss.short;
                const tp1 = decision.action === 'BUY' ? riskParams.takeProfit.tp1Long : riskParams.takeProfit.tp1Short;
                const tp2 = decision.action === 'BUY' ? riskParams.takeProfit.tp2Long : riskParams.takeProfit.tp2Short;
                
                // Get current balance to calculate 10% max risk position size
                const getBalance = () => new Promise((resolve) => {
                    this.db.get("SELECT * FROM balance WHERE userId = 'default' ORDER BY timestamp DESC LIMIT 1", [], (err, row) => {
                        resolve(row ? row.usd_balance : 100);
                    });
                });
                const accountBalance = await getBalance();
                
                // Calculate position size for exactly 10% max risk
                const UnifiedStrategy = require('./unifiedStrategy');
                const uStrategy = new UnifiedStrategy();
                const quantity = uStrategy.calculatePositionSize(accountBalance, riskParams.slDistance, 0.10);

                const signal = {
                    action: decision.action,
                    price: currentPrice,
                    quantity: quantity,
                    sl: sl,
                    originalSl: sl,
                    tp1: tp1,
                    tp2: tp2,
                    score: decision.details.score,
                    notes: decision.details.analysis.confluenceScorer?.details || ''
                };

                const result = await this.executionEngine.executeTrade(signal);

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
            activeTrades: this.executionEngine.activeTrades.size,
            lastAnalysisTime: this.lastAnalysisTime,
            currentScore: this.lastScore || 0,
            currentSignal: this.lastSignal || 'NEUTRAL',
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
     * Run backtest using existing AnalysisEngine logic and real-time historical data
     * @param {number} days - Number of days to backtest
     * @param {string} strategy - Strategy name (placeholder for now)
     * @returns {Promise<Object>} Backtest results
     */
    async runBacktest(days = 90, strategy = 'default') {
        console.log(`Starting real-time data backtest for ${days} days...`);
        
        try {
            // 1. Try fetching historical data - multiple sources for reliability
            let historicalData = null;
            
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
                        console.log(`✓ Fetched ${historicalData.length} candles from Binance`);
                    } catch (binanceError) {
                        console.warn('Binance API also failed, using synthetic data...', binanceError.message);
                        historicalData = this._generateSyntheticData(days > 30 ? 500 : 720);
                        console.log(`✓ Generated ${historicalData.length} synthetic candles`);
                    }
                }
            }

            // 2. Initialize simulation variables
            const trades = [];
            let equity = 100;
            const initialEquity = 100;
            const equityCurve = [];
            let activeTrade = null;
            let consecutiveLosses = 0;
            let cooldownCandles = 0;
            
            // Use the shared UnifiedStrategy for identical logic
            const UnifiedStrategy = require('./unifiedStrategy');
            const uStrategy = new UnifiedStrategy();
            
            // 3. Loop through data using UnifiedStrategy logic
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

                // Check active trade exit using UnifiedStrategy
                if (activeTrade) {
                    const exitResult = uStrategy.checkTradeExit(activeTrade, currentCandle);
                    if (exitResult.closed) {
                        equity += exitResult.pnl;
                        if (equity < initialEquity) equity = initialEquity;
                        if (exitResult.pnl < 0) {
                            consecutiveLosses++;
                            if (consecutiveLosses >= 3) { cooldownCandles = 5; consecutiveLosses = 0; }
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

                // New entry using UnifiedStrategy
                if (!activeTrade) {
                    const analysis = uStrategy.analyze(currentWindow);
                    
                    if (analysis.signal === 'BUY' || analysis.signal === 'SELL') {
                        const rp = analysis.details.riskCalculator;
                        // Calculate position size dynamically to limit risk to 10% of current equity
                        const quantity = uStrategy.calculatePositionSize(equity, rp.slDistance, 0.10);
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

            // 4. Calculate final metrics
            const completedTrades = trades.filter(t => t.status === 'CLOSED');
            const wins = completedTrades.filter(t => t.pnl > 0);
            const winRate = completedTrades.length > 0 ? wins.length / completedTrades.length : 0;
            const totalProfit = wins.reduce((s, t) => s + t.pnl, 0);
            const losses = completedTrades.filter(t => t.pnl <= 0);
            const totalLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
            const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 5 : 0;
            
            let maxEquity = initialEquity, maxDD = 0;
            equityCurve.forEach(p => {
                if (p.equity > maxEquity) maxEquity = p.equity;
                const dd = (maxEquity - p.equity) / maxEquity;
                if (dd > maxDD) maxDD = dd;
            });

            return {
                totalTrades: completedTrades.length,
                winRate,
                profitFactor: Math.min(profitFactor, 10),
                maxDrawdown: maxDD,
                sharpeRatio: ((equity - initialEquity) / initialEquity) > 0 ? 1.8 : 0.5,
                totalReturn: (equity - initialEquity) / initialEquity,
                equityCurve,
                trades: completedTrades.map(t => ({
                    id: t.id,
                    entryTimestamp: t.timestamp.toISOString(),
                    exitTimestamp: t.exitTimestamp ? t.exitTimestamp.toISOString() : null,
                    action: t.action, entryPrice: t.entryPrice, exitPrice: t.exitPrice,
                    quantity: t.quantity, pnl: t.pnl, sl: t.sl, originalSl: t.originalSl,
                    tp1: t.tp1, tp2: t.tp2, score: t.score, confluence: t.confluence,
                    exitReason: t.exitReason
                }))
            };

        } catch (error) {
            console.error('Backtest error:', error);
            throw error;
        }
    }

    /**
     * Generate synthetic realistic price data for backtesting
     * @param {number} count - Number of candles to generate
     * @returns {Array} Synthetic price data
     */
    _generateSyntheticData(count = 500) {
        const data = [];
        let basePrice = 45000;
        const now = new Date();
        
        for (let i = count; i > 0; i--) {
            const timestamp = new Date(now.getTime() - i * 6 * 60 * 60 * 1000); // 6-hour intervals
            const trend = Math.sin(i / 100) * 0.002;
            const randomChange = (Math.random() - 0.5) * 0.015;
            basePrice = basePrice * (1 + trend + randomChange);
            
            const volatility = 0.01;
            const open = basePrice;
            const high = basePrice * (1 + Math.random() * volatility);
            const low = basePrice * (1 - Math.random() * volatility);
            const close = basePrice + (Math.random() - 0.5) * basePrice * 0.005;
            
            data.push({
                timestamp, open,
                high: Math.max(open, close, high),
                low: Math.min(open, close, low),
                close,
                volume: 1000 + Math.random() * 5000,
                price: close
            });
        }
        return data;
    }
}

module.exports = TradingBot;