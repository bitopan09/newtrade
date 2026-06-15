# BTC/USD Trading Bot Project Analysis

## Short Answers

- Is every market price real exchange data? Yes after the latest update. Live price streaming uses real Coinbase WebSocket data, live analysis fetches real Coinbase BTC-USD candles, the chart uses real Coinbase OHLC candles, and backtests now refuse to run if real exchange candle APIs fail.
- Can this be applied directly to a real account? No, not directly. The current project is paper trading only. It logs trades in SQLite and does not place real exchange orders.
- Will it give signals tomorrow? It can, if the backend is running, Coinbase data is reachable, and the strategy conditions pass. It is not guaranteed to produce a BUY or SELL signal every day.
- How much risk is it taking per trade? Maximum risk is capped at 5% of the current doubled base-balance tier. For a $100 base, the cap is $5.00 per trade. After equity reaches $200, the cap becomes $10.00, then $20.00 at $400, etc.
- Can it be used to take real-time trades? It can be used as a real-time paper-trading and signal-monitoring tool. It should not be trusted for real-money auto-trading until real exchange execution, sandbox testing, security, and risk controls are added and tested.

## What The Project Does

This project is a BTC/USD paper trading dashboard and bot.

Main parts:

- Backend server: `backend/server.js`
- Trading loop and backtester: `backend/tradingBot.js`
- Strategy logic: `backend/unifiedStrategy.js`
- Decision filters: `backend/decisionEngine.js`
- Paper execution engine: `backend/executionEngine.js`
- React dashboard: `frontend/src`
- Critical tests: `tests/critical.test.js`

The bot analyzes BTC/USD market structure, confluence, trend, ATR stops, and risk. If all filters pass, it opens a paper trade in the local SQLite database.

## Data Source Analysis

Live price feed:

- Source: Coinbase WebSocket
- Symbol: `BTC-USD`
- Used for dashboard live price updates and active trade monitoring
- Stored in SQLite table: `prices`

Live bot analysis:

- Source: Coinbase REST candles
- Symbol: `BTC-USD`
- Candle size: 6 hours
- The dashboard chart uses 1-minute Coinbase OHLC candles. The bot checks every 1 minute, but the strategy analysis still uses 6H candles, so signals are not true tick-by-tick scalping signals.

Backtesting:

- First source: Coinbase historical candles
- Fallback source: Bybit BTCUSDT candles
- Fallback source: Binance BTCUSDT candles
- No synthetic/random candle fallback is allowed now

Important answer: backtest data is historical exchange data, not live future data. If Coinbase/Bybit/Binance fail during a backtest, the backtest now fails instead of generating fake candles.

Other non-real-time pieces:

- High-impact news dates are static in code for 2026.
- There is no live economic calendar API.
- There is no live order book, depth, funding-rate, liquidation, or exchange fill model.

## Current Trading Mode

The project is currently paper trading.

Evidence from code:

- `executionEngine.executeTrade()` inserts trades into SQLite.
- Trades are saved with `trade_type = 'paper'`.
- There is no Coinbase/Binance/Bybit private order API integration.
- There are no real account API key signing flows for order placement.

So even if the bot says `Trade executed`, that means a paper trade was recorded locally, not a real exchange order.

## Real Account Readiness

Do not connect this directly to a real-money account yet.

Reasons:

- It has no real exchange execution adapter.
- It has no exchange sandbox/testnet order validation.
- It has no real order fill handling.
- It has no partial fill handling from an exchange.
- It has no exchange-side stop-loss or take-profit order placement.
- It has no live account balance synchronization.
- Auth was removed from the dashboard, so the UI should not be publicly exposed.
- The latest backtest still has high drawdown.
- A `0.01 BTC` minimum lot is large for a `$100` account and may require leverage or more capital on a real exchange.

Safe current use:

- Use it for paper trading.
- Use it for signal observation.
- Use it for backtesting and journaling.
- Use generated signals as research, not automatic financial advice.

Needed before real account trading:

