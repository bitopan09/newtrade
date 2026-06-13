# Railway Deployment & User-Specific Trading Setup

## Overview
This project now supports:
- **Individual user tracking** for paper trading
- **Railway deployment** with automatic API URL configuration
- **Responsive UI** for mobile and desktop
- **USD currency display** for consistency
- **User-specific balance tracking**

---

## User Authentication & Tracking

### How It Works
- Each user gets a unique ID (`userId`) stored in browser localStorage
- All trades, balances, and paper trading data are tracked per user
- User ID format: `user_[random]_[timestamp]`

### For Users
When you access the app:
1. A unique user ID is automatically generated and saved locally
2. All your paper trades are stored separately
3. Your balance updates are specific to your account
4. Export functionality downloads only your trades

---

## Railway Deployment

### Prerequisites
- Railway account (https://railway.app)
- GitHub repository connected to Railway

### Setup Steps

#### 1. **Create Railway Project**
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Initialize project
railway init
```

#### 2. **Configure Environment Variables in Railway**
In Railway Dashboard → Project Settings → Variables, add:

```
PORT=5001
NODE_ENV=production
SEND_TELEGRAM_ON_TRADE=true
SEND_DAILY_SUMMARY=false
SEND_ERROR_ALERTS=true
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
# Recommended. If omitted, send /start to the bot and call /api/telegram/verify.
TELEGRAM_CHAT_ID=your-telegram-chat-id
```

Telegram is now the notification channel for Railway. Gmail/SMTP is not required.

To get `TELEGRAM_CHAT_ID`:

1. Open your Telegram bot chat and send `/start`.
2. Deploy the app with `TELEGRAM_BOT_TOKEN` set.
3. Call `POST /api/telegram/verify` on your Railway URL.
4. Read the returned `chatId` and add it as `TELEGRAM_CHAT_ID` in Railway Variables.

#### 3. **Set Build & Start Commands**
In Railway → Deploy → Settings:

**Build Command:**
```bash
npm install && cd frontend && npm install && npm run build && cd ..
```

**Start Command:**
```bash
node backend/server.js
```

#### 4. **Connect Your Domain (Optional)**
- Go to Railway → Networking
- Add your custom domain or use the Railway-provided URL

#### 5. **Deploy**
```bash
# Push to your GitHub repository (connected to Railway)
git add .
git commit -m "Deploy to Railway"
git push origin main
```

Railway will automatically:
- Build the project
- Serve the frontend from `/frontend/dist`
- Run the Express backend
- Assign a public URL

---

## API Configuration for Production

### Automatic Detection
The app automatically detects the environment:

**Local Development:**
- Frontend API calls to: `http://localhost:5001/api`

**Railway Production:**
- Frontend API calls to: `/api` (relative path)
- Express backend serves frontend from `../frontend/dist`

### Setting VITE_API_URL

For Railway, set in environment variables:
```
VITE_API_URL=/api
```

This will make all API calls use the same domain as the frontend.

---

## Paper Trading Features

### User-Specific Paper Trades
Each user can:
- Create paper BUY/SELL trades
- Set custom quantities
- View their trade history
- Track balance changes
- Export their trades to CSV

### Endpoints
- **Manual Trade**: `POST /api/manual-trade` (user-specific)
- **Get Trades**: `GET /api/trades?userId={userId}` (user-specific)
- **Get Balance**: `GET /api/balance?userId={userId}` (user-specific)
- **Export CSV**: `GET /api/trades/export?userId={userId}` (user-specific)

### Balance Management
- Initial balance: $10,000 USD per user
- Balance updates when paper trades are recorded
- Separate balance tracking per user

---

## UI Responsive Design

### Mobile Optimization
The UI is fully responsive with breakpoints:

- **Desktop (1200px+)**: Multi-column layout
- **Tablet (768px - 1199px)**: 2-column layout
- **Mobile (480px - 767px)**: Single column layout
- **Small Mobile (< 480px)**: Optimized single column

### Features
- Larger touch targets on mobile (buttons 14px+ padding)
- Readable font sizes (12px+ on mobile)
- Flexbox layout that adapts to screen size
- Proper spacing and margins for all devices

---

## Currency Standardization

### Changes Made
- **P&L Display**: Now shows `$` instead of `₹` (USD)
- **All prices**: Displayed with `$` prefix
- **Consistency**: All monetary values in USD

---

## WebSocket for Real-Time Updates

### Connection
The app connects to WebSocket at:
```javascript
// Local: ws://localhost:5001
// Production: wss://your-railway-domain.railway.app
```

### Features
- Real-time price updates
- Live trade notifications
- Balance synchronization

---

## Environment Variables Reference

### Production (.env on Railway)
```env
# Server
PORT=5001
NODE_ENV=production

# Telegram notifications
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=your-telegram-chat-id
SEND_TELEGRAM_ON_TRADE=true
SEND_DAILY_SUMMARY=true
SEND_ERROR_ALERTS=true

# Frontend API
VITE_API_URL=/api

# Database
DATABASE_URL=./trading.db

# Timezone
TIMEZONE=Asia/Kolkata
```

### Development (.env local)
```env
# Server
PORT=5001
NODE_ENV=development

# Frontend will proxy to backend
# See vite.config.js for proxy configuration
```

---

## Testing Locally Before Railway

### 1. Install Dependencies
```bash
npm install
cd frontend && npm install && cd ..
```

### 2. Build Frontend
```bash
cd frontend
npm run build
cd ..
```

### 3. Start Backend
```bash
node backend/server.js
```

### 4. Access Application
```
http://localhost:5001
```

### 5. Test User-Specific Features
- Open in incognito/private window to get new user ID
- Create paper trades
- Check balance updates
- Export trades

---

## Troubleshooting

### API Not Connecting
1. Check Railway URL is correct
2. Verify VITE_API_URL is set in environment
3. Check CORS is enabled in backend
4. Verify frontend is being served from backend

### User Data Not Persisting
1. Check browser localStorage is enabled
2. Clear cache and reload
3. Verify database file permissions on server

### WebSocket Connection Fails
1. Verify Railway supports WebSocket (it does)
2. Check wss:// protocol is used for HTTPS
3. Verify port forwarding if behind proxy

### Telegram Notifications Not Working
1. Verify `TELEGRAM_BOT_TOKEN` exists in Railway Variables.
2. Open the bot in Telegram and send `/start`.
3. Call `POST /api/telegram/verify` and check `lastError`.
4. If the response includes `chatId`, add that value as `TELEGRAM_CHAT_ID` in Railway Variables and redeploy.
5. Call `POST /api/telegram/test` to send a test alert.
6. Check `SEND_TELEGRAM_ON_TRADE=true` if you expect trade alerts.

Useful endpoints:

- `GET /api/telegram/status`
- `POST /api/telegram/verify`
- `POST /api/telegram/test`

Common Telegram errors:

- `TELEGRAM_CHAT_ID is missing`: send `/start` to the bot, then call `/api/telegram/verify`.
- `Unauthorized`: wrong or revoked bot token. Create a new token from BotFather.
- `Forbidden: bot was blocked by the user`: unblock the bot and send `/start` again.

---

## Performance Tips

### For Railway
- Use free tier for testing
- Upgrade for production traffic
- Database file will persist in Railway workspace
- Backups recommended for production

### For Users
- Paper trading is simulated (no real money)
- Data cleared on Railway redeploy (use backup)
- Multiple users can access same instance
- Each user has isolated data

---

## Next Steps

1. ✅ Deploy to Railway
2. ✅ Configure environment variables
3. ✅ Test user-specific features
4. ✅ Set up email notifications
5. ✅ Share Railway URL with users

Users can now:
- Access from any device
- Create paper trades
- Track individual balances
- Export trading history

---

## Support

For issues:
1. Check Railway deployment logs
2. Verify environment variables
3. Test locally first
4. Check browser console for errors
5. Review server logs: `railway logs`
