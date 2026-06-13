import React, { useEffect, useState } from 'react';
import { createPriceWebSocket, fetchCandles } from '../services/api';

const CHART_WIDTH = 1000;
const CHART_HEIGHT = 300;
const PADDING = { top: 20, right: 72, bottom: 30, left: 12 };
const CANDLE_GRANULARITY_SECONDS = 60;

const formatPrice = (value) => `$${Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

const LiveChart = () => {
    const [candles, setCandles] = useState([]);
    const [hovered, setHovered] = useState(null);
    const [error, setError] = useState('');

    const loadCandles = async () => {
        try {
            const data = await fetchCandles(80, CANDLE_GRANULARITY_SECONDS);
            setCandles((data.candles || []).map(candle => ({
                ...candle,
                timestamp: new Date(candle.timestamp),
                open: Number(candle.open),
                high: Number(candle.high),
                low: Number(candle.low),
                close: Number(candle.close),
                volume: Number(candle.volume)
            })));
            setError('');
        } catch (loadError) {
            console.error('Error fetching real candle data:', loadError);
            setError('Could not load real Coinbase candles');
        }
    };

    useEffect(() => {
        loadCandles();
        const refresh = setInterval(loadCandles, 60000);

        const socket = createPriceWebSocket((msg) => {
            const payload = msg.type === 'price' ? msg.data : msg;
            const price = Number(payload?.price);
            if (!Number.isFinite(price)) return;

            const tickTime = new Date(payload.timestamp || Date.now());
            setCandles(prev => {
                if (prev.length === 0) return prev;

                const last = prev[prev.length - 1];
                const lastStart = last.timestamp.getTime();
                const nextStart = lastStart + CANDLE_GRANULARITY_SECONDS * 1000;

                if (tickTime.getTime() >= nextStart) {
                    loadCandles();
                    return prev;
                }

                const updated = {
                    ...last,
                    close: price,
                    high: Math.max(last.high, price),
                    low: Math.min(last.low, price),
                    timestamp: last.timestamp
                };

                return [...prev.slice(0, -1), updated];
            });
        });

        return () => {
            clearInterval(refresh);
            socket.close();
        };
    }, []);

    const latest = candles[candles.length - 1];
    const minLow = candles.length ? Math.min(...candles.map(candle => candle.low)) : 0;
    const maxHigh = candles.length ? Math.max(...candles.map(candle => candle.high)) : 1;
    const priceRange = Math.max(maxHigh - minLow, 1);
    const innerWidth = CHART_WIDTH - PADDING.left - PADDING.right;
    const innerHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
    const candleSlot = candles.length > 1 ? innerWidth / candles.length : innerWidth;
    const candleWidth = Math.max(3, Math.min(10, candleSlot * 0.58));

    const yFor = (price) => PADDING.top + ((maxHigh - price) / priceRange) * innerHeight;
    const xFor = (index) => PADDING.left + (index * candleSlot) + candleSlot / 2;
    const levels = [maxHigh, maxHigh - priceRange * 0.25, maxHigh - priceRange * 0.5, maxHigh - priceRange * 0.75, minLow];

    return (
        <div className="chart-container">
            <h2>Live BTC/USD 1-Min Candles</h2>
            <div style={{ width: '100%', overflow: 'hidden' }}>
                <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} width="100%" height="300" role="img" aria-label="Live Coinbase BTC/USD candlestick chart">
                    <rect x="0" y="0" width={CHART_WIDTH} height={CHART_HEIGHT} fill="rgba(15,23,42,0.35)" rx="12" />

                    {levels.map((level) => {
                        const y = yFor(level);
                        return (
                            <g key={level}>
                                <line x1={PADDING.left} y1={y} x2={CHART_WIDTH - PADDING.right} y2={y} stroke="rgba(148,163,184,0.12)" />
                                <text x={CHART_WIDTH - PADDING.right + 8} y={y + 4} fill="#94a3b8" fontSize="12" fontFamily="JetBrains Mono, monospace">
                                    {formatPrice(level)}
                                </text>
                            </g>
                        );
                    })}

                    {candles.map((candle, index) => {
                        const bullish = candle.close >= candle.open;
                        const color = bullish ? '#22c55e' : '#ef4444';
                        const x = xFor(index);
                        const openY = yFor(candle.open);
                        const closeY = yFor(candle.close);
                        const highY = yFor(candle.high);
                        const lowY = yFor(candle.low);
                        const bodyTop = Math.min(openY, closeY);
                        const bodyHeight = Math.max(Math.abs(closeY - openY), 1.5);

                        return (
                            <g key={`${candle.timestamp.toISOString()}-${index}`} onMouseEnter={() => setHovered(candle)} onMouseLeave={() => setHovered(null)}>
                                <line x1={x} y1={highY} x2={x} y2={lowY} stroke={color} strokeWidth="1.4" />
                                <rect
                                    x={x - candleWidth / 2}
                                    y={bodyTop}
                                    width={candleWidth}
                                    height={bodyHeight}
                                    fill={bullish ? 'rgba(34,197,94,0.72)' : 'rgba(239,68,68,0.72)'}
                                    stroke={color}
                                    strokeWidth="1"
                                    rx="1.5"
                                />
                            </g>
                        );
                    })}

                    {latest && (
                        <>
                            <line x1={PADDING.left} y1={yFor(latest.close)} x2={CHART_WIDTH - PADDING.right} y2={yFor(latest.close)} stroke="#06b6d4" strokeDasharray="4 5" strokeWidth="1" />
                            <text x={PADDING.left} y={CHART_HEIGHT - 8} fill="#64748b" fontSize="12" fontFamily="JetBrains Mono, monospace">
                                {candles[0]?.timestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} IST
                            </text>
                            <text x={CHART_WIDTH - PADDING.right - 130} y={CHART_HEIGHT - 8} fill="#64748b" fontSize="12" fontFamily="JetBrains Mono, monospace">
                                {latest.timestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} IST
                            </text>
                        </>
                    )}
                </svg>
            </div>

            {hovered && (
                <div className="chart-info" style={{ marginTop: 0 }}>
                    <p><strong>{hovered.timestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</strong></p>
                    <p>O {formatPrice(hovered.open)} | H {formatPrice(hovered.high)} | L {formatPrice(hovered.low)} | C {formatPrice(hovered.close)}</p>
                </div>
            )}

            <div className="chart-info">
                <p>Current Price: {latest ? formatPrice(latest.close) : 'Loading real Coinbase candles...'}</p>
                <p>Last candle: {latest ? latest.timestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '...'}</p>
                <p>Source: Coinbase BTC-USD 1-minute OHLC candles | Candles: {candles.length}</p>
                {error && <p style={{ color: '#f87171' }}>{error}</p>}
            </div>
        </div>
    );
};

export default LiveChart;
