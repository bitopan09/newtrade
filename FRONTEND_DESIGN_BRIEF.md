# Bullseye Frontend Design Brief

## Purpose

This document is the production handoff for redesigning the frontend of Bullseye.

Bullseye is a BTC/USD paper trading terminal. It shows real Coinbase market data, paper-trade activity, bot status, risk settings, backtest results, and Telegram notification controls.

The redesign should make Bullseye feel like a premium trading terminal, not a generic admin dashboard.

## Product Identity

Product name: `Bullseye`

Core idea: precise BTC/USD paper-trading signals, real-time market visibility, and disciplined risk tracking.

Tone:

- Sharp
- Technical
- Calm under pressure
- Trading-terminal focused
- Serious about risk

Avoid:

- Playful crypto casino styling
- Overly bright gradients
- Generic SaaS cards
- Anything that implies guaranteed profit
- Anything that implies live real-money execution

## Current Frontend Stack

Frontend path:

```txt
frontend/
```

Main files:

```txt
frontend/src/App.jsx
frontend/src/App.css
frontend/src/services/api.js
frontend/src/components/LiveChart.jsx
frontend/src/components/BotStatus.jsx
frontend/src/components/ActiveTrades.jsx
frontend/src/components/ManualTrade.jsx
frontend/src/components/BalanceTracker.jsx
frontend/src/components/Backtester.jsx
frontend/src/components/TradeJournal.jsx
```

Tech:

- React `19`
- Vite
- Plain CSS
- Axios for API calls
- Custom SVG candlestick chart in `LiveChart.jsx`

There is no design system package currently. The redesign can introduce better CSS structure, but avoid heavy dependency additions unless strongly justified.

## Current App Layout

Top-level component:

```txt
frontend/src/App.jsx
```

Current structure:

- Sticky header
- Left dashboard column
- Right dashboard column
- Full-width trade journal section

Left column:

- `LiveChart`
- `BotStatus`
- `ActiveTrades`
- `ManualTrade`

Right column:

- `BalanceTracker`
- `Backtester`

Bottom full-width:

- `TradeJournal`

## Design Goals

Primary goals:

- Improve visual hierarchy.
- Make the live chart the main visual anchor.
- Make bot state, risk, open trades, and backtests easier to scan.
- Make the UI clearly black-theme and trading-terminal oriented.
- Improve mobile usability.
- Preserve the existing backend/API behavior.

The frontend should answer these questions quickly:

- Is the API online?
- Is the bot running?
- What is BTC doing right now?
- Is there an open paper trade?
- What are entry, SL, TP, lot size, and PnL?
- What risk settings are active?
- What did the latest backtest show?

## Must Preserve

Do not remove or break these behaviors:

- Real Coinbase BTC/USD 1-minute OHLC candles in `LiveChart`.
- Live Coinbase ticker updating the latest candle.
- Paper-trading language.
- Telegram notification test button.
- Bot/API online indicators.
- IST time display.
- Manual trade quantity choices only:

```txt
0.01 BTC
0.02 BTC
0.03 BTC
0.08 BTC
```

- Tiered 5% risk rule in UI copy where risk is explained.
- Backtest controls and CSV export.
- Trade journal export/readability.
- Mobile access.

Do not reintroduce:

- Auth gate
- Fake/random chart or backtest data
- Gmail/email notification UI as the primary notification path
- Optimizer/walk-forward dashboard panels unless explicitly requested

## Brand And Theme Direction

Theme: black-first trading terminal.

Base colors:

```txt
Background: #000000
Surface: #050505 / #080808
Card border: rgba(255,255,255,0.08)
Text primary: #f8fafc
Text secondary: #cbd5e1
Text muted: #71717a
Bullish/accent blue: #2f6bff
Success/online/profit: #10b981
Danger/offline/loss: #ef4444
Warning: #f59e0b
```

Visual principles:

