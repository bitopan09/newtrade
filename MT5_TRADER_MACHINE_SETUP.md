# MT5 Trader Machine Setup Plan

## Goal

Set up the Windows trader machine to run Octa MT5 demo and execute BTCUSD demo trades from the analysis engine running on another device in the same local network.

This setup is demo-only first. Live trading must stay disabled until latency, slippage, spread, rejected orders, broker behavior, and net PnL are proven on demo.

## Architecture

Device A: Analysis Engine

- Runs the current Node project.
- Receives the fast BTC price feed.
- Runs latency-gap decision logic.
- Exposes the MT5 bridge endpoint over LAN.

Device B: Trader Machine

- Windows machine running Octa MT5.
- Runs an MT5 Expert Advisor on the BTCUSD chart.
- Sends Octa bid/ask price to Device A.
- Receives HOLD, BUY, SELL, or CLOSE commands.
- Executes demo trades in MT5.

Flow:

```text
Octa MT5 EA -> Node bridge: BTCUSD bid/ask/spread
Node latency engine -> EA response: HOLD/BUY/SELL/CLOSE
EA -> Octa MT5 demo account: execute order
EA -> Node bridge: execution report
```

## Trader Machine Requirements

- Windows 10, Windows 11, or Windows VPS.
- Octa MT5 installed.
- Octa MT5 demo account logged in.
- BTCUSD symbol visible in Market Watch.
- Stable LAN connection to the analysis machine.
- AutoTrading enabled in MT5.
- Machine sleep disabled during testing.
- Windows time synchronization enabled.

## Network Requirements

Both devices must be on the same Wi-Fi/LAN.

Device A must expose the backend on:

```text
http://DEVICE_A_IP:5001
```

Example:

```text
http://192.168.1.25:5001
```

The trader machine must be able to open this URL in a browser:

```text
http://192.168.1.25:5001/api/health
```

If this fails, check the firewall on Device A and allow inbound traffic on port `5001`.

## MT5 WebRequest Setup

In Octa MT5 on the trader machine:

1. Open `Tools`.
2. Open `Options`.
3. Go to `Expert Advisors`.
4. Enable `Allow algorithmic trading`.
5. Enable `Allow WebRequest for listed URL`.
6. Add the analysis engine base URL:

```text
http://192.168.1.25:5001
```

Use the actual LAN IP of Device A.

## MT5 Chart Setup

1. Open Octa MT5.
2. Login to the demo account.
3. Open `Market Watch`.
4. Find `BTCUSD`.
5. Open a `BTCUSD` chart.
6. Attach the latency bridge EA to this chart.
7. Enable AutoTrading.
8. Confirm the EA shows connected/heartbeat status.

## EA Inputs

The EA should expose these inputs:

```text
NodeBaseUrl=http://192.168.1.25:5001
BridgeToken=change-this-secret
SymbolName=BTCUSD
LotSize=0.01
PollIntervalMs=100
MaxSpreadUsd=15
MaxHoldMs=5000
DemoOnly=true
```

Initial testing should use:

```text
DemoOnly=true
LotSize=0.01
PollIntervalMs=100
```

## Backend Environment Settings

The analysis engine should use safe demo settings:

```env
EXECUTION_MODE=mt5_demo
MT5_BRIDGE_TOKEN=change-this-secret
MT5_SYMBOL=BTCUSD
MT5_LOT=0.01
LATENCY_OBSERVE_ONLY=true
LATENCY_MIN_GAP_USD=30
LATENCY_MAX_SPREAD_USD=15
LATENCY_MAX_HOLD_MS=5000
LATENCY_MAX_TRADES_PER_MINUTE=2
LATENCY_ONE_TRADE_ONLY=true
```

Start with:

```env
LATENCY_OBSERVE_ONLY=true
```

Only switch to demo execution after logs confirm the gap is real and large enough after spread.

## Observe-Only Test

Purpose: measure whether Octa MT5 is actually behind the fast feed.

The EA sends every tick/sample:

```json
{
  "symbol": "BTCUSD",
  "bid": 65000.00,
  "ask": 65005.00,
  "spread": 5.00,
  "timestamp": "MT5 time",
  "token": "secret"
}
```

