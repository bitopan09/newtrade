const sqlite3 = require('sqlite3').verbose();
const TelegramBot = require('telegram-bot-api');
const dotenv = require('dotenv');

dotenv.config();

class ExecutionEngine {
    constructor(db) {
        // Use provided database for trade logging
        this.db = db;

        // Initialize Telegram bot (placeholder)
        this.bot = null;
        if (process.env.TELEGRAM_BOT_TOKEN) {
            try {
                this.bot = new TelegramBot({
                    token: process.env.TELEGRAM_BOT_TOKEN,
                });
                console.log('Telegram bot initialized');
            } catch (error) {
                console.error('Error initializing Telegram bot:', error);
            }
        }

        // Active trades tracking
        this.activeTrades = new Map();
    }

    /**
     * Load open trades from database into memory
     */
    async loadOpenTrades() {
        return new Promise((resolve, reject) => {
            this.db.all("SELECT * FROM trades WHERE status = 'OPEN'", [], (err, rows) => {
                if (err) {
                    console.error('Error loading open trades:', err);
                    reject(err);
                } else {
                    rows.forEach(row => {
                        this.activeTrades.set(row.id, {
                            ...row,
                            timestamp: new Date(row.timestamp)
                        });
                    });
                    console.log(`Loaded ${rows.length} open trades into memory.`);
                    resolve(rows);
                }
            });
        });
    }

    /**
     * Execute a trade based on signal
     * @param {Object} signal - Trading signal from decision engine
     * @param {number} quantity - Trade quantity
     * @param {string} userId - User ID for the trade
     * @returns {Promise<Object>} Execution result
     */
    async executeTrade(signal, quantity = 0.01, userId = 'default') {
        const { action, price } = signal;

        if (action === 'SKIP') {
            return { success: false, reason: 'Signal was to skip trade' };
        }

        // Check user's active trades (Institutional engine only allows 1 active trade at a time)
        const userTrades = Array.from(this.activeTrades.values()).filter(t => t.userId === userId);
        if (userTrades.length >= 1) {
            return { success: false, reason: 'Maximum active trades reached (1 trade allowed)' };
        }

        // Simulate trade execution
        const entryPrice = price || 30000;
        const timestamp = new Date();
        const tradeQuantity = signal.quantity || quantity;

        // Use dynamic SL/TP from the signal
        const sl = signal.sl || (action === 'BUY' ? entryPrice - 100 : entryPrice + 100);
        const tp1 = signal.tp1 || (action === 'BUY' ? entryPrice + 300 : entryPrice - 300);
        const score = signal.score || 0;
        const notes = signal.notes || '';

        return new Promise((resolve) => {
            const self = this;
            // Log to database
            this.db.run(
                `INSERT INTO trades (userId, action, entry_price, quantity, timestamp, status, sl, tp1, score, notes, trade_type) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paper')`,
                [userId, action, entryPrice, tradeQuantity, timestamp.toISOString(), 'OPEN', sl, tp1, score, notes],
                function (err) {
                    if (err) {
                        console.error('Error logging trade to database:', err);
                        resolve({ success: false, error: err.message });
                        return;
                    }
                    
                    const tradeId = this.lastID;
                    const trade = {
                        id: tradeId,
                        userId,
                        action,
                        entry_price: entryPrice,
                        quantity: tradeQuantity,
                        timestamp,
                        status: 'OPEN',
                        sl, tp1, score, notes
                    };

                    // Add to active trades
                    self.activeTrades.set(tradeId, trade);

                    // Send alert
                    self._sendAlert(`[${userId}] Trade executed: ${action} ${quantity} BTC at $${entryPrice.toFixed(2)}`);

                    resolve({
                        success: true,
                        trade: trade,
                        message: `Trade executed: ${action} ${quantity} BTC at $${entryPrice.toFixed(2)}`
                    });
                }
            );
        });
    }

