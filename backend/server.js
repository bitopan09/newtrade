const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const TelegramBot = require('telegram-bot-api');
const schedule = require('node-schedule');
const TradingBot = require('./tradingBot');
const emailService = require('./emailService');

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// SQLite database setup
const db = new sqlite3.Database('./trading.db', (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connected to the SQLite database.');
});

// Initialize trading bot and pass DB instance
const tradingBot = new TradingBot(db);

// Create tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    symbol TEXT,
    price REAL,
    volume REAL
  )`);

    db.run(`CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT DEFAULT 'default',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    action TEXT,
    entry_price REAL,
    exit_price REAL,
    quantity REAL,
    pnl REAL,
    score INTEGER,
    notes TEXT,
    status TEXT DEFAULT 'OPEN',
    sl REAL,
    tp1 REAL,
    tp2 REAL,
    exit_reason TEXT,
    exit_timestamp DATETIME,
    trade_type TEXT DEFAULT 'live'
  )`);

    db.run(`CREATE TABLE IF NOT EXISTS balance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT DEFAULT 'default',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    usd_balance REAL,
    btc_balance REAL
  )`);

    db.run(`CREATE TABLE IF NOT EXISTS signal_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    source TEXT DEFAULT 'live',
    action TEXT,
    score INTEGER,
    price REAL,
    reason TEXT,
    details TEXT
  )`);

    db.run(`CREATE TABLE IF NOT EXISTS backtest_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT DEFAULT 'default',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    days INTEGER,
    strategy TEXT,
    config_json TEXT,
    summary_json TEXT,
    result_json TEXT,
    data_source TEXT,
    candles_used INTEGER,
    total_trades INTEGER,
    win_rate REAL,
    profit_factor REAL,
    max_drawdown REAL,
    total_return REAL,
    final_equity REAL
  )`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_signal_logs_timestamp ON signal_logs(timestamp)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_trades_user_timestamp ON trades(userId, timestamp)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_prices_timestamp ON prices(timestamp)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_backtest_results_user_timestamp ON backtest_results(userId, timestamp)`);

    // Initialize balance for default user if needed
    db.get(`SELECT COUNT(*) as count FROM balance WHERE userId = 'default'`, [], (err, row) => {
        if (!err && row.count === 0) {
            db.run(`INSERT INTO balance (userId, usd_balance, btc_balance) VALUES ('default', 50, 0)`);
        }
    });

    // Load active trades into memory
    tradingBot.executionEngine.loadOpenTrades();
});

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('Client connected to WebSocket');

    ws.on('message', (message) => {
        console.log(`Received message: ${message}`);

        // Echo back price data to client
        try {
            const data = JSON.parse(message);
            if (data.type === 'get_price') {
                db.get(`SELECT * FROM prices ORDER BY timestamp DESC LIMIT 1`, [], (err, row) => {
                    if (!err && row) {
                        ws.send(JSON.stringify({
                            type: 'price_update',
                            data: row
                        }));
                    }
                });
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected from WebSocket');
    });
});

function safeJson(value) {
    try {
        return JSON.stringify(value || {});
    } catch (error) {
        return JSON.stringify({ error: 'Could not serialize value' });
    }
}

function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildBacktestSummary(result) {
    return {
        totalTrades: result.totalTrades || 0,
        winRate: result.winRate || 0,
        profitFactor: result.profitFactor || 0,
        maxDrawdown: result.maxDrawdown || 0,
        sharpeRatio: result.sharpeRatio || 0,
        totalReturn: result.totalReturn || 0,
        finalEquity: result.finalEquity || 0,
        totalFees: result.totalFees || 0,
        totalSlippageCost: result.totalSlippageCost || 0,
        expectancy: result.expectancy || 0,
        averageRMultiple: result.averageRMultiple || 0,
        longestLosingStreak: result.longestLosingStreak || 0,
        skippedSignals: result.skippedSignals || 0,
        dataSource: result.dataSource || 'unknown',
        candlesUsed: result.candlesUsed || 0
    };
}