- Use black and near-black surfaces.
- Let the chart and live trade state carry the drama.
- Use blue sparingly for Bullseye brand/action states.
- Use green only for online/success/profit.
- Use red only for loss/error/offline/sell states.
- Use thin borders instead of heavy filled panels.
- Prefer dense but readable terminal spacing.

Typography:

- UI font: `Inter`
- Numeric/market font: `JetBrains Mono`
- Use mono for prices, lot sizes, timestamps, IDs, and PnL.

## Component Requirements

### Header

Current responsibilities:

- Bullseye brand
- Current IST clock
- API status
- Bot status
- User ID snippet

Design improvements:

- Make Bullseye feel like a trading product, not just text plus a square logo.
- Use compact status pills for API and bot state.
- Keep sticky behavior.
- Make mobile header wrap cleanly.

Copy:

```txt
Bullseye
BTC/USD Paper Trading Terminal
```

### LiveChart

Current file:

```txt
frontend/src/components/LiveChart.jsx
```

This is the highest-priority component.

Current behavior:

- Fetches Coinbase BTC/USD 1-minute candles from `/api/candles`.
- Uses WebSocket ticker updates to update the latest candle.
- Renders custom SVG candles.

Must keep:

- 1-minute candles.
- Real Coinbase data only.
- Bullish candles as blue-outlined dark/hollow bodies.
- Bearish candles as solid white bodies.
- Price scale.
- Current price line.
- Hover/crosshair OHLC info.

Design improvements:

- Chart should dominate the dashboard width.
- Improve price scale legibility.
- Keep grid subtle.
- Make hover state feel precise.
- Avoid chart panel looking like a toy chart.

### BotStatus

Current file:

```txt
frontend/src/components/BotStatus.jsx
```

Current responsibilities:

- Bot online/offline state
- Daily trade count
- Live confluence score
- Strategy/risk settings
- Telegram test alert button
- Today's trade summary

Design improvements:

- Split into clear states: `Bot`, `Signal`, `Risk`, `Telegram`.
- Make `currentSignal` visually obvious.
- Keep the Telegram test button but label it clearly.
- Show failures in a compact warning style.

Do not call it email alerts. Use Telegram alerts.

### ActiveTrades

Current file:

```txt
frontend/src/components/ActiveTrades.jsx
```

Current responsibilities:

- Shows open paper trades.
- Updates live PnL with WebSocket price.
- Shows entry, SL, TP, quantity, and PnL.

Design improvements:

- Prioritize open risk first: entry, SL, current PnL, quantity.
- Use strong visual distinction for BUY/SELL.
- Make PnL color and sign unmistakable.
- Make empty state meaningful: `No active paper trade`.

### ManualTrade

Current file:

```txt
frontend/src/components/ManualTrade.jsx
```

Current responsibilities:

- Manual paper BUY/SELL.
- Quantity dropdown with only allowed lots.

Design improvements:

- Make it clear this creates paper trades only.
- Make BUY/SELL buttons visually deliberate.
- Add microcopy near quantity:

```txt
Allowed paper lot: 0.01 - 0.08 BTC
```

Do not allow freeform quantity input.

### BalanceTracker

Current file:

```txt
frontend/src/components/BalanceTracker.jsx
```

Current responsibilities:

- Shows USD balance, BTC balance, current BTC price, and total value.

Design improvements:

- Emphasize equity/current value.
- Label everything as paper balance where appropriate.
- Avoid making it feel like a synced real exchange account.

### Backtester

Current file:

```txt
frontend/src/components/Backtester.jsx
```

Current responsibilities:

- Runs backtests.
- Configures risk, daily limits, confluence score, ADX, ATR, fees, slippage, spread.
- Shows saved runs.
- Downloads CSV.

Design improvements:

- Group settings into sections:

```txt
Period
Risk
Signal Filters
Execution Costs
```

- Make the Run Backtest button primary.
- Show latest result summary in a scan-friendly strip.
- Draw attention to max drawdown and final equity.
- Keep saved run CSV affordance.

### TradeJournal

Current file:

```txt
frontend/src/components/TradeJournal.jsx
```