    /**
     * Monitor active trades for SL/TP hits
     * @param {number} currentPrice - Current market price
     */
    monitorTrades(currentPrice) {
        for (const [tradeId, trade] of this.activeTrades.entries()) {
            if (trade.status !== 'OPEN') continue;

            let exitPrice = null;
            let exitReason = '';

            // === TRAILING STOP LOSS LOGIC ===
            if (trade.action === 'BUY') {
                const unrealizedPnl = (currentPrice - trade.entry_price) * trade.quantity;
                
                // Trail SL aggressively as profit grows
                if (unrealizedPnl > 2.50 * 6) {
                    const trailed = trade.entry_price + (currentPrice - trade.entry_price) * 0.8;
                    trade.sl = Math.max(trade.sl, trailed);
                } else if (unrealizedPnl > 2.50 * 4) {
                    const trailed = trade.entry_price + (currentPrice - trade.entry_price) * 0.6;
                    trade.sl = Math.max(trade.sl, trailed);
                } else if (unrealizedPnl > 2.50 * 2.5) {
                    const breakevenPlus = trade.entry_price + (currentPrice - trade.entry_price) * 0.1;
                    trade.sl = Math.max(trade.sl, breakevenPlus);
                }

                if (currentPrice <= trade.sl) {
                    exitPrice = trade.sl;
                    exitReason = trade.sl >= trade.entry_price ? 'Trailing SL (Breakeven+)' : 'Stop Loss';
                } else if (currentPrice >= trade.tp1) {
                    exitPrice = currentPrice; // Take full wick
                    exitReason = 'Take Profit (Max)';
                }
            } else if (trade.action === 'SELL') {
                const unrealizedPnl = (trade.entry_price - currentPrice) * trade.quantity;
                
                // Trail SL aggressively
                if (unrealizedPnl > 2.50 * 6) {
                    const trailed = trade.entry_price - (trade.entry_price - currentPrice) * 0.8;
                    trade.sl = Math.min(trade.sl, trailed);
                } else if (unrealizedPnl > 2.50 * 4) {
                    const trailed = trade.entry_price - (trade.entry_price - currentPrice) * 0.6;
                    trade.sl = Math.min(trade.sl, trailed);
                } else if (unrealizedPnl > 2.50 * 2.5) {
                    const breakevenPlus = trade.entry_price - (trade.entry_price - currentPrice) * 0.1;
                    trade.sl = Math.min(trade.sl, breakevenPlus);
                }

                if (currentPrice >= trade.sl) {
                    exitPrice = trade.sl;
                    exitReason = trade.sl <= trade.entry_price ? 'Trailing SL (Breakeven+)' : 'Stop Loss';
                } else if (currentPrice <= trade.tp1) {
                    exitPrice = currentPrice;
                    exitReason = 'Take Profit (Max)';
                }
            }

            if (exitPrice !== null) {
                this._closeTrade(tradeId, exitPrice, exitReason);
            }
        }
    }

