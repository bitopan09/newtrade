const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');
const notificationService = require('./emailService');
const UnifiedStrategy = require('./unifiedStrategy');
const { UNIFIED_PRESET_CONFIG } = require('./strategyConfig');

dotenv.config();

const LOT_MIN_BTC = 0.01;
const LOT_MAX_BTC = 0.06;
const LOT_STEP_BTC = 0.01;

class ExecutionEngine {
    constructor(db) {
        // Use provided database for trade logging
        this.db = db;

        // Active trades tracking
        this.activeTrades = new Map();
        this.trailingStopAtrMultiplier = this._getNumberEnv('TRAILING_STOP_ATR_MULTIPLIER', 2);
        this.breakevenTriggerRr = this._getNumberEnv('BREAKEVEN_TRIGGER_RR', 1);
        this.trailingStartRr = this._getNumberEnv('TRAILING_START_RR', 1);
        this.lotMin = this._getNumberEnv('TRADING_MIN_BTC_QTY', LOT_MIN_BTC);
        this.lotMax = this._getNumberEnv('TRADING_MAX_BTC_QTY', LOT_MAX_BTC);
        this.lotStep = this._getNumberEnv('TRADING_LOT_STEP_BTC', LOT_STEP_BTC);
        this.strategy = new UnifiedStrategy();
    }

