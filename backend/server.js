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

    // Initialize balance for default user if needed
    db.get(`SELECT COUNT(*) as count FROM balance WHERE userId = 'default'`, [], (err, row) => {
        if (!err && row.count === 0) {
            db.run(`INSERT INTO balance (userId, usd_balance, btc_balance) VALUES ('default', 100, 0)`);
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

// REST API endpoints
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
            db.run(`INSERT INTO balance (userId, usd_balance, btc_balance) VALUES (?, 100, 0)`, [userId], function() {
                res.json({ userId, usd_balance: 100, btc_balance: 0, id: this.lastID });
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

// Backtest endpoint using real data from Binance
app.post('/api/backtest', async (req, res) => {
    try {
        const { days, strategy, userId } = req.body;
        
        console.log(`Running backtest for ${days} days using ${strategy} strategy...`);

        // This is a placeholder for real backtesting logic
        // In a real implementation, you would:
        // 1. Fetch historical data for the requested period
        // 2. Run the strategy against this data
        // 3. Calculate performance metrics

        const results = await tradingBot.runBacktest(days, strategy);
        
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
                    totalPnl: rows.reduce((sum, t) => sum + (t.pnl || 0), 0)
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