function saveBacktestResult({ userId = 'default', days, strategy, config, result }) {
    const summary = buildBacktestSummary(result);
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO backtest_results (
                userId, days, strategy, config_json, summary_json, result_json,
                data_source, candles_used, total_trades, win_rate, profit_factor,
                max_drawdown, total_return, final_equity
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                days,
                strategy,
                safeJson(config),
                safeJson(summary),
                safeJson(result),
                result.dataSource || 'unknown',
                result.candlesUsed || 0,
                result.totalTrades || 0,
                result.winRate || 0,
                result.profitFactor || 0,
                result.maxDrawdown || 0,
                result.totalReturn || 0,
                result.finalEquity || 0
            ],
            function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            }
        );
    });
}

function buildBacktestCsv(result, label = 'Backtest Results') {
    const summary = buildBacktestSummary(result);
    let csv = `${csvEscape(label)}\n`;
    csv += 'Metric,Value\n';
    Object.entries(summary).forEach(([key, value]) => {
        csv += `${csvEscape(key)},${csvEscape(value)}\n`;
    });

    if (result.skippedReasons && Object.keys(result.skippedReasons).length > 0) {
        csv += '\nSkipped Reasons\nReason,Count\n';
        Object.entries(result.skippedReasons).forEach(([reason, count]) => {
            csv += `${csvEscape(reason)},${csvEscape(count)}\n`;
        });
    }

    if (Array.isArray(result.equityCurve)) {
        csv += '\nEquity Curve\nDay,Timestamp,Equity\n';
        result.equityCurve.forEach(point => {
            csv += `${csvEscape(point.day)},${csvEscape(point.timestamp || '')},${csvEscape(Number(point.equity || 0).toFixed(2))}\n`;
        });
    }

    if (Array.isArray(result.trades) && result.trades.length > 0) {
        csv += '\nIndividual Trades\n';
        csv += 'ID,Entry Timestamp,Exit Timestamp,Action,Quantity,Entry Price,Exit Price,SL,Original SL,TP1,TP2,PnL,Fees,Risk Amount,Actual Risk,Score,Confluence,Exit Reason\n';
        result.trades.forEach(trade => {
            csv += [
                trade.id,
                trade.entryTimestamp || trade.timestamp || '',
                trade.exitTimestamp || '',
                trade.action || '',
                trade.quantity || '',
                trade.entryPrice || '',
                trade.exitPrice || '',
                trade.sl || '',
                trade.originalSl || '',
                trade.tp1 || '',
                trade.tp2 || '',
                trade.pnl || '',
                trade.fees || '',
                trade.riskAmount || '',
                trade.actualRisk || '',
                trade.score || '',
                trade.confluence || '',
                trade.exitReason || ''
            ].map(csvEscape).join(',') + '\n';
        });
    }

    return csv;
}

function parseBacktestRow(row) {
    const parse = (value, fallback) => {
        try {
            return value ? JSON.parse(value) : fallback;
        } catch (error) {
            return fallback;
        }
    };

    return {
        ...row,
        config: parse(row.config_json, {}),
        summary: parse(row.summary_json, {}),
        result: parse(row.result_json, {})
    };
}

async function fetchCoinbaseCandles({ limit = 100, granularity = 21600 } = {}) {
    const allowedGranularities = new Set([60, 300, 900, 3600, 21600, 86400]);
    const safeGranularity = allowedGranularities.has(Number(granularity)) ? Number(granularity) : 21600;
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 300);
    const end = Math.floor(Date.now() / 1000);
    const start = end - (safeLimit * safeGranularity);

    const response = await fetch(`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${safeGranularity}&start=${start}&end=${end}`, {
        headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`Coinbase candles request failed: ${response.status}`);
    }

    const json = await response.json();
    if (!Array.isArray(json) || json.length === 0) {
        throw new Error('Coinbase returned no candle data');
    }

    return json.map(candle => ({
        timestamp: new Date(candle[0] * 1000).toISOString(),
        low: Number(candle[1]),
        high: Number(candle[2]),
        open: Number(candle[3]),
        close: Number(candle[4]),
        volume: Number(candle[5]),
        source: 'Coinbase',
        granularity: safeGranularity
    })).reverse();
}