    _getNumberEnv(name, fallback) {
        const preset = String(process.env.STRATEGY_PRESET || 'unified').toLowerCase();
        const presetValue = UNIFIED_PRESET_CONFIG[name];
        if (preset === 'unified' && typeof presetValue === 'number') return presetValue;

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
                        this.activeTrades.set(row.id, this._normalizeTradeFields({
                            ...row,
                            timestamp: new Date(row.timestamp)
                        }));
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

        if (requestedQuantity < this.lotMin || requestedQuantity > this.lotMax) {
            return { success: false, reason: `Lot size must be between ${this.lotMin} and ${this.lotMax} BTC` };
        }

        const lotSteps = Math.round(requestedQuantity / this.lotStep);
        const decimals = Math.max(0, Math.min(8, (String(this.lotStep).split('.')[1] || '').length));
        const normalizedQuantity = parseFloat((lotSteps * this.lotStep).toFixed(decimals));
        if (Math.abs(requestedQuantity - normalizedQuantity) > 1e-9) {
            return { success: false, reason: `Lot size must align to ${this.lotStep} BTC steps` };
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
                        entryPrice,
                        quantity: tradeQuantity,
                        timestamp,
                        status: 'OPEN',
                        sl,
                        originalSl: signal.originalSl || sl,
                        tp1,
                        tp2,
                        partialTp: tp1,
                        finalTp: tp2,
                        score,
                        notes,
                        atr,
                        partialClosed: false
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
        if (!Number.isFinite(Number(currentPrice))) return;

        const marketCandle = {
            high: Number(currentPrice),
            low: Number(currentPrice),
            close: Number(currentPrice),
            price: Number(currentPrice)
        };

        for (const [tradeId, trade] of this.activeTrades.entries()) {
            if (trade.status !== 'OPEN') continue;

            const normalizedTrade = this._normalizeTradeFields(trade);
            if (!normalizedTrade) continue;

            const exitResult = this.strategy.checkTradeExit(normalizedTrade, marketCandle);

            if (exitResult?.partialClose) {
                const partialClosed = this._partialCloseTrade(tradeId, exitResult.exitPrice);
                if (!partialClosed) {
                    this._closeTrade(tradeId, exitResult.exitPrice, 'Partial TP (Full Close)');
                }
                continue;
            }

            if (exitResult?.closed) {
                this._closeTrade(tradeId, exitResult.exitPrice, exitResult.exitReason);
            }
        }
    }

    _normalizeTradeFields(trade) {
        if (!trade) return null;

        const entryPrice = Number(trade.entryPrice ?? trade.entry_price);
        trade.entryPrice = Number.isFinite(entryPrice) ? entryPrice : 0;
        trade.entry_price = trade.entry_price ?? trade.entryPrice;
        trade.originalSl = Number(trade.originalSl ?? trade.original_sl ?? trade.sl);
        trade.partialTp = Number(trade.partialTp ?? trade.tp1);
        trade.finalTp = trade.finalTp ?? trade.tp2 ?? null;
        trade.partialClosed = trade.partialClosed === true || trade.partial_closed === true || trade.partial_closed === 1;

        if (!Number.isFinite(Number(trade.atr))) {
            trade.atr = 500;
        }

        return trade;
    }

    _getPartialCloseQuantity(quantity) {
        const quantitySteps = Math.round(Number(quantity) / this.lotStep);
        const partialSteps = Math.floor(quantitySteps / 2);
        const partialQuantity = parseFloat((partialSteps * this.lotStep).toFixed(2));
        const remainingQuantity = parseFloat((Number(quantity) - partialQuantity).toFixed(2));

        if (partialQuantity < this.lotMin || remainingQuantity < this.lotMin) {
            return null;
        }

        return partialQuantity;
    }

    /**
     * Partially close a trade (50%)
     * @param {number} tradeId - Trade ID
     * @param {number} exitPrice - Exit price
     */
    _partialCloseTrade(tradeId, exitPrice) {
        const trade = this._normalizeTradeFields(this.activeTrades.get(tradeId));
        if (!trade) return false;

        const halfQty = this._getPartialCloseQuantity(trade.quantity);
        if (!halfQty) return false;

        let partialPnl = 0;
        if (trade.action === 'BUY') {
            partialPnl = (exitPrice - trade.entry_price) * halfQty;
        } else {
            partialPnl = (trade.entry_price - exitPrice) * halfQty;
        }

        trade.quantity = parseFloat((trade.quantity - halfQty).toFixed(2));
        trade.remainingQuantity = trade.quantity;
        trade.partialClosed = true;
        trade.partialPnl = (trade.partialPnl || 0) + partialPnl;
        trade.partialQuantity = (trade.partialQuantity || 0) + halfQty;
        trade.partialExitPrice = exitPrice;
        trade.partialExitTimestamp = new Date();

        const userId = trade.userId || 'default';

        // Update database (log partial trade if desired, or just update quantity)
        this.db.run(
            `UPDATE trades SET quantity = ? WHERE id = ? AND userId = ?`,
            [trade.quantity, tradeId, userId]
        );

        // Update balance
        this.db.get(`SELECT * FROM balance WHERE userId = ? ORDER BY timestamp DESC LIMIT 1`, [userId], (err, balance) => {
            if (!err && balance) {
                const newBalance = balance.usd_balance + partialPnl;
                this.db.run(`INSERT INTO balance (userId, usd_balance, btc_balance) VALUES (?, ?, ?)`, 
                    [userId, newBalance, balance.btc_balance]);
            }
        });

        this._sendAlert(`[${userId}] Partial TP Hit: ${trade.action} ${halfQty.toFixed(2)} BTC at $${exitPrice.toFixed(2)}. SL moved to BE.`);
        return true;
    }

    /**
     * Close a trade and calculate PnL
     * @param {number} tradeId - Trade ID
     * @param {number} exitPrice - Exit price
     * @param {string} reason - Reason for closing
     */
    _closeTrade(tradeId, exitPrice, reason) {
        const trade = this._normalizeTradeFields(this.activeTrades.get(tradeId));
        if (!trade) return { success: false, reason: 'Trade not in memory' };

        // Calculate PnL
        let finalPnl = 0;
        if (trade.action === 'BUY') {
            finalPnl = (exitPrice - trade.entry_price) * trade.quantity;
        } else if (trade.action === 'SELL') {
            finalPnl = (trade.entry_price - exitPrice) * trade.quantity;
        }

        const pnl = finalPnl + (trade.partialPnl || 0);

        // Update trade object
        trade.exit_price = exitPrice;
        trade.pnl = pnl;
        trade.finalPnl = finalPnl;
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
             WHERE id = ? AND userId = ?`,
            [exitPrice, pnl, 'CLOSED', reason, new Date().toISOString(), tradeId, userId],
            (err) => {
                if (err) {
                    console.error('Error updating trade in database:', err);
                } else {
                    // Update user balance
                    this.db.get(`SELECT * FROM balance WHERE userId = ? ORDER BY timestamp DESC LIMIT 1`, [userId], (err, balance) => {
                        if (!err && balance) {
                            const newBalance = balance.usd_balance + finalPnl;
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
     * Send alert via Telegram
     * @param {string} message - Alert message
     */
    async _sendAlert(message) {
        console.log(`ALERT: ${message}`);
        
        await notificationService.sendAlert('Execution Update', message, 'INFO');
    }
    /**
     * Manually close a trade at the current market price
     * @param {number} tradeId - Trade ID
     * @param {number} exitPrice - Current market price
     * @returns {Promise<Object>} Closure result
     */
    async manualExitTrade(tradeId, exitPrice, userId = 'default') {
        if (this.activeTrades.has(tradeId)) {
            const trade = this.activeTrades.get(tradeId);
            if (trade.userId !== userId) {
                return { success: false, reason: 'Trade not found for this terminal' };
            }
            return this._closeTrade(tradeId, exitPrice, 'Manual Exit');
        }

        if (!this.activeTrades.has(tradeId)) {
            // Fallback: Check database if not in memory
            return new Promise((resolve) => {
                this.db.get("SELECT * FROM trades WHERE id = ? AND userId = ? AND status = 'OPEN'", [tradeId, userId], (err, row) => {
                    if (err || !row) {
                        resolve({ success: false, reason: 'Trade not found for this terminal or already closed' });
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
    }
}

module.exports = ExecutionEngine;
