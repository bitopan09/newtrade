import React, { useEffect, useState } from 'react';
import { createPriceWebSocket, fetchCandles } from '../services/api';

const CHART_WIDTH = 1200;
const CHART_HEIGHT = 520;
const PADDING = { top: 18, right: 86, bottom: 34, left: 12 };
const CANDLE_GRANULARITY_SECONDS = 60;

const formatPrice = (value) => `$${Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

const LiveChart = () => {
    const [candles, setCandles] = useState([]);
    const [hovered, setHovered] = useState(null);
    const [error, setError] = useState('');

    const loadCandles = async () => {
        try {
            const data = await fetchCandles(110, CANDLE_GRANULARITY_SECONDS);
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
    const candleWidth = Math.max(4, Math.min(13, candleSlot * 0.64));

    const yFor = (price) => PADDING.top + ((maxHigh - price) / priceRange) * innerHeight;
    const xFor = (index) => PADDING.left + (index * candleSlot) + candleSlot / 2;
    const levels = Array.from({ length: 11 }, (_, index) => maxHigh - priceRange * (index / 10));
    const verticalGrid = Array.from({ length: 16 }, (_, index) => PADDING.left + innerWidth * (index / 15));
    const latestY = latest ? yFor(latest.close) : null;
    const latestX = candles.length ? xFor(candles.length - 1) : null;

    return (
        <div className="chart-container">
            <h2>BTC/USD 1m</h2>
            <div style={{ width: '100%', overflow: 'hidden' }}>
                <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} width="100%" height="520" role="img" aria-label="Live Coinbase BTC/USD candlestick chart">
                    <rect x="0" y="0" width={CHART_WIDTH} height={CHART_HEIGHT} fill="transparent" />

                    {verticalGrid.map((x, index) => (
                        <line
                            key={`v-${x}`}
                            x1={x}
                            y1="0"
                            x2={x}
                            y2={CHART_HEIGHT}
                            stroke={index % 5 === 0 ? 'rgba(148,163,184,0.24)' : 'rgba(148,163,184,0.10)'}
                            strokeWidth={index % 5 === 0 ? '1.15' : '0.75'}
                        />
                    ))}

                    {levels.map((level, index) => {
                        const y = yFor(level);
                        return (
                            <g key={level}>
                                <line
                                    x1="0"
                                    y1={y}
                                    x2={CHART_WIDTH}
                                    y2={y}
                                    stroke={index % 5 === 0 ? 'rgba(148,163,184,0.24)' : 'rgba(148,163,184,0.10)'}
                                    strokeWidth={index % 5 === 0 ? '1.15' : '0.75'}
                                />
                                <text x={CHART_WIDTH - PADDING.right + 10} y={y + 4} fill="rgba(226,232,240,0.78)" fontSize="12" fontFamily="JetBrains Mono, monospace">
                                    {formatPrice(level)}
                                </text>
                            </g>
                        );
                    })}

                    {candles.map((candle, index) => {
                        const bullish = candle.close >= candle.open;
                        const candleColor = bullish ? '#2f6bff' : '#f8fafc';
                        const x = xFor(index);
                        const openY = yFor(candle.open);
                        const closeY = yFor(candle.close);
                        const highY = yFor(candle.high);
                        const lowY = yFor(candle.low);
                        const bodyTop = Math.min(openY, closeY);
                        const bodyHeight = Math.max(Math.abs(closeY - openY), 1.5);

                        return (
                            <g key={`${candle.timestamp.toISOString()}-${index}`} onMouseEnter={() => setHovered(candle)} onMouseLeave={() => setHovered(null)}>
                                <line x1={x} y1={highY} x2={x} y2={lowY} stroke={candleColor} strokeWidth="1.6" />
                                <rect
                                    x={x - candleWidth / 2}
                                    y={bodyTop}
                                    width={candleWidth}
                                    height={bodyHeight}
                                    fill={bullish ? '#080808' : '#f8fafc'}
                                    stroke={candleColor}
                                    strokeWidth="1.6"
                                />
                            </g>
                        );
                    })}

                    {latest && latestY !== null && latestX !== null && (
                        <>
                            <line x1="0" y1={latestY} x2={CHART_WIDTH} y2={latestY} stroke="rgba(255,255,255,0.78)" strokeDasharray="1 6" strokeLinecap="round" strokeWidth="1.4" />
                            <line x1={latestX} y1="0" x2={latestX} y2={CHART_HEIGHT} stroke="rgba(255,255,255,0.62)" strokeDasharray="7 8" strokeWidth="1.2" />
                            <rect x={CHART_WIDTH - PADDING.right + 6} y={latestY - 12} width="76" height="24" fill="#111827" stroke="rgba(255,255,255,0.22)" />
                            <text x={CHART_WIDTH - PADDING.right + 12} y={latestY + 4} fill="#f8fafc" fontSize="12" fontFamily="JetBrains Mono, monospace">
                                {formatPrice(latest.close)}
                            </text>
                            <text x={PADDING.left + 6} y={CHART_HEIGHT - 10} fill="rgba(220,220,220,0.64)" fontSize="12" fontFamily="JetBrains Mono, monospace">
                                {candles[0]?.timestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} IST
                            </text>
                            <text x={CHART_WIDTH - PADDING.right - 132} y={CHART_HEIGHT - 10} fill="rgba(220,220,220,0.64)" fontSize="12" fontFamily="JetBrains Mono, monospace">
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