- Add exchange API integration using sandbox/testnet first.
- Re-add secure authentication before exposing the dashboard.
- Add exchange-side stop-loss and take-profit orders.
- Add account balance sync and position sync.
- Add a hard kill switch.
- Add max daily dollar loss and max account drawdown lockout.
- Add live economic news calendar integration.
- Run forward paper testing for multiple weeks before real funds.

## Signal Tomorrow

The bot can give a signal tomorrow only if these are true:

- Backend server is running.
- `BOT_ENABLED` is not set to `false`.
- Coinbase API is reachable.
- The bot has enough 6H candle history.
- The current day is not blocked by the static high-impact news filter.
- Daily trade limit has not already been used.
- Daily loss limit has not been hit.
- Confluence score is at least the configured threshold.
- Trend filters confirm the signal direction.
- Position sizing passes the risk guard.

Current settings allow the bot to run all day:

```txt
BOT_START_HOUR=0
BOT_END_HOUR=23
DAILY_TRADE_LIMIT=1
MAX_DAILY_LOSSES=1
MIN_CONFLUENCE_SCORE=4
ADX_THRESHOLD=18
```

The correct expectation is: the bot will analyze tomorrow, but a BUY or SELL is not guaranteed. Many checks can produce `SKIP` or `NEUTRAL`.

## Risk Per Trade

The current risk model is tiered and capped.

Rule:

```txt
Max trade risk = 5% of doubled base-balance tier
```

Examples:

| Equity Range | Base Balance | Max Risk Per Trade |
| --- | ---: | ---: |
| $100 to $199.99 | $100 | $5.00 |
| $200 to $399.99 | $200 | $10.00 |
| $400 to $799.99 | $400 | $20.00 |
| $800 to $1599.99 | $800 | $40.00 |

The actual risk is calculated as:

```txt
Actual risk = BTC quantity x stop-loss distance in dollars
```

Example:

```txt
Entry: $50,000
Stop: $49,750
Stop distance: $250
Quantity: 0.02 BTC
Actual risk: 0.02 x 250 = $5.00
```

If the minimum allowed lot of `0.01 BTC` would risk more than the current cap, the bot skips the trade.

## Lot Size Rule

The bot now only allows these BTC quantities:

```txt
0.01 BTC
0.02 BTC
0.03 BTC
0.08 BTC
```

It does not allow fractional values like:

```txt
0.015 BTC
0.023 BTC
0.0345 BTC
```

Automatic sizing floors to the nearest valid lot step so it does not round upward above the risk cap.

Example:

```txt
Calculated quantity: 0.039 BTC
Actual order quantity: 0.03 BTC
```

Manual paper trading also uses only the four valid lot choices.

## Latest Validation

Command run:

```bash
npm run validate
```

Result:

```txt
Syntax checks: passed
Critical tests: 10/10 passed
Frontend build: passed
```

The critical tests now include checks for:

- Tiered 5% risk cap.
- Minimum-lot risk rejection.
- Discrete `0.01` BTC lot steps.
- Rejection of invalid lot size like `0.015 BTC`.
- Daily trade limit.
- Same-candle stop-loss priority.
- Trailing stop moving to breakeven.

## Latest 90-Day Backtest

Latest run after enforcing discrete lot sizes:

```txt
Data source: Coinbase
Candles used: 360
Total trades: 39
Win rate: 20.51%
Profit factor: 2.06
Max drawdown: 87.62%
Total return: +469.65%
Final equity: $284.82
Allowed lots: 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08 BTC
Lots selected by this run: depends on current risk and stop distance, capped at 0.08 BTC
```

Interpretation:

- The result is positive in this 90-day sample.
- The drawdown is very high.
- This is not enough evidence for real-money deployment.
- The strategy should be forward-tested in paper mode before any real account use.

## Practical Recommendation

Use the project tomorrow in paper mode only.

Best use right now:

- Run the backend.
- Watch dashboard confluence and bot status.
- Let the bot log paper trades.
- Export and review results.
- Compare paper entries/exits against the live chart manually.

Do not use it for automatic real-money trading yet.

If using the signals manually, keep position size small and understand that the bot can still be wrong. The current model can take large drawdowns even when the backtest ends profitable.
