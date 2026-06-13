const sqlite3 = require('sqlite3').verbose();
const TelegramBot = require('telegram-bot-api');
const dotenv = require('dotenv');

dotenv.config();

const LOT_MIN_BTC = 0.01;
const LOT_MAX_BTC = 0.04;
const LOT_STEP_BTC = 0.01;

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
        this.trailingStopAtrMultiplier = this._getNumberEnv('TRAILING_STOP_ATR_MULTIPLIER', 2);
        this.breakevenTriggerRr = this._getNumberEnv('BREAKEVEN_TRIGGER_RR', 1);
        this.trailingStartRr = this._getNumberEnv('TRAILING_START_RR', 1);
    }

    _getNumberEnv(name, fallback) {
        const value = Number(process.env[name]);
        return Number.isFinite(value) ? value : fallback;
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
        const requestedQuantity = Number(signal.quantity ?? quantity);

        if (!Number.isFinite(requestedQuantity)) {
            return { success: false, reason: 'Invalid trade quantity' };
        }

        if (requestedQuantity < LOT_MIN_BTC || requestedQuantity > LOT_MAX_BTC) {
            return { success: false, reason: `Lot size must be between ${LOT_MIN_BTC} and ${LOT_MAX_BTC} BTC` };
        }

        const lotSteps = Math.round(requestedQuantity / LOT_STEP_BTC);
        const normalizedQuantity = parseFloat((lotSteps * LOT_STEP_BTC).toFixed(2));
        if (Math.abs(requestedQuantity - normalizedQuantity) > 1e-9) {
            return { success: false, reason: 'Lot size must be exactly one of 0.01, 0.02, 0.03, or 0.04 BTC' };
        }

        const tradeQuantity = normalizedQuantity;

        // Use dynamic SL/TP from the signal
        const sl = signal.sl || (action === 'BUY' ? entryPrice - 100 : entryPrice + 100);
        const tp1 = signal.partialTp || (action === 'BUY' ? entryPrice + 300 : entryPrice - 300);
        const tp2 = signal.finalTp || null;
        const score = signal.score || 0;
        const notes = signal.notes || '';
        const atr = signal.atr || 500;

        return new Promise((resolve) => {
            const self = this;
            // Log to database
            this.db.run(
                `INSERT INTO trades (userId, action, entry_price, quantity, timestamp, status, sl, tp1, tp2, score, notes, trade_type) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paper')`,
                [userId, action, entryPrice, tradeQuantity, timestamp.toISOString(), 'OPEN', sl, tp1, tp2, score, notes],
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
                        sl, originalSl: signal.originalSl || sl, tp1, tp2, score, notes, atr, partialClosed: false
                    };

                    // Add to active trades
                    self.activeTrades.set(tradeId, trade);

                    // Send alert
                    self._sendAlert(`[${userId}] Trade executed: ${action} ${tradeQuantity} BTC at $${entryPrice.toFixed(2)}`);

                    resolve({
                        success: true,
                        trade: trade,
                        message: `Trade executed: ${action} ${tradeQuantity} BTC at $${entryPrice.toFixed(2)}`
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

            // === TRAILING STOP LOSS & PARTIAL TP LOGIC ===
            if (trade.action === 'BUY') {
                // Partial TP Check
                if (!trade.partialClosed && currentPrice >= trade.tp1) {
                    this._partialCloseTrade(tradeId, trade.tp1);
                    continue; // Skip the rest this tick
                }

                if (trade.partialClosed && trade.tp2 && currentPrice >= trade.tp2) {
                    exitPrice = trade.tp2;
                    exitReason = 'Final TP';
                }

                // Chandelier Trailing Logic
                trade.highestPrice = Math.max(trade.highestPrice || trade.entry_price, currentPrice);
                const trailTrigger = trade.entry_price + ((trade.entry_price - (trade.originalSl || trade.sl)) * this.trailingStartRr);
                if (trade.highestPrice >= trailTrigger) {
                    const chandelierStop = trade.highestPrice - (trade.atr * this.trailingStopAtrMultiplier);
                    trade.sl = Math.max(trade.sl, chandelierStop);
                }

                const breakevenTrigger = trade.entry_price + ((trade.entry_price - (trade.originalSl || trade.sl)) * this.breakevenTriggerRr);
                if (trade.partialClosed || trade.highestPrice >= breakevenTrigger) {
                    trade.sl = Math.max(trade.sl, trade.entry_price);
                }

                if (exitPrice === null && currentPrice <= trade.sl) {
                    exitPrice = trade.sl;
                    exitReason = trade.sl >= trade.entry_price ? 'Trailing SL (Breakeven+)' : 'Stop Loss';
                }
            } else if (trade.action === 'SELL') {
                // Partial TP Check
                if (!trade.partialClosed && currentPrice <= trade.tp1) {
                    this._partialCloseTrade(tradeId, trade.tp1);
                    continue;
                }

                if (trade.partialClosed && trade.tp2 && currentPrice <= trade.tp2) {
                    exitPrice = trade.tp2;
                    exitReason = 'Final TP';
                }

                // Chandelier Trailing Logic
                trade.lowestPrice = Math.min(trade.lowestPrice || trade.entry_price, currentPrice);
                const trailTrigger = trade.entry_price - (((trade.originalSl || trade.sl) - trade.entry_price) * this.trailingStartRr);
                if (trade.lowestPrice <= trailTrigger) {
                    const chandelierStop = trade.lowestPrice + (trade.atr * this.trailingStopAtrMultiplier);
                    trade.sl = Math.min(trade.sl, chandelierStop);
                }

                const breakevenTrigger = trade.entry_price - (((trade.originalSl || trade.sl) - trade.entry_price) * this.breakevenTriggerRr);
                if (trade.partialClosed || trade.lowestPrice <= breakevenTrigger) {
                    trade.sl = Math.min(trade.sl, trade.entry_price);
                }

                if (exitPrice === null && currentPrice >= trade.sl) {
                    exitPrice = trade.sl;
                    exitReason = trade.sl <= trade.entry_price ? 'Trailing SL (Breakeven+)' : 'Stop Loss';
                }
            }

            if (exitPrice !== null) {
                this._closeTrade(tradeId, exitPrice, exitReason);
            }
        }
    }

    /**
     * Partially close a trade (50%)
     * @param {number} tradeId - Trade ID
     * @param {number} exitPrice - Exit price
     */
    _partialCloseTrade(tradeId, exitPrice) {
        const trade = this.activeTrades.get(tradeId);
        if (!trade) return;

        const halfQty = trade.quantity * 0.5;
        let partialPnl = 0;
        if (trade.action === 'BUY') {
            partialPnl = (exitPrice - trade.entry_price) * halfQty;
        } else {
            partialPnl = (trade.entry_price - exitPrice) * halfQty;
        }

        trade.quantity -= halfQty;
        trade.partialClosed = true;

        const userId = trade.userId || 'default';

        // Update database (log partial trade if desired, or just update quantity)
        this.db.run(
            `UPDATE trades SET quantity = ? WHERE id = ?`,
            [trade.quantity, tradeId]
        );

        // Update balance
        this.db.get(`SELECT * FROM balance WHERE userId = ? ORDER BY timestamp DESC LIMIT 1`, [userId], (err, balance) => {
            if (!err && balance) {
                const newBalance = balance.usd_balance + partialPnl;
                this.db.run(`INSERT INTO balance (userId, usd_balance, btc_balance) VALUES (?, ?, ?)`, 
                    [userId, newBalance, balance.btc_balance]);
            }
        });

        this._sendAlert(`[${userId}] Partial TP Hit: ${trade.action} ${halfQty} BTC at $${exitPrice.toFixed(2)}. SL moved to BE.`);
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
                            // Create initial balance if missing (50 starting)
                            const initialBalance = 50 + pnl;
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