Current responsibilities:

- Shows trade history.
- Supports export.

Design improvements:

- Improve table density.
- Keep horizontal scroll on mobile.
- Consider sticky table header.
- Make closed/open status pills clearer.
- Keep timestamps readable in IST.

## API Contracts To Preserve

Do not change endpoint names without backend coordination.

Important frontend endpoints:

```txt
GET /api/price
GET /api/prices
GET /api/candles
GET /api/balance
GET /api/trades
GET /api/trades/active
POST /api/manual-trade
POST /api/trades/:id/close
GET /api/bot/status
POST /api/bot/start
POST /api/bot/stop
POST /api/backtest
GET /api/backtest/results
GET /api/backtest/results/:id/export
GET /api/telegram/status
POST /api/telegram/verify
POST /api/telegram/test
```

## Copy And UX Rules

Use:

- `paper trade`
- `paper balance`
- `Telegram alerts`
- `BTC/USD`
- `1-minute Coinbase candles`
- `tiered 5% risk cap`

Avoid:

- `live real-money trade`
- `guaranteed profit`
- `real account balance`
- `email alert`
- `synthetic data`

Suggested warning copy:

```txt
Bullseye is currently paper trading only. It does not place real exchange orders.
```

## Responsive Requirements

Desktop:

- Chart should be the largest component.
- Bot/risk/backtest panels should be scannable alongside chart.
- Trade journal can remain full width.

Tablet:

- Use a stacked or two-column hybrid.
- Preserve chart readability.

Mobile:

- Single column.
- Header wraps without overflow.
- Chart remains first.
- Tables scroll horizontally or collapse into cards.
- Touch targets should be at least `44px` high.

## States To Design

Each major component should have states for:

- Loading
- Empty
- Success
- Error
- Offline/API disconnected

Specific states:

- No active trade
- Bot offline
- API offline
- Telegram not configured
- Backtest running
- Backtest failed because real data source failed
- No saved backtests
- No trade journal entries

## Accessibility Requirements

- Maintain text contrast on black backgrounds.
- Do not rely on color alone for BUY/SELL or profit/loss.
- Use readable focus states.
- Buttons must have clear labels.
- Tables should remain keyboard-scrollable.
- Chart hover info should not be the only place where current price is visible.

## Designer Deliverables

Expected handoff:

- Desktop dashboard mockup.
- Mobile dashboard mockup.
- Component states.
- Color tokens.
- Typography scale.
- Spacing scale.
- Button/input/table styles.
- Chart visual spec.
- Empty/error/loading state examples.

Preferred format:

- Figma file or equivalent.
- Exported PNG previews for desktop and mobile.
- Notes on interactions and responsive behavior.

## Engineering Acceptance Criteria

The frontend redesign is accepted only if:

- `npm run validate` passes from the repository root.
- `cd frontend && npm run build` passes.
- No fake/random market data is introduced.
- The chart still uses real Coinbase `BTC-USD` 1-minute OHLC candles.
- Manual lot choices remain exactly two-decimal BTC steps from `0.01` through `0.08 BTC`.
- Telegram test alert remains available.
- UI clearly says paper trading where needed.
- Mobile and desktop layouts are usable.
- No auth is reintroduced unless explicitly requested.

## Implementation Notes

The designer can redesign markup and CSS, but should avoid changing backend behavior or trading logic.

If component restructuring is needed, keep API calls centralized through:

```txt
frontend/src/services/api.js
```

If adding dependencies, justify them. The current app intentionally keeps frontend dependencies light.

## Current Known Design Issues

- Some components use inline styles and should be moved toward reusable classes.
- Card hierarchy can be improved.
- Backtester controls are dense and need better grouping.
- Trade journal can be made more compact and readable.
- Mobile table behavior needs careful design.
- The chart is custom SVG and may need dedicated design/engineering attention.

## Final Design Principle

Bullseye should feel like a real trading terminal for disciplined paper trading: black, precise, fast to scan, and honest about risk.