Node logs:

- Fast feed price.
- Octa bid.
- Octa ask.
- Spread.
- BUY gap.
- SELL gap.
- Local receive time.
- MT5 timestamp.
- Decision that would have happened.

No trades are opened in observe-only mode.

## Demo Trading Rules

BUY condition:

```text
fastPrice - octaAsk >= LATENCY_MIN_GAP_USD
```

SELL condition:

```text
octaBid - fastPrice >= LATENCY_MIN_GAP_USD
```

Trade only if:

- `EXECUTION_MODE=mt5_demo`.
- `LATENCY_OBSERVE_ONLY=false`.
- Spread is below max spread.
- No existing open trade if one-trade-only is enabled.
- Trades per minute limit is not exceeded.
- Bridge token is valid.
- Symbol matches `BTCUSD`.

## Order Management

For demo phase:

- Open only `0.01` lot.
- Use market orders.
- Keep max one open trade.
- Auto-close when gap closes or max hold time expires.
- Record order ticket, fill price, slippage, open time, close time, and PnL.
- If an order fails, report the MT5 error code back to Node.

## Safety Controls

Required controls:

- Demo-only default.
- Token auth between MT5 EA and Node.
- Backend kill switch.
- Max spread filter.
- Max lot size.
- Max trades per minute.
- Max open trades.
- Max hold time.
- Duplicate signal protection.
- Execution reports for every order attempt.
- Full latency and slippage logs.

## Broker Risk

This strategy depends on broker price lag. Some brokers may reject orders, delay fills, widen spreads, increase slippage, restrict accounts, or consider latency arbitrage against their terms.

Do not enable live execution unless demo testing proves stable execution and you have checked the broker rules for your account type.

## Run Sequence

1. Start the Node backend on Device A.
2. Confirm backend health from the trader machine browser:

```text
http://DEVICE_A_IP:5001/api/health
```

3. Open Octa MT5 demo on the trader machine.
4. Attach the EA to the BTCUSD chart.
5. Confirm EA heartbeat reaches Node.
6. Run observe-only mode for several hours.
7. Review latency logs.
8. If profitable gaps are consistent, enable demo execution.
9. Run demo execution with `0.01` lot.
10. Review fills, slippage, spread, close timing, and PnL.
11. Tune thresholds.
12. Do not enable live trading until demo results are stable.

## Acceptance Criteria

Observe-only is successful if:

- EA sends MT5 ticks reliably.
- Node receives ticks with low LAN delay.
- Logs show fast feed vs Octa gap.
- No duplicate or malformed signals occur.
- Gap measurements are large enough after spread to justify demo testing.

Demo execution is successful if:

- EA opens and closes demo trades correctly.
- Orders are not repeatedly rejected.
- Slippage is logged.
- Spread guard blocks bad conditions.
- Max hold and kill switch work.
- Net demo PnL after spread is measurable.

## Troubleshooting

If EA cannot connect:

- Confirm Device A IP is correct.
- Confirm backend is running on port `5001`.
- Open `/api/health` from the trader machine browser.
- Check Windows or macOS firewall.
- Confirm the MT5 WebRequest URL is added exactly.

If no trades happen:

- Check `LATENCY_OBSERVE_ONLY`.
- Check minimum gap threshold.
- Check spread threshold.
- Check symbol name is exactly `BTCUSD`.
- Check one-trade-only lock.
- Check max trades per minute.

If trades are rejected:

- Check Octa demo account permissions.
- Check minimum lot size.
- Check symbol trading hours.
- Check MT5 error code.
- Check spread and market status.

If trades lose despite visible gap:

- Gap may disappear before execution.
- Broker spread may be too high.
- Broker execution may be delayed.
- Fast feed and Octa BTCUSD may not use the same pricing source.
- Increase minimum gap or stop trading that condition.

## Live Trading Rule

Live trading must remain disabled until demo testing proves:

- Stable execution.
- Low slippage.
- Positive expectancy after spread.
- No broker-side rejection pattern.
- Safe kill switch behavior.
- Clear understanding of broker rules and account risk.
