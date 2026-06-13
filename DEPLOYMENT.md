# Trading Bot Deployment Guide

## Prerequisites
- Node.js 18+ or Docker
- Telegram bot token from BotFather
- A server with public IP (for remote access)

## Local Deployment

### 1. Setup Environment Variables
```bash
cp .env.example .env
```

Edit `.env` and fill in:
- `TELEGRAM_BOT_TOKEN` - Bot token from BotFather
- `TELEGRAM_CHAT_ID` - Telegram chat ID for alerts

### 2. Install Dependencies
```bash
npm install
cd frontend && npm install && cd ..
```

### 3. Build Frontend
```bash
npm run build
```

### 4. Start the Bot
```bash
npm start
```

The bot will be available at `http://localhost:5001`

---

## Docker Deployment

### 1. Setup Environment
```bash
cp .env.example .env
# Edit .env with your configuration
```

### 2. Build and Run with Docker
```bash
docker build -t trading-bot .
docker run -d \
  --name trading-bot \
  -p 5001:5001 \
  --env-file .env \
  -v $(pwd)/trading.db:/app/trading.db \
  trading-bot
```

### 3. Using Docker Compose (Recommended)
```bash
docker-compose up -d
```

### 4. View Logs
```bash
docker-compose logs -f trading-bot
```

---

## Cloud Deployment (AWS/Azure/Heroku)

### Heroku Deployment
```bash
# Install Heroku CLI
# Login to Heroku
heroku login

# Create app
heroku create trading-bot-$(date +%s)

# Add environment variables
heroku config:set TELEGRAM_BOT_TOKEN=your-telegram-bot-token
heroku config:set TELEGRAM_CHAT_ID=your-telegram-chat-id
heroku config:set SEND_TELEGRAM_ON_TRADE=true

# Deploy
git push heroku main
```

### AWS EC2 Deployment
```bash
# Connect to EC2 instance
ssh -i your-key.pem ec2-user@your-instance-ip

# Install Node.js
curl -sL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs

# Clone repository
git clone your-repo-url
cd newtrade

# Setup
cp .env.example .env
nano .env  # Edit configuration

# Install & build
npm install
npm run build

# Start with PM2 (for persistent operation)
sudo npm install -g pm2
pm2 start backend/server.js --name trading-bot
pm2 startup
pm2 save
```

---

## Configuration

### Enable Telegram Notifications
1. Create a bot with BotFather and copy the token.
2. Open the bot chat and send `/start`.
3. Call `POST /api/telegram/verify` to discover `TELEGRAM_CHAT_ID` if needed.
4. Set Telegram variables:
   ```
   TELEGRAM_BOT_TOKEN=your-telegram-bot-token
   TELEGRAM_CHAT_ID=your-telegram-chat-id
   SEND_TELEGRAM_ON_TRADE=true
   ```

### 24-Hour Operation
The bot is configured to:
- Run continuously (0-23 hours)
- Execute max 1 trade per day
- IST timezone (automatically adjusted)
- Health checks every 30 seconds

To modify, edit `.env`:
```
BOT_START_HOUR=0
BOT_END_HOUR=23
DAILY_TRADE_LIMIT=1
```

---

## Monitoring

### Local Monitoring
- Dashboard: http://localhost:5001
- Real-time updates every 10 seconds
- Email alerts on every trade

### Remote Monitoring
- Setup HTTPS with nginx (included in docker-compose)
- Access via `https://your-domain.com`
- Check logs: `docker-compose logs -f`

### Health Checks
```bash
# Check bot status
curl http://localhost:5001/api/bot/status

# Get latest price
curl http://localhost:5001/api/price

# Get balance
curl http://localhost:5001/api/balance
```

---

## Troubleshooting

### Telegram alerts not sending
1. Check `.env` file configuration
2. Send `/start` to your Telegram bot
3. Check logs: `docker-compose logs trading-bot`
4. Run `curl -X POST http://localhost:5001/api/telegram/verify`

### Bot not starting trades
1. Check `BOT_ENABLED=true` in `.env`
2. Verify it's within `BOT_START_HOUR` to `BOT_END_HOUR`
3. Check if daily trade limit is reached

### Database issues
1. Ensure `trading.db` file has write permissions
2. Reset database: `rm trading.db && docker-compose restart`

---

## Performance Tips

1. **Keep database optimized**: Run `VACUUM` on SQLite periodically
2. **Monitor resource usage**: Check CPU/Memory in docker stats
3. **Log rotation**: Configure log rotation for long-term operation
4. **Backups**: Backup `trading.db` daily

---

## Support

For issues or questions:
1. Check logs: `docker-compose logs -f`
2. Review configuration in `.env`
3. Verify Telegram setup
4. Check network connectivity

---

## Security Best Practices

1. **Never commit `.env` file** - Use `.env.example`
2. **Keep Telegram bot tokens secret**
3. **Rotate leaked bot tokens in BotFather**
4. **Restrict API access** - Use firewall rules
5. **Keep secrets in environment variables**, never in code
6. **Use HTTPS** for remote deployment
7. **Monitor logs** regularly for suspicious activity

---

## Maintenance

### Weekly
- Check logs for errors
- Verify email notifications working
- Monitor database size

### Monthly
- Review trade journal
- Backup trading.db
- Update dependencies: `npm update`

### Quarterly
- Review and optimize strategy
- Clean old data if needed
- Security audit

---

Last Updated: 2026-05-10
