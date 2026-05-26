# 🤖 BTC Trading Bot - Advanced Dashboard

An intelligent, automated BTC/USD trading bot with a modern web dashboard, email notifications, and 24-hour continuous operation in IST timezone.

## ✨ Features

✅ **24/7 Bot Operation** - Runs continuously in IST timezone
✅ **Real-time Dashboard** - Live BTC price, trades, and balance tracking
✅ **Email Notifications** - Get alerts for every trade executed
✅ **IST Timezone Support** - All times displayed in Indian Standard Time
✅ **Trade Journal** - Comprehensive history with export to CSV
✅ **Live Chart** - Real-time BTC/USD price visualization
✅ **Backtester** - Test strategy on historical data
✅ **Docker Ready** - One-click deployment
✅ **Remote Access** - Deploy anywhere and access from any device
✅ **Manual Trading** - Execute trades manually when needed

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm
- Email account (Gmail recommended)

### Setup (2 minutes)

1. **Clone & Install**
```bash
git clone <repo-url>
cd newtrade
bash setup.sh
```

2. **Configure Email**
Edit `.env`:
```
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
NOTIFY_EMAIL=your-email@gmail.com
```

3. **Start Bot**
```bash
npm start
```

4. **Access Dashboard**
Open browser: `http://localhost:5001`

## 📊 Dashboard Features

### Bot Status
- Real-time bot status (Online/Offline)
- Daily trade count
- Last analysis timestamp (IST)

### Live Price Chart
- Real-time BTC/USD chart
- 50-point data visualization
- Current price display

### Balance Tracker
- USD balance
- BTC balance
- Total portfolio value

### Active Trades
- Live P&L updates
- Entry/Exit levels
- Stop Loss & Take Profit

### Trade Journal
- All trades with timestamps (IST)
- P&L calculation
- Export to CSV

### Manual Trading
- Execute Buy/Sell manually
- Configurable quantity
- Real-time feedback

## 📧 Email Notifications

Receive instant alerts when:
- ✉️ A trade is executed
- ✉️ Daily summary sent at midnight
- ✉️ Errors or warnings occur

### Setup Email

#### Gmail
1. Go to https://myaccount.google.com/apppasswords
2. Select "Mail" and "Windows Computer"
3. Copy the 16-character password
4. Add to `.env`:
```
EMAIL_USER=your@gmail.com
EMAIL_PASSWORD=<16-char-app-password>
```

#### Other Email Services
Edit `.env`:
```
EMAIL_SERVICE=outlook|yahoo|etc
EMAIL_USER=your-email@service.com
EMAIL_PASSWORD=your-password
```

## 🐳 Docker Deployment

### Quick Deploy
```bash
docker-compose up -d
```

### Access
- Dashboard: http://localhost:5001
- Logs: `docker-compose logs -f trading-bot`

## ☁️ Cloud Deployment

### Heroku
```bash
heroku create trading-bot
heroku config:set EMAIL_USER=your@gmail.com
heroku config:set EMAIL_PASSWORD=app-password
heroku config:set NOTIFY_EMAIL=your@gmail.com
git push heroku main
```

### AWS/DigitalOcean/Azure
See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed instructions.

## ⚙️ Configuration

### .env Options

```ini
# Server
PORT=5001
NODE_ENV=production

# Email
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=app-password
NOTIFY_EMAIL=recipient@gmail.com

# Bot
BOT_ENABLED=true
DAILY_TRADE_LIMIT=1
BOT_START_HOUR=0
BOT_END_HOUR=23

# Notifications
SEND_EMAIL_ON_TRADE=true
SEND_DAILY_SUMMARY=true
SEND_ERROR_ALERTS=true

# Timezone (always IST for this bot)
TIMEZONE=Asia/Kolkata
```

## 📊 API Endpoints

```bash
# Bot Status
GET /api/bot/status

# Get Current Price
GET /api/price

# Get Trades
GET /api/trades
GET /api/trades/active

# Manual Trade
POST /api/manual-trade
  { "action": "BUY", "quantity": 0.01 }

# Email Status
GET /api/email/status

# Test Email
POST /api/email/test

# Export Trades
GET /api/trades/export
```

## 🔧 Development

### Project Structure
```
newtrade/
├── backend/
│   ├── server.js              # Main server
│   ├── tradingBot.js          # Bot core
│   ├── analysisEngine.js      # Trading logic
│   ├── decisionEngine.js      # Signal generation
│   ├── executionEngine.js     # Trade execution
│   └── emailService.js        # Email notifications ✨ NEW
├── frontend/
│   └── src/
│       ├── components/        # UI components
│       ├── utils/
│       │   └── timeFormatter.js # IST formatting ✨ NEW
│       └── services/
│           └── api.js         # API calls
└── docker-compose.yml         # Docker setup ✨ NEW
```

### Running Locally
```bash
# Terminal 1: Backend
npm run dev:backend

# Terminal 2: Frontend
npm run dev:frontend
```

## 📈 Trading Logic

- **Strategy**: Advanced 10-Factor Confluence Scoring (EMA, RSI, MACD, CPR, VWAP, Wyckoff, etc.)
- **Timeframe**: 6-hour candles
- **Position Sizing**: Dynamic Tiered Risk Management (Risk 10% of base equity, starting at a $50 baseline, scaling up automatically when equity doubles).
- **Risk Management**: Smart Stop Loss (Liquidity/CPR/ATR) & Progressive Trailing Stop (Break-even at 2.5R).
- **Hours**: Active Session Time Gate from 8:00 AM to 4:00 PM UTC (1:30 PM to 9:30 PM IST).

## ⚠️ Disclaimer

- **Simulated Trading**: Current implementation uses simulated prices
- **Not Financial Advice**: Use at your own risk
- **Paper Trading**: Test thoroughly before using real money
- **Monitor Actively**: Always monitor bot performance

## 🐛 Troubleshooting

### Emails not sending?
```bash
# Check email status
curl http://localhost:5001/api/email/status

# Send test email
curl -X POST http://localhost:5001/api/email/test
```

### Bot not starting?
```bash
# Check logs
docker-compose logs trading-bot

# Or run locally
npm start
```

### Database issues?
```bash
# Reset database
rm trading.db
docker-compose restart
```

## 📚 Documentation

- [Deployment Guide](DEPLOYMENT.md) - Detailed deployment instructions
- [Architecture](docs/architecture.md) - System design
- [API Reference](docs/api.md) - Complete API docs

## 🤝 Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Submit a pull request

## 📄 License

MIT License - See LICENSE file

## 📧 Support

For issues or questions:
1. Check [DEPLOYMENT.md](DEPLOYMENT.md)
2. Review logs: `docker-compose logs -f`
3. Test email: `curl -X POST http://localhost:5001/api/email/test`

---

**Last Updated**: May 2026
**Timezone**: Asia/Kolkata (IST) ✅
**Status**: Production Ready ✅
**Features**: 24/7 Operation, Email Alerts, IST Support ✅
