# Quick Start: Deploy to Railway in 5 Minutes

## Prerequisites
- GitHub account with your repo
- Railway account (free tier available)

---

## Step 1: Connect Railway to GitHub
1. Go to https://railway.app
2. Sign up / Sign in
3. Click "Create" → "GitHub Repo"
4. Select your newtrade repository
5. Click "Deploy"

---

## Step 2: Set Environment Variables (Railway Dashboard)
Click "Project" → Variables → Add:

```
PORT=5001
NODE_ENV=production
VITE_API_URL=/api
SEND_EMAIL_ON_TRADE=true
```

Add email variables if you want notifications:
```
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
NOTIFY_EMAIL=your-email@gmail.com
```

---

## Step 3: Wait for Deployment
Railway will automatically:
- Build the project
- Run `npm install` in root and frontend
- Build frontend with `npm run build`
- Start backend server

Check the "Deployments" tab to see progress.

---

## Step 4: Get Your URL
1. Go to "Networking" tab
2. Copy your public URL (something like: `https://newtrade-prod-xxxx.railway.app`)
3. Share this URL with users

---

## Step 5: Test It Works
Open your Railway URL and:
- ✓ Check header shows "API ✓"
- ✓ Create a paper trade
- ✓ Check balance updates
- ✓ Open in incognito (new user)
- ✓ Verify separate data

---

## Connecting from Mobile/Another Device

Open the Railway URL on any device:
```
https://your-app.railway.app
```

Each device/browser gets a unique user ID automatically.

---

## If Deployment Fails

Check logs in Railway Dashboard → Deployments → View Logs

Common issues:
- **Build error**: Verify `npm run build` works locally
- **Port error**: Check NODE_ENV is set to 'production'
- **API not connecting**: Verify VITE_API_URL=/api

---

## Local Development (Optional)

```bash
# Install dependencies
npm install
cd frontend && npm install && cd ..

# Build frontend
cd frontend && npm run build && cd ..

# Run backend
node backend/server.js

# Open
http://localhost:5001
```

---

## Features Now Available

✓ **User-Specific Trading**: Each person has their own account
✓ **Paper Trading**: Simulated trades with real market prices
✓ **Balance Tracking**: Individual balance per user
✓ **Trade Journal**: View your trades, export to CSV
✓ **Mobile Responsive**: Works great on phone/tablet
✓ **Backtesting**: Test strategies on historical data
✓ **Multi-User**: Unlimited users (paid Railway plan optional)

---

## Share URL with Others

Once deployed, you can share: `https://your-app.railway.app`

Everyone who opens it gets:
- Unique user ID (stored locally)
- $10,000 paper trading balance
- Individual trade history
- Separate balance tracking

---

## Support

For issues:
1. Check Railway deployment logs
2. Read `RAILWAY_SETUP.md` for detailed guide
3. Read `CHANGES_COMPLETED.md` for implementation details
4. Test locally first to isolate issues

---

## Upgrading Later

If you want:
- Custom domain: Railway → Networking → Add Domain
- More resources: Railway → Settings → Plan (paid tiers)
- Database backup: Railway → Data → Backup

---

## That's It! 🚀

Your app is now live and users can access it from anywhere with unique accounts and paper trading!
