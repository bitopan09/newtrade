# SignalForge Improvement Roadmap

## Goal

Improve the BTC/USD paper trading bot and backtester for a small $50 account by making the system safer, more realistic, more configurable, and easier to evaluate.

---

## Phase 1: Backtest Accuracy

### Objective

Make backtest results closer to real trading conditions.

### Tasks

- Add trading fees to every simulated trade.
- Add slippage to entries and exits.
- Add spread assumptions.
- Avoid same-candle perfect entries.
- Use next candle open for simulated trade entry.
- Track realistic exit behavior when both SL and TP are hit inside the same candle.
- Add more reliable backtest metrics.

### Metrics To Add

- Max drawdown.
- Profit factor.
- Expectancy.
- Average R-multiple.
- Longest losing streak.
- Average win.
- Average loss.
- Win rate by direction.
- Total fees paid.
- Total slippage cost.

### Expected Result

Backtest results become less inflated and more useful for deciding whether the strategy is actually profitable.

---

## Phase 2: $50 Account Risk Management

### Objective

Make the bot safer for a small account.

### Recommended Settings

- Risk per trade: 1% to 2%.
- Dollar risk per trade: $0.50 to $1.00.
- Max daily trades: 1.
- Max daily losses: 1.
- Minimum confluence score: 6/10.
- ADX threshold: 22.
- Stop loss: 1x to 1.5x ATR.
- Take profit: 1.8R to 2R.
- Trade only with higher timeframe trend.
- Skip high-volatility conditions.

### Tasks

- Reduce risk from 5% to 1% or 2%.
- Stop trading for the day after one loss.
- Skip trades where the calculated stop loss is too wide for a $50 balance.
- Skip trades where minimum lot size creates excessive risk.
- Add maximum allowed dollar risk validation.
- Add maximum ATR filter.
- Add minimum reward-to-risk validation.

### Expected Result

The bot trades less frequently but protects capital better.

---

## Phase 3: Trade Quality Filters

### Objective

Take fewer but higher-quality trades.

### Tasks

- Increase minimum confluence score from 5/10 to 6/10 or 7/10.
- Increase ADX threshold from 18 to 20-25.
- Add higher timeframe trend confirmation.
- Avoid trades when price is between major EMAs.
- Avoid counter-trend trades unless confluence is very strong.
- Add no-trade zone during choppy markets.
- Require volume confirmation for breakout trades.
- Require support/resistance rejection confirmation before entry.

### Suggested Rules

- Only BUY when higher timeframe trend is bullish.
- Only SELL when higher timeframe trend is bearish.
- Skip if EMA alignment is mixed.
- Skip if ATR is unusually high.
- Skip if ADX is below threshold.
- Skip if price is trapped between EMA-21 and EMA-50.

### Expected Result

Lower trade count but better average trade quality.

---

## Phase 4: Entry And Exit Improvements

### Objective

Improve profitability by reducing bad entries and improving exits.

### Entry Improvements

- Use multi-timeframe setup:
  - 6H for trend.
  - 1H for setup confirmation.
  - 15m for entry timing.
- Enter only after candle close confirmation.
- Avoid entering immediately after large impulse candles.
- Avoid entering into nearby support or resistance.

### Exit Improvements

- Move stop loss to breakeven after 1R.
- Take partial profit at 1R or 1.5R.
- Trail remaining position with Chandelier stop.
- Start trailing only after price reaches at least 1R.
- Use tighter stops for small-balance trades.
- Avoid profit targets that are too far for the current ATR environment.

### Suggested Exit Model

- Stop loss: 1.25x ATR.
- First take profit: 1R or 1.5R.
- Final take profit: 2R.
- Breakeven: after 1R.
- Trailing stop: after 1R.

### Expected Result

Better risk/reward consistency and fewer profitable trades turning into losses.

---

## Phase 5: Parameter Optimization

### Objective

Find the best settings using structured testing instead of guessing.

### Parameters To Test

- Risk per trade:
  - 1%.
  - 1.5%.
  - 2%.
- Minimum confluence:
  - 5/10.
  - 6/10.
  - 7/10.
- ADX threshold:
  - 18.
  - 20.
  - 22.
  - 25.
- ATR stop multiplier:
  - 1.0.
  - 1.25.
  - 1.5.
  - 2.0.