// REST API endpoints
app.get('/api/health', (req, res) => {
    db.get('SELECT 1 as ok', [], (err, row) => {
        res.status(err ? 500 : 200).json({
            status: err ? 'error' : 'ok',
            timestamp: new Date().toISOString(),
            database: row?.ok === 1 ? 'ok' : 'error',
            botRunning: tradingBot.isRunning,
            activeTrades: tradingBot.executionEngine.activeTrades.size
        });
    });
});

app.get('/api/price', (req, res) => {
    // Get latest price from database
    db.get(`SELECT * FROM prices ORDER BY timestamp DESC LIMIT 1`, [], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(row || {});
    });
});

app.get('/api/prices', (req, res) => {
    // Get historical prices
    const limit = req.query.limit || 100;
    db.all(`SELECT * FROM prices ORDER BY timestamp DESC LIMIT ?`, [limit], [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.get('/api/candles', async (req, res) => {
    try {
        const candles = await fetchCoinbaseCandles({
            limit: req.query.limit,
            granularity: req.query.granularity
        });

        res.json({ source: 'Coinbase', candles });
    } catch (error) {
        res.status(502).json({ error: error.message });
    }
});

app.get('/api/balance', (req, res) => {
    // Get latest balance for user
    const userId = req.query.userId || 'default';
    db.get(`SELECT * FROM balance WHERE userId = ? ORDER BY timestamp DESC LIMIT 1`, [userId], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        // Create default balance for new users
        if (!row) {
            db.run(`INSERT INTO balance (userId, usd_balance, btc_balance) VALUES (?, 50, 0)`, [userId], function() {
                res.json({ userId, usd_balance: 50, btc_balance: 0, id: this.lastID });
            });
        } else {
            res.json(row || {});
        }
    });
});

app.get('/api/trades', (req, res) => {
    // Get trade history for user and automated bot
    const limit = req.query.limit || 50;
    const userId = req.query.userId || 'default';
    db.all(`SELECT * FROM trades WHERE userId = ? OR userId = 'default' ORDER BY timestamp DESC LIMIT ?`, [userId, limit], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.get('/api/trades/active', (req, res) => {
    // Get active trades for user and automated bot
    const userId = req.query.userId || 'default';
    db.all(`SELECT * FROM trades WHERE (userId = ? OR userId = 'default') AND status = 'OPEN' ORDER BY timestamp DESC`, [userId], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.get('/api/signals', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
    db.all(`SELECT * FROM signal_logs ORDER BY timestamp DESC LIMIT ?`, [limit], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        res.json(rows.map(row => {
            let details = null;
            if (row.details) {
                try {
                    details = JSON.parse(row.details);
                } catch (error) {
                    details = { raw: row.details };
                }
            }

            return { ...row, details };
        }));
    });
});

app.post('/api/trades', (req, res) => {
    // Record a new trade for user
    const { action, entry_price, exit_price, quantity, pnl, score, notes, userId } = req.body;
    const user = userId || 'default';

    db.run(
        `INSERT INTO trades (userId, action, entry_price, exit_price, quantity, pnl, score, notes, trade_type) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paper')`,
        [user, action, entry_price, exit_price, quantity, pnl, score, notes],
        function (err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            // Update user balance
            db.get(`SELECT * FROM balance WHERE userId = ? ORDER BY timestamp DESC LIMIT 1`, [user], (err, balance) => {
                if (!err && balance) {
                    const newBalance = balance.usd_balance + (pnl || 0);
                    db.run(`INSERT INTO balance (userId, usd_balance, btc_balance) VALUES (?, ?, ?)`, 
                        [user, newBalance, balance.btc_balance]);
                }
            });
            res.json({ id: this.lastID, message: 'Trade recorded successfully' });
        }
    );
});

// Trading bot control endpoints
app.post('/api/bot/start', (req, res) => {
    tradingBot.start();
    res.json({ message: 'Trading bot started' });
});

app.post('/api/bot/stop', (req, res) => {
    tradingBot.stop();
    res.json({ message: 'Trading bot stopped' });
});

app.get('/api/bot/status', async (req, res) => {
    try {
        const status = tradingBot.getStatus();
        const recentTrades = await tradingBot.getRecentTrades(5);
        
        // Get today's trade if it exists
        const today = new Date().toISOString().split('T')[0];
        db.get("SELECT * FROM trades WHERE timestamp LIKE ? LIMIT 1", [`${today}%`], (err, row) => {
            res.json({
                bot: status,
                recentTrades: recentTrades,
                todayTrade: row || null
            });
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/backtest', async (req, res) => {
    try {
        const { days, strategy, config, userId } = req.body;
        const runDays = parseInt(days || 90, 10);
        const runStrategy = strategy || 'confluence_scoring';
        const runConfig = config || {};
        const user = userId || 'default';
        
        console.log(`Running backtest for ${runDays} days using ${runStrategy} strategy...`);

        const results = await tradingBot.runBacktest(runDays, runStrategy, runConfig);
        const runId = await saveBacktestResult({ userId: user, days: runDays, strategy: runStrategy, config: runConfig, result: results });

        res.json({ ...results, runId, saved: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/backtest/results', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    const userId = req.query.userId || 'default';
    db.all(
        `SELECT id, userId, timestamp, days, strategy, data_source, candles_used, total_trades, win_rate, profit_factor, max_drawdown, total_return, final_equity, config_json, summary_json
         FROM backtest_results
         WHERE userId = ? OR userId = 'default'
         ORDER BY timestamp DESC
         LIMIT ?`,
        [userId, limit],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows.map(parseBacktestRow).map(({ result_json, ...row }) => row));
        }
    );
});

app.get('/api/backtest/results/:id', (req, res) => {
    db.get(`SELECT * FROM backtest_results WHERE id = ?`, [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Backtest result not found' });
        res.json(parseBacktestRow(row));
    });
});

app.get('/api/backtest/results/:id/export', (req, res) => {
    db.get(`SELECT * FROM backtest_results WHERE id = ?`, [req.params.id], (err, row) => {
        if (err) return res.status(500).send('Error fetching backtest result');
        if (!row) return res.status(404).send('Backtest result not found');

        const parsed = parseBacktestRow(row);
        const csv = buildBacktestCsv(parsed.result, `Backtest Run ${parsed.id}`);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=backtest_run_${parsed.id}.csv`);
        res.send(csv);
    });
});

app.post('/api/backtest/walk-forward', async (req, res) => {
    try {
        const { days, strategy, config, folds } = req.body;
        const results = await tradingBot.runWalkForwardBacktest(days || 180, strategy || 'confluence_scoring', config || {}, folds || 3);
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/backtest/optimize', async (req, res) => {
    try {
        const { days, strategy } = req.body;

        console.log(`Running optimization backtest for ${days || 90} days using ${strategy || 'confluence_scoring'} strategy...`);

        const results = await tradingBot.optimizeBacktest(days || 90, strategy || 'confluence_scoring');
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Manual Trading endpoint (Paper Trading for users)
app.post('/api/manual-trade', async (req, res) => {
    try {
        const { action, quantity, userId } = req.body;
        const user = userId || 'default';
        
        // Get current price
        db.get('SELECT price FROM prices ORDER BY timestamp DESC LIMIT 1', async (err, row) => {
            if (err || !row) {
                return res.status(500).json({ error: 'Could not get current price' });
            }
            
            const signal = { action: action.toUpperCase(), price: row.price };
            const result = await tradingBot.executionEngine.executeTrade(signal, quantity || 0.01, user);
            
            if (result.success) {
                res.json(result);
            } else {
                res.status(400).json(result);
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Close Trade endpoint
app.post('/api/trades/:id/close', async (req, res) => {
    try {
        const tradeId = parseInt(req.params.id);
        
        // Get current price
        db.get('SELECT price FROM prices ORDER BY timestamp DESC LIMIT 1', async (err, row) => {
            if (err || !row) {
                return res.status(500).json({ error: 'Could not get current price' });
            }
            
            const result = await tradingBot.executionEngine.manualExitTrade(tradeId, row.price);
            
            if (result.success) {
                res.json(result);
            } else {
                res.status(400).json(result);
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// CSV Export endpoint
app.get('/api/trades/export', (req, res) => {
    const userId = req.query.userId || 'default';
    db.all(`SELECT * FROM trades WHERE userId = ? OR userId = 'default' ORDER BY timestamp DESC`, [userId], (err, rows) => {
        if (err) {
            return res.status(500).send('Error fetching trades');
        }
        
        if (rows.length === 0) {
            return res.status(404).send('No trades to export');
        }
        
        // Create CSV header
        const headers = ['ID', 'Date', 'Action', 'Entry Price', 'Exit Price', 'Quantity', 'Stop Loss', 'Take Profit 1', 'Take Profit 2', 'Status', 'P&L', 'Notes'];
        let csv = headers.join(',') + '\n';
        
        // Add rows
        rows.forEach(row => {
            const cols = [
                row.id,
                row.timestamp,
                row.action,
                row.entry_price || '',
                row.exit_price || '',
                row.quantity || '',
                row.sl || '',
                row.tp1 || '',
                row.tp2 || '',
                row.status || '',
                row.pnl || '',
                (row.notes || '').replace(/,/g, ' ') // Avoid breaking CSV formatting
            ];
            csv += cols.join(',') + '\n';
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=trade_journal.csv');
        res.send(csv);
    });
});

// Connect to real-time Coinbase WebSocket
const connectCoinbaseWebSocket = () => {
    const coinbaseWs = new WebSocket('wss://ws-feed.exchange.coinbase.com');
    let lastDbInsert = Date.now();

    coinbaseWs.on('open', () => {
        console.log('Connected to Coinbase WebSocket');
        // Subscribe to BTC-USD ticker
        coinbaseWs.send(JSON.stringify({
            type: 'subscribe',
            product_ids: ['BTC-USD'],
            channels: ['ticker']
        }));
    });

    coinbaseWs.on('message', (data) => {
        try {
            const ticker = JSON.parse(data);
            if (ticker.type !== 'ticker') return;

            const price = parseFloat(ticker.price);
            const volume = parseFloat(ticker.last_size || 0);
            const timestamp = new Date(ticker.time).toISOString();
            
            const priceData = {
                symbol: 'BTCUSD',
                price: price,
                volume: volume,
                timestamp: timestamp
            };

            // Broadcast to frontend
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'price',
                        data: priceData
                    }));
                }
            });

            // Throttle database inserts
            if (Date.now() - lastDbInsert >= 1000) {
                db.run(
                    `INSERT INTO prices (symbol, price, volume) VALUES (?, ?, ?)`,
                    ['BTCUSD', price, volume],
                    (err) => { if (err) console.error('Error inserting price:', err); }
                );
                lastDbInsert = Date.now();
            }
        } catch (err) {
            console.error('Error parsing Coinbase data:', err);
        }
    });

    coinbaseWs.on('close', () => {
        console.log('Coinbase WebSocket closed, reconnecting...');
        setTimeout(connectCoinbaseWebSocket, 5000);
    });

    coinbaseWs.on('error', (err) => {
        console.error('Coinbase WebSocket error:', err);
    });
};

connectCoinbaseWebSocket();

// Telegram bot setup (placeholder)
let bot;
if (process.env.TELEGRAM_BOT_TOKEN) {
    bot = new TelegramBot({
        token: process.env.TELEGRAM_BOT_TOKEN,
    });

    bot.getMe().then((me) => {
        console.log(`Telegram bot started: @${me.username}`);
    }).catch((err) => {
        console.error('Error starting Telegram bot:', err);
    });
}

// Function to send Telegram alert
const sendTelegramAlert = (message) => {
    if (bot && process.env.TELEGRAM_CHAT_ID) {
        bot.sendMessage({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: message
        }).catch((err) => {
            console.error('Error sending Telegram message:', err);
        });
    }
};

// Schedule daily tasks
schedule.scheduleJob('0 0 * * *', () => {
    // Reset daily trade lock at midnight (IST)
    console.log('[' + new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + '] Daily trade lock reset');
    
    // Send daily summary at midnight
    if (process.env.SEND_DAILY_SUMMARY === 'true') {
        const today = new Date().toISOString().split('T')[0];
        db.all("SELECT * FROM trades WHERE timestamp LIKE ? AND status = 'CLOSED'", [`${today}%`], (err, rows) => {
            if (rows && rows.length > 0) {
                const wins = rows.filter(t => t.pnl > 0);
                const summary = {
                    tradesExecuted: rows.length,
                    winningTrades: wins.length,
                    losingTrades: rows.length - wins.length,
                    totalPnL: rows.reduce((sum, t) => sum + (t.pnl || 0), 0)
                };
                emailService.sendDailySummary(summary);
            }
        });
    }
    
    sendTelegramAlert('Daily trade lock reset - new trading day started');
});

// Email notification endpoint
app.post('/api/email/test', async (req, res) => {
    try {
        const result = await emailService.sendAlert(
            'Test Email from Trading Bot',
            'This is a test email to verify your email configuration is working correctly.',
            'INFO'
        );
        res.json({ success: result, message: result ? 'Test email sent successfully' : 'Failed to send test email' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Email configuration endpoint
app.get('/api/email/status', (req, res) => {
    res.json({
        configured: emailService.initialized,
        sendOnTrade: process.env.SEND_EMAIL_ON_TRADE === 'true',
        sendDailySummary: process.env.SEND_DAILY_SUMMARY === 'true',
        notificationEmail: process.env.NOTIFY_EMAIL || process.env.EMAIL_USER || 'Not configured'
    });
});

// Fallback to serve React's index.html for any unknown routes
app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

const PORT = process.env.PORT || 5001;
const server_instance = server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Trading Bot Server Started`);
    console.log(`Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
    console.log(`Port: ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Email Service: ${emailService.initialized ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`${'='.repeat(60)}\n`);
    
    // Auto-start the trading bot (24-hour operation)
    if (process.env.BOT_ENABLED !== 'false') {
        setTimeout(() => {
            console.log('[AUTO-START] Starting trading bot for 24-hour operation...');
            tradingBot.start();
            console.log('[AUTO-START] Trading bot is now running!');
            
            // Send startup notification
            if (emailService.initialized && process.env.SEND_ERROR_ALERTS === 'true') {
                emailService.sendAlert(
                    'Trading Bot Started',
                    `The trading bot has started and will operate 24 hours in IST timezone.\n\nServer Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
                    'INFO'
                );
            }
        }, 2000);
    }

    // Keep-alive self-ping for Render free tier (prevents sleep after 15 min)
    if (process.env.RENDER_EXTERNAL_URL || process.env.KEEP_ALIVE === 'true') {
        const pingUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
        setInterval(() => {
            fetch(`${pingUrl}/api/price`).catch(() => {});
        }, 14 * 60 * 1000); // Ping every 14 minutes
        console.log('[KEEP-ALIVE] Self-ping enabled (every 14 min)');
    }
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[SHUTDOWN] Shutting down gracefully...');
    tradingBot.stop();
    server_instance.close(() => {
        console.log('[SHUTDOWN] Server closed');
        process.exit(0);
    });
    
    // Force shutdown after 10 seconds
    setTimeout(() => {
        console.error('[SHUTDOWN] Forced exit due to timeout');
        process.exit(1);
    }, 10000);
});

module.exports = { app, server, wss };
