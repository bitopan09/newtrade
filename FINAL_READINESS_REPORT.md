# SignalForge Final Readiness Report

Date: 2026-06-13

## Final Build

The system is prepared for the 5:00 PM 90-day backtest run with the safer small-account configuration path active in both the backend and frontend.

Primary entry points:

- Backend: `npm start`
- Frontend production build: `npm run build`
- Critical validation: `npm run validate`
- Critical tests only: `npm test`
- Standalone backtest: `node improved_backtest_cpr.js`

Backtest persistence and exports:

- Every dashboard backtest is saved to SQLite table `backtest_results`.
- The dashboard triggers an immediate CSV download after a completed run.
- Recent saved runs appear in the Backtester panel with server-side CSV export links.
- Saved run export endpoint: `GET /api/backtest/results/:id/export`
- Saved run list endpoint: `GET /api/backtest/results`
- Walk-forward endpoint: `POST /api/backtest/walk-forward`

## Current Growth Backtest Settings

Use these dashboard settings for the current higher-opportunity run:

```txt
Days: 90
Risk %: 5
Max loss rule: 5% of doubled base balance tier
Trades/Day: 1
Losses/Day: 1
Score: 4
ADX: 18
SL ATR: 0.05
Final TP R: 100
Max ATR %: 8
Fee %: 0.10
Slippage %: 0.05
Spread %: 0.02
```

## Major Decisions

- Switched from the previous safe `1%` profile to a higher-opportunity growth profile after the lot range was fixed to `0.01-0.04 BTC`.
- Kept `1 trade/day` and `1 loss/day` because the selected growth profile already uses high per-trade risk.
- Restored previous-style signal behavior by removing the nearby support/resistance quality blockers, lowering ADX to `18`, and using trailing-profit style exits.
- Modeled same-candle SL/TP ambiguity conservatively by assuming the stop is hit first.
- Added daily trade and daily loss gates to the backtest path so simulations match live risk controls more closely.
- Added fees, slippage, and spread to reduce inflated backtest performance.
- Added dashboard-configurable backtest settings so the 5:00 PM run does not require code edits.
- Added a health endpoint at `/api/health` for deployment readiness checks.
- Removed authentication code per operator instruction; no auth gate is active.
- Removed dashboard optimization, walk-forward, and recent-signal panels per operator instruction.

## Assumptions

- BTC/USD paper trading remains the target market.
- Coinbase 6H candles are the preferred historical source when available.
- Synthetic/random market data is not allowed; backtests must use real exchange candles or fail.
- The final 90-day run should use dashboard-provided config, not hidden `.env` overrides.
- The current growth profile targets higher return, but it is not a guarantee and carries materially higher drawdown risk.
- No live exchange execution is enabled; this is still paper trading.

## Test And Validation Report

Validation command:

```bash
npm run validate
```

Validation coverage:

- JavaScript syntax check for `backend/unifiedStrategy.js`
- JavaScript syntax check for `backend/decisionEngine.js`
- JavaScript syntax check for `backend/tradingBot.js`
- JavaScript syntax check for `improved_backtest_cpr.js`
- Critical Node test suite in `tests/critical.test.js`
- Frontend production build through Vite

Latest validation result:

| Run | Syntax Checks | Critical Tests | Frontend Build | Result |
| --- | --- | --- | --- | --- |
| Discrete-lot final | Pass | 10/10 pass | Pass | Pass |

Runtime smoke test:

```txt
Endpoint: GET /api/health
Result: status=ok, database=ok
```

Persistence/export smoke test:

```txt
POST /api/backtest saved run: yes
Saved run ID: 2
GET /api/backtest/results returned saved run: yes
GET /api/backtest/results/:id/export returned CSV: yes
CSV size: 13,003 bytes
```

Critical tests added:

- Position sizing respects the configured risk percentage.
- Tiered 5% risk caps at `$2.50` below `$100` equity and `$5.00` once equity reaches `$100`.
- Minimum lot sizing is rejected when it would exceed risk.
- Position sizing floors to discrete `0.01 BTC` steps.
- Strategy config is honored for confluence, ADX, ATR, and RR settings.
- Same-candle stop/target ambiguity exits at stop first.
- Trailing stop moves to breakeven after 1R.
- Daily trade limit blocks additional trades.
- Execution rejects manual/paper trade quantities outside `0.01-0.04 BTC`.
- Execution rejects non-step quantities such as `0.015 BTC`.

## Backtest Results

### Backend 90-Day Growth Backtest, Selected Profile

Source: Coinbase

Candles fetched: 500

Candles simulated after warmup/windowing: 360

```txt
Total trades: 39
Win rate: 20.51%
Profit factor: 2.06
Max drawdown: 87.62%
Total return: +469.65%
Final equity: $284.82
Total fees: $143.98
Total slippage cost: $86.39
Expectancy: $6.02
Average R: 2.73R
Longest losing streak: 1
Skipped signals: 87
Allowed lots: 0.01, 0.02, 0.03, 0.04 BTC
Lots selected by this run: 0.01, 0.02, 0.04 BTC
```

Interpretation: the selected profile targets high in-sample 90-day return while enforcing the tiered 5% risk cap and discrete lot sizes, but the drawdown is still high and the sample is still small. Treat it as a high-risk profile, not as a guaranteed return model.

### Standalone CLI Backtest Note

`node improved_backtest_cpr.js` reads `.env`. For comparable final results, run the dashboard backtest with explicit settings or set `.env` to the current growth profile before running the CLI script.

## Known Limitations And Risks

- Backtest sample size is still limited because 6H candles over 90 days produced 39 completed trades.
- The selected profile has high drawdown: the latest 90-day Coinbase run showed `87.62%` max drawdown after enforcing discrete lot sizes.
- A `0.01 BTC` minimum lot is large for a `$50` account and can create high per-trade risk.
- Coinbase historical candles may differ from another exchange’s BTC/USD or BTC/USDT feed.
- The high-impact news calendar is static for 2026 and should be replaced with a live economic calendar API.
- Paper execution does not model order queue position, partial fills, exchange outages, or liquidity constraints.
- Email service initializes during tests because current modules load it at import time.

## Deployment Instructions

1. Copy `.env.example` to `.env` and set secrets.
2. Confirm risk settings before launch: `RISK_PERCENTAGE=5`, `DAILY_TRADE_LIMIT=1`, `MAX_DAILY_LOSSES=1`, `MIN_CONFLUENCE_SCORE=4`, `ADX_THRESHOLD=18`, `ATR_STOP_MULTIPLIER=0.05`.
3. Run `npm install` at the root if dependencies are not installed.
4. Run `cd frontend && npm install` if frontend dependencies are not installed.
5. Run `npm run validate` and confirm all checks pass.
6. Build the frontend with `npm run build`.
7. Start the server with `npm start`.
8. Check `GET /api/health` and confirm `status: ok`.
9. Open the dashboard and run the 90-day backtest with the recommended settings above.

## Recommended Next Steps

1. Add a live economic calendar/news API instead of static dates.
2. Add longer historical datasets before increasing real capital exposure.
3. Add a formal database migration system for schema changes.
4. Add CI to run `npm run validate` on every push.
5. Rename the legacy `emailService.js` filename to `notificationService.js` in a future cleanup.
