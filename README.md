# 🤖 BTC Trading Bot - Advanced Dashboard

An intelligent BTC/USD paper trading bot with a modern web dashboard, Telegram notifications, and 24-hour continuous operation in IST timezone.

## ✨ Features

✅ **24/7 Bot Operation** - Runs continuously in IST timezone
✅ **Real-time Dashboard** - Live BTC price, trades, and balance tracking
✅ **Telegram Notifications** - Get alerts for every trade executed
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
- Telegram bot token from BotFather

### Setup (2 minutes)

1. **Clone & Install**
```bash
git clone <repo-url>
cd newtrade
bash setup.sh
```

2. **Configure Telegram**
Edit `.env`:
```
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=your-telegram-chat-id
SEND_TELEGRAM_ON_TRADE=true
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

## Telegram Notifications

Receive instant alerts when:
- A trade is executed
- Daily summary sent at midnight
- Errors or warnings occur

### Setup Telegram

1. Create a bot with BotFather.
2. Add the token to `.env` or Railway Variables.
3. Open your bot chat and send `/start`.
4. Call `POST /api/telegram/verify` to discover `TELEGRAM_CHAT_ID` if needed.
5. Add the chat ID and redeploy.

Required variables:
```
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=your-telegram-chat-id
SEND_TELEGRAM_ON_TRADE=true
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
heroku config:set TELEGRAM_BOT_TOKEN=your-telegram-bot-token
heroku config:set TELEGRAM_CHAT_ID=your-telegram-chat-id
heroku config:set SEND_TELEGRAM_ON_TRADE=true
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

# Telegram
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=your-telegram-chat-id

# Bot
BOT_ENABLED=true
DAILY_TRADE_LIMIT=1
BOT_START_HOUR=0
BOT_END_HOUR=23

# Notifications
SEND_TELEGRAM_ON_TRADE=true
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

# Telegram Status
GET /api/telegram/status

# Test Telegram
POST /api/telegram/test

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
│   └── emailService.js        # Telegram notifications
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

### Local Backtests
```bash
# Runs the same unified logic used by the live bot
node improved_backtest_cpr.js 90
```

The backtester uses the same closed-candle signal logic, realistic lifecycle accounting, and risk settings as the bot.

## 📈 Trading Logic

- **Strategy**: Advanced 10-Factor Confluence Scoring (EMA, RSI, MACD, CPR, VWAP, Wyckoff, etc.)
- **Timeframe**: 6-hour candles
- **Position Sizing**: Confluence-scaled, two-decimal BTC lots only: `0.01` through `0.08 BTC`; scores `8+` target larger lots while risk guards still cap oversized stops.
- **Risk Management**: Smart Stop Loss, partial TP, final TP, and trailing stop logic.
- **Hours**: Configurable session gate. Current defaults allow 24-hour analysis.

## ⚠️ Disclaimer

- **Paper Trading**: Current implementation logs paper trades; it does not place real exchange orders
- **Not Financial Advice**: Use at your own risk
- **Paper Trading**: Test thoroughly before using real money
- **Monitor Actively**: Always monitor bot performance

## 🐛 Troubleshooting

### Telegram alerts not sending?
```bash
# Check Telegram status
curl http://localhost:5001/api/telegram/status

# Verify bot/chat
curl -X POST http://localhost:5001/api/telegram/verify

# Send test alert
curl -X POST http://localhost:5001/api/telegram/test
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
3. Test Telegram: `curl -X POST http://localhost:5001/api/telegram/test`

---

**Last Updated**: May 2026
**Timezone**: Asia/Kolkata (IST) ✅
**Status**: Production Ready ✅
**Features**: 24/7 Operation, Telegram Alerts, IST Support ✅