- Take profit ratio:
  - 1.5R.
  - 1.8R.
  - 2.0R.
  - 2.5R.
- Trading session:
  - London.
  - New York.
  - London/New York overlap only.
- Trailing stop:
  - Disabled.
  - Enabled after 1R.
  - Enabled after 1.5R.

### Compare Results By

- Final balance.
- Max drawdown.
- Profit factor.
- Win rate.
- Average R.
- Expectancy.
- Number of trades.
- Consecutive losses.
- Average trade duration.
- Long vs short performance.

### Expected Result

The best-performing settings can be selected based on data, not assumptions.

---

## Phase 6: Configuration System

### Objective

Make the bot tunable without changing code.

### Tasks

- Move strategy constants to `.env` or config file.
- Move risk settings to config.
- Move backtest assumptions to config.
- Add validation for missing or invalid config values.
- Show current config in the frontend dashboard.

### Config Values To Add

- Risk percentage.
- Max daily trades.
- Max daily losses.
- Minimum confluence score.
- ADX threshold.
- ATR stop multiplier.
- Take profit ratio.
- Breakeven trigger.
- Trailing stop trigger.
- Fee percentage.
- Slippage percentage.
- Max allowed ATR.
- Trading session start/end.
- Higher timeframe confirmation toggle.

### Expected Result

Strategy testing becomes faster and safer.

---

## Phase 7: Logging And Review Tools

### Objective

Understand why the bot entered or skipped each trade.

### Tasks

- Log every generated signal.
- Log every skipped trade.
- Log which risk gate blocked the trade.
- Log confluence score breakdown.
- Log trend conditions.
- Log entry, SL, TP, and position size.
- Add trade notes to the dashboard.
- Add filters in the trade journal.

### Useful Skip Reasons

- Low confluence.
- ADX too low.
- Outside trading session.
- News filter active.
- Daily trade limit reached.
- Stop loss too wide.
- Risk too high for balance.
- Counter-trend trade.
- Choppy market.
- ATR too high.

### Expected Result

The bot becomes easier to debug and improve.

---

## Phase 8: Frontend Improvements

### Objective

Make the dashboard more useful for strategy review.

### Tasks

- Add backtest settings controls.
- Add risk settings controls.
- Show detailed confluence breakdown.
- Show skipped trade log.
- Show drawdown chart.
- Show equity curve with trade markers.
- Show win/loss distribution.
- Show monthly performance summary.
- Add strategy comparison view.
- Add export for backtest results and skipped signals.

### Expected Result

The frontend becomes a real research dashboard, not only a monitoring dashboard.

---

## Phase 9: Safety And Production Readiness

### Objective

Prepare the bot for more serious use.

### Tasks

- Add automated tests for strategy logic.
- Add automated tests for risk gates.
- Add automated tests for execution logic.
- Add structured logging.
- Add health checks.
- Add database indexes.
- Add database migrations.
- Add environment validation.
- Add error alerts for failed data fetching or database errors.
- Add authentication if deployed publicly.

### Expected Result

The project becomes more stable, maintainable, and safer to run continuously.

---

## Suggested First Implementation Order

1. Fix backtest realism:
   - fees.
   - slippage.
   - next-candle entries.
   - better metrics.
2. Improve $50 risk controls:
   - reduce risk to 1-2%.
   - one loss per day.
   - skip wide-stop trades.
3. Improve trade filters:
   - confluence 6/10.
   - ADX 22.
   - higher timeframe trend check.
4. Add config:
   - move hardcoded numbers into environment/config.
5. Add logs:
   - signal log.
   - skipped trade log.
   - confluence breakdown.

---

## Recommended Starting Settings For $50 Balance

```txt
Risk per trade: 1%
Max daily trades: 1
Max daily losses: 1
Minimum confluence score: 6/10
ADX threshold: 22
Stop loss: 1.25x ATR
Take profit: 1.8R to 2R
Move stop to breakeven: after 1R
Start trailing stop: after 1R
Trade direction: only with higher timeframe trend
Skip condition: high ATR or choppy market
```

---

## Core Principle

For a $50 account, the bot should not try to trade more often.

The best improvement is to trade less, risk less, and only take cleaner setups with better exit management.