    /**
     * Close a trade and calculate PnL
     * @param {number} tradeId - Trade ID
     * @param {number} exitPrice - Exit price
     * @param {string} reason - Reason for closing
     */
    _closeTrade(tradeId, exitPrice, reason) {
        const trade = this.activeTrades.get(tradeId);
        if (!trade) return { success: false, reason: 'Trade not in memory' };

        // Calculate PnL
        let pnl = 0;
        if (trade.action === 'BUY') {
            pnl = (exitPrice - trade.entry_price) * trade.quantity;
        } else if (trade.action === 'SELL') {
            pnl = (trade.entry_price - exitPrice) * trade.quantity;
        }

        // Update trade object
        trade.exit_price = exitPrice;
        trade.pnl = pnl;
        trade.status = 'CLOSED';
        trade.exit_reason = reason;
        trade.exit_timestamp = new Date();

        const userId = trade.userId || 'default';

        // Update in database
        this.db.run(
            `UPDATE trades SET 
             exit_price = ?, 
             pnl = ?, 
             status = ?, 
             exit_reason = ?, 
             exit_timestamp = ?
             WHERE id = ?`,
            [exitPrice, pnl, 'CLOSED', reason, new Date().toISOString(), tradeId],
            (err) => {
                if (err) {
                    console.error('Error updating trade in database:', err);
                } else {
                    // Update user balance
                    this.db.get(`SELECT * FROM balance WHERE userId = ? ORDER BY timestamp DESC LIMIT 1`, [userId], (err, balance) => {
                        if (!err && balance) {
                            const newBalance = balance.usd_balance + pnl;
                            this.db.run(`INSERT INTO balance (userId, usd_balance, btc_balance) VALUES (?, ?, ?)`, 
                                [userId, newBalance, balance.btc_balance]);
                        } else if (!err && !balance) {
                            // Create initial balance if missing (100 starting)
                            const initialBalance = 100 + pnl;
                            this.db.run(`INSERT INTO balance (userId, usd_balance, btc_balance) VALUES (?, ?, ?)`, 
                                [userId, initialBalance, 0]);
                        }
                    });
                }
            }
        );

        // Remove from active trades
        this.activeTrades.delete(tradeId);

        // Log trade closure
        console.log(`Trade closed: ${trade.action} ${trade.quantity} BTC at $${exitPrice.toFixed(2)}. PnL: $${pnl.toFixed(2)}. Reason: ${reason}`);

        if (this.onTradeClosed) {
            this.onTradeClosed(trade);
        }

        // Send alert
        this._sendAlert(`Trade closed: ${trade.action} ${trade.quantity} BTC at $${exitPrice.toFixed(2)}. PnL: $${pnl.toFixed(2)}. Reason: ${reason}`);

        return {
            success: true,
            trade: trade,
            pnl: pnl,
            reason: reason
        };
    }

    /**
     * Get all trades from database
     * @param {number} limit - Maximum number of trades to return
     * @returns {Promise<Array>} Array of trades
     */
    getTrades(limit = 50) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?`,
                [limit],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows);
                    }
                }
            );
        });
    }

    /**
     * Get active trades
     * @returns {Array} Array of active trades
     */
    getActiveTrades() {
        return Array.from(this.activeTrades.values());
    }

    /**
     * Send alert via Telegram and Email
     * @param {string} message - Alert message
     */
    async _sendAlert(message) {
        console.log(`ALERT: ${message}`);
        
        // Telegram
        if (this.bot && process.env.TELEGRAM_CHAT_ID) {
            try {
                await this.bot.sendMessage({ chat_id: process.env.TELEGRAM_CHAT_ID, text: message });
            } catch (error) {
                console.error('Telegram error:', error);
            }
        }

        // Email - use the EmailService
        const EmailService = require('./emailService');
        if (EmailService && (process.env.EMAIL_RECIPIENT || process.env.NOTIFY_EMAIL)) {
            try {
                const trade = {
                    action: message.includes('BUY') ? 'BUY' : (message.includes('SELL') ? 'SELL' : 'INFO'),
                    entry_price: null,
                    quantity: 0.01,
                    timestamp: new Date()
                };
                await EmailService.sendTradeNotification(trade, message);
            } catch (error) {
                console.error('Email error:', error);
            }
        }
    }
    /**
     * Manually close a trade at the current market price
     * @param {number} tradeId - Trade ID
     * @param {number} exitPrice - Current market price
     * @returns {Promise<Object>} Closure result
     */
    async manualExitTrade(tradeId, exitPrice) {
        if (!this.activeTrades.has(tradeId)) {
            // Fallback: Check database if not in memory
            return new Promise((resolve) => {
                this.db.get("SELECT * FROM trades WHERE id = ? AND status = 'OPEN'", [tradeId], (err, row) => {
                    if (err || !row) {
                        resolve({ success: false, reason: 'Trade not found or already closed' });
                    } else {
                        // Add to memory temporarily to use _closeTrade logic
                        const trade = {
                            ...row,
                            timestamp: new Date(row.timestamp)
                        };
                        this.activeTrades.set(tradeId, trade);
                        resolve(this._closeTrade(tradeId, exitPrice, 'Manual Exit'));
                    }
                });
            });
        }
        return this._closeTrade(tradeId, exitPrice, 'Manual Exit');
    }
}

module.exports = ExecutionEngine;