import React, { useEffect, useState } from 'react';
import { createPriceWebSocket, fetchCandles } from '../services/api';

const CHART_WIDTH = 1200;
const CHART_HEIGHT = 560;
const PADDING = { top: 38, right: 96, bottom: 42, left: 8 };
const CANDLE_GRANULARITY_SECONDS = 60;

const getChartProfile = () => {
    if (typeof window === 'undefined') return { candleLimit: 140, compact: false };
    if (window.innerWidth <= 420) return { candleLimit: 56, compact: true };
    if (window.innerWidth <= 768) return { candleLimit: 72, compact: true };
    if (window.innerWidth <= 1024) return { candleLimit: 96, compact: false };
    return { candleLimit: 140, compact: false };
};

const formatPrice = (value) => `$${Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

const LiveChart = () => {
    const [candles, setCandles] = useState([]);
    const [hovered, setHovered] = useState(null);
    const [error, setError] = useState('');
    const [chartProfile, setChartProfile] = useState(getChartProfile);
    const candleLimit = chartProfile.candleLimit;
    const compactChart = chartProfile.compact;

    const loadCandles = async () => {
        try {
            const data = await fetchCandles(candleLimit, CANDLE_GRANULARITY_SECONDS);
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
        const handleResize = () => {
            setChartProfile(prev => {
                const next = getChartProfile();
                return next.candleLimit === prev.candleLimit && next.compact === prev.compact ? prev : next;
            });
        };

        window.addEventListener('resize', handleResize);

        return () => window.removeEventListener('resize', handleResize);
    }, []);

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
    }, [candleLimit]);

    const latest = candles[candles.length - 1];
    const hoveredCandle = hovered?.candle || null;
    const rawMinLow = candles.length ? Math.min(...candles.map(candle => candle.low)) : 0;
    const rawMaxHigh = candles.length ? Math.max(...candles.map(candle => candle.high)) : 1;
    const rawRange = Math.max(rawMaxHigh - rawMinLow, 1);
    const minLow = rawMinLow - rawRange * 0.08;
    const maxHigh = rawMaxHigh + rawRange * 0.08;
    const priceRange = Math.max(maxHigh - minLow, 1);
    const innerWidth = CHART_WIDTH - PADDING.left - PADDING.right;
    const innerHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
    const candleSlot = candles.length > 1 ? innerWidth / candles.length : innerWidth;
    const candleWidth = Math.max(3.5, Math.min(10, candleSlot * 0.58));

    const yFor = (price) => PADDING.top + ((maxHigh - price) / priceRange) * innerHeight;
    const xFor = (index) => PADDING.left + (index * candleSlot) + candleSlot / 2;
    const levelCount = compactChart ? 6 : 10;
    const verticalCount = compactChart ? 10 : 19;
    const levels = Array.from({ length: levelCount }, (_, index) => maxHigh - priceRange * (index / (levelCount - 1)));
    const verticalGrid = Array.from({ length: verticalCount }, (_, index) => PADDING.left + innerWidth * (index / (verticalCount - 1)));
    const latestY = latest ? yFor(latest.close) : null;
    const latestX = candles.length ? xFor(candles.length - 1) : null;
    const hoveredX = hovered ? xFor(hovered.index) : null;
    const hoveredY = hoveredCandle ? yFor(hoveredCandle.close) : null;
    const plotRight = CHART_WIDTH - PADDING.right;
    const plotBottom = CHART_HEIGHT - PADDING.bottom;

    return (
        <div className="chart-container">
            <div className="live-chart-header">
                <h2 style={{ marginBottom: 0 }}>BTC/USD 1m</h2>
                <div className="live-chart-source">
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 10px #22c55e' }} />
                    <span>{compactChart ? 'Coinbase 1m' : 'Coinbase Live OHLC'}</span>
                </div>
            </div>
            <div className="live-chart-wrap">
                <svg className="live-chart-svg" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} width="100%" role="img" aria-label="Live Coinbase BTC/USD candlestick chart">
                    <rect x="0" y="0" width={CHART_WIDTH} height={CHART_HEIGHT} fill="transparent" />
                    <rect x={PADDING.left} y={PADDING.top} width={innerWidth} height={innerHeight} fill="rgba(2,6,23,0.14)" stroke="rgba(148,163,184,0.16)" />

                    {verticalGrid.map((x, index) => (
                        <line
                            key={`v-${x}`}
                            x1={x}
                            y1={PADDING.top}
                            x2={x}
                            y2={plotBottom}
                            stroke={index % 5 === 0 ? 'rgba(148,163,184,0.24)' : 'rgba(148,163,184,0.10)'}
                            strokeWidth={index % 5 === 0 ? '1.15' : '0.75'}
                        />
                    ))}

                    {levels.map((level, index) => {
                        const y = yFor(level);
                        return (
                            <g key={level}>
                                <line
                                    x1={PADDING.left}
                                    y1={y}
                                    x2={plotRight}
                                    y2={y}
                                    stroke={index % 5 === 0 ? 'rgba(148,163,184,0.24)' : 'rgba(148,163,184,0.10)'}
                                    strokeWidth={index % 5 === 0 ? '1.15' : '0.75'}
                                />
                                <text x={plotRight + 10} y={y + 4} fill="rgba(226,232,240,0.78)" fontSize={compactChart ? '11' : '12'} fontFamily="JetBrains Mono, monospace">
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
                            <g key={`${candle.timestamp.toISOString()}-${index}`} onMouseEnter={() => setHovered({ candle, index })} onMouseLeave={() => setHovered(null)}>
                                <line x1={x} y1={highY} x2={x} y2={lowY} stroke={candleColor} strokeWidth="1.6" />
                                <rect
                                    x={x - candleWidth / 2}
                                    y={bodyTop}
                                    width={candleWidth}
                                    height={bodyHeight}
                                    fill={bullish ? '#050505' : '#f8fafc'}
                                    stroke={candleColor}
                                    strokeWidth="1.6"
                                />
                            </g>
                        );
                    })}

                    {latest && latestY !== null && latestX !== null && (
                        <>
                            <line x1={PADDING.left} y1={latestY} x2={plotRight} y2={latestY} stroke="rgba(255,255,255,0.74)" strokeDasharray="1 6" strokeLinecap="round" strokeWidth="1.4" />
                            <line x1={latestX} y1={PADDING.top} x2={latestX} y2={plotBottom} stroke="rgba(255,255,255,0.55)" strokeDasharray="7 8" strokeWidth="1.15" />
                            <rect x={plotRight + 6} y={latestY - 13} width="84" height="26" fill="rgba(15,23,42,0.96)" stroke="rgba(255,255,255,0.26)" />
                            <text x={plotRight + 12} y={latestY + 4} fill="#f8fafc" fontSize={compactChart ? '11' : '12'} fontFamily="JetBrains Mono, monospace">
                                {formatPrice(latest.close)}
                            </text>
                            <text x={PADDING.left + 6} y={CHART_HEIGHT - 10} fill="rgba(220,220,220,0.64)" fontSize="12" fontFamily="JetBrains Mono, monospace">
                                {candles[0]?.timestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} IST
                            </text>
                            <text x={plotRight - 132} y={CHART_HEIGHT - 10} fill="rgba(220,220,220,0.64)" fontSize="12" fontFamily="JetBrains Mono, monospace">
                                {latest.timestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} IST
                            </text>
                        </>
                    )}

                    {hoveredCandle && hoveredX !== null && hoveredY !== null && (
                        <>
                            <line x1={hoveredX} y1={PADDING.top} x2={hoveredX} y2={plotBottom} stroke="rgba(59,130,246,0.45)" strokeDasharray="4 5" strokeWidth="1" />
                            <line x1={PADDING.left} y1={hoveredY} x2={plotRight} y2={hoveredY} stroke="rgba(59,130,246,0.45)" strokeDasharray="4 5" strokeWidth="1" />
                            {!compactChart && (
                                <>
                                    <rect x={PADDING.left + 10} y="8" width="456" height="24" fill="rgba(2,6,23,0.82)" stroke="rgba(59,130,246,0.35)" />
                                    <text x={PADDING.left + 18} y="24" fill="#e2e8f0" fontSize="12" fontFamily="JetBrains Mono, monospace">
                                        {hoveredCandle.timestamp.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} IST  O {formatPrice(hoveredCandle.open)}  H {formatPrice(hoveredCandle.high)}  L {formatPrice(hoveredCandle.low)}  C {formatPrice(hoveredCandle.close)}
                                    </text>
                                </>
                            )}
                        </>
                    )}
                </svg>
            </div>

            {hoveredCandle && (
                <div className="chart-info" style={{ marginTop: 0 }}>
                    <p><strong>{hoveredCandle.timestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</strong></p>
                    <p>O {formatPrice(hoveredCandle.open)} | H {formatPrice(hoveredCandle.high)} | L {formatPrice(hoveredCandle.low)} | C {formatPrice(hoveredCandle.close)}</p>
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
