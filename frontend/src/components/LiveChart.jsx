import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    CandlestickSeries,
    CrosshairMode,
    LineStyle,
    createChart,
    createSeriesMarkers
} from 'lightweight-charts';
import { createPriceWebSocket, fetchActiveTrades, fetchCandles } from '../services/api';

const CANDLE_LIMITS = {
    desktop: 220,
    tablet: 160,
    mobile: 96,
    small: 72
};

const TIMEFRAMES = [
    { label: '1m', granularity: 60 },
    { label: '5m', granularity: 300 },
    { label: '15m', granularity: 900 },
    { label: '1h', granularity: 3600 },
    { label: '6h', granularity: 21600 }
];

const getChartProfile = () => {
    if (typeof window === 'undefined') return { candleLimit: CANDLE_LIMITS.desktop, compact: false };
    if (window.innerWidth <= 420) return { candleLimit: CANDLE_LIMITS.small, compact: true };
    if (window.innerWidth <= 768) return { candleLimit: CANDLE_LIMITS.mobile, compact: true };
    if (window.innerWidth <= 1024) return { candleLimit: CANDLE_LIMITS.tablet, compact: false };
    return { candleLimit: CANDLE_LIMITS.desktop, compact: false };
};

const formatPrice = (value) => `$${Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const formatTime = (time) => {
    if (!time) return '...';
    return new Date(Number(time) * 1000).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const toChartCandle = (candle) => ({
    time: Math.floor(new Date(candle.timestamp).getTime() / 1000),
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close)
});

const LiveChart = () => {
    const containerRef = useRef(null);
    const chartRef = useRef(null);
    const seriesRef = useRef(null);
    const markersRef = useRef(null);
    const dataRef = useRef([]);
    const priceLinesRef = useRef([]);
    const followLiveRef = useRef(true);
    const latestCandleRef = useRef(null);

    const [timeframe, setTimeframe] = useState('1m');
    const [chartProfile, setChartProfile] = useState(getChartProfile);
    const [followLive, setFollowLive] = useState(true);
    const [ohlc, setOhlc] = useState(null);
    const [activeTrades, setActiveTrades] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const selectedTimeframe = useMemo(
        () => TIMEFRAMES.find(item => item.label === timeframe) || TIMEFRAMES[0],
        [timeframe]
    );

    useEffect(() => {
        followLiveRef.current = followLive;
    }, [followLive]);

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
        if (!containerRef.current) return;

        const chart = createChart(containerRef.current, {
            autoSize: true,
            layout: {
                background: { color: 'transparent' },
                textColor: '#cbd5e1',
                fontFamily: 'JetBrains Mono, monospace'
            },
            grid: {
                vertLines: { color: 'rgba(148, 163, 184, 0.10)' },
                horzLines: { color: 'rgba(148, 163, 184, 0.10)' }
            },
            rightPriceScale: {
                borderColor: 'rgba(148, 163, 184, 0.18)',
                scaleMargins: { top: 0.12, bottom: 0.12 }
            },
            timeScale: {
                borderColor: 'rgba(148, 163, 184, 0.18)',
                timeVisible: true,
                secondsVisible: false,
                rightOffset: 8,
                barSpacing: chartProfile.compact ? 7 : 8,
                fixLeftEdge: false,
                fixRightEdge: false
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: {
                    color: 'rgba(47, 107, 255, 0.55)',
                    style: LineStyle.Dashed,
                    width: 1,
                    labelBackgroundColor: '#2f6bff'
                },
                horzLine: {
                    color: 'rgba(47, 107, 255, 0.55)',
                    style: LineStyle.Dashed,
                    width: 1,
                    labelBackgroundColor: '#2f6bff'
                }
            },
            handleScroll: {
                mouseWheel: true,
                pressedMouseMove: true,
                horzTouchDrag: true,
                vertTouchDrag: false
            },
            handleScale: {
                axisPressedMouseMove: true,
                mouseWheel: true,
                pinch: true
            },
            localization: {
                priceFormatter: price => formatPrice(price)
            }
        });

        const series = chart.addSeries(CandlestickSeries, {
            upColor: '#050505',
            downColor: '#f8fafc',
            borderUpColor: '#2f6bff',
            borderDownColor: '#f8fafc',
            wickUpColor: '#2f6bff',
            wickDownColor: '#f8fafc',
            priceLineColor: 'rgba(248, 250, 252, 0.80)',
            priceLineStyle: LineStyle.Dotted,
            lastValueVisible: true,
            priceLineVisible: true
        });

        chartRef.current = chart;
        seriesRef.current = series;
        markersRef.current = createSeriesMarkers(series, []);

        const handleCrosshair = (param) => {
            if (!param?.time || !seriesRef.current) {
                setOhlc(latestCandleRef.current);
                return;
            }

            const data = param.seriesData.get(seriesRef.current);
            if (data?.open !== undefined) {
                setOhlc({ time: param.time, open: data.open, high: data.high, low: data.low, close: data.close });
            }
        };

        chart.subscribeCrosshairMove(handleCrosshair);

        return () => {
            chart.unsubscribeCrosshairMove(handleCrosshair);
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
            markersRef.current = null;
            priceLinesRef.current = [];
        };
    }, []);

    useEffect(() => {
        chartRef.current?.applyOptions({
            timeScale: {
                barSpacing: chartProfile.compact ? 7 : 8
            }
        });
    }, [chartProfile.compact]);

    const loadCandles = useCallback(async () => {
        try {
            setLoading(true);
            const data = await fetchCandles(chartProfile.candleLimit, selectedTimeframe.granularity);
            const chartData = (data.candles || []).map(toChartCandle).filter(candle => Number.isFinite(candle.close));

            dataRef.current = chartData;
            seriesRef.current?.setData(chartData);

            const latest = chartData[chartData.length - 1] || null;
            latestCandleRef.current = latest;
            setOhlc(latest);
            setError('');

            if (followLiveRef.current) {
                chartRef.current?.timeScale().scrollToRealTime();
            }
        } catch (loadError) {
            console.error('Error fetching real candle data:', loadError);
            setError('Could not load real Coinbase candles');
        } finally {
            setLoading(false);
        }
    }, [chartProfile.candleLimit, selectedTimeframe.granularity]);

    useEffect(() => {
        loadCandles();
        const refresh = setInterval(loadCandles, 60000);

        return () => clearInterval(refresh);
    }, [loadCandles]);

    useEffect(() => {
        const socket = createPriceWebSocket((msg) => {
            const payload = msg.type === 'price' ? msg.data : msg;
            const price = Number(payload?.price);
            if (!Number.isFinite(price)) return;

            const candles = dataRef.current;
            const last = candles[candles.length - 1];
            if (!last) return;

            const tickTime = Math.floor(new Date(payload.timestamp || Date.now()).getTime() / 1000);
            const nextStart = last.time + selectedTimeframe.granularity;

            if (tickTime >= nextStart) {
                loadCandles();
                return;
            }

            const updated = {
                ...last,
                close: price,
                high: Math.max(last.high, price),
                low: Math.min(last.low, price)
            };

            dataRef.current = [...candles.slice(0, -1), updated];
            latestCandleRef.current = updated;
            setOhlc(updated);
            seriesRef.current?.update(updated);

            if (followLiveRef.current) {
                chartRef.current?.timeScale().scrollToRealTime();
            }
        });

        return () => socket.close();
    }, [loadCandles, selectedTimeframe.granularity]);

    useEffect(() => {
        const loadTrades = async () => {
            try {
                const trades = await fetchActiveTrades();
                setActiveTrades(Array.isArray(trades) ? trades : []);
            } catch (tradeError) {
                console.error('Failed to load active chart overlays:', tradeError);
            }
        };

        loadTrades();
        const interval = setInterval(loadTrades, 5000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const series = seriesRef.current;
        if (!series) return;

        priceLinesRef.current.forEach(line => series.removePriceLine(line));
        priceLinesRef.current = [];

        const addPriceLine = (price, color, title, style = LineStyle.Dashed) => {
            const number = Number(price);
            if (!Number.isFinite(number)) return;

            priceLinesRef.current.push(series.createPriceLine({
                price: number,
                color,
                lineWidth: 1,
                lineStyle: style,
                axisLabelVisible: true,
                title
            }));
        };

        const markerTime = latestCandleRef.current?.time || dataRef.current[dataRef.current.length - 1]?.time;
        const markers = [];

        activeTrades.forEach(trade => {
            const action = String(trade.action || '').toUpperCase();
            const isBuy = action === 'BUY';

            addPriceLine(trade.entry_price, isBuy ? '#2f6bff' : '#f8fafc', `${action || 'TRADE'} ENTRY`, LineStyle.Solid);
            addPriceLine(trade.sl, '#ef4444', 'SL', LineStyle.Dashed);
            addPriceLine(trade.tp1, '#10b981', 'TP1', LineStyle.Dotted);
            addPriceLine(trade.tp2, '#22c55e', 'TP2', LineStyle.Dashed);

            if (markerTime) {
                markers.push({
                    time: markerTime,
                    position: isBuy ? 'belowBar' : 'aboveBar',
                    color: isBuy ? '#2f6bff' : '#f8fafc',
                    shape: isBuy ? 'arrowUp' : 'arrowDown',
                    text: `${action || 'TRADE'} ${trade.quantity || 0.01} BTC`
                });
            }
        });

        markersRef.current?.setMarkers(markers);
    }, [activeTrades, ohlc]);

    const resetChart = () => {
        chartRef.current?.timeScale().fitContent();
    };

    const toggleFollowLive = () => {
        setFollowLive(prev => {
            const next = !prev;
            if (next) chartRef.current?.timeScale().scrollToRealTime();
            return next;
        });
    };

    const displayedOhlc = ohlc || latestCandleRef.current;

    return (
        <div className="chart-container">
            <div className="live-chart-header">
                <div>
                    <h2 style={{ marginBottom: 0 }}>BTC/USD {timeframe}</h2>
                    <div className="live-chart-source">
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 10px #22c55e' }} />
                        <span>{chartProfile.compact ? 'Coinbase live' : 'Coinbase Live OHLC'}</span>
                    </div>
                </div>

                <div className="chart-toolbar">
                    <div className="timeframe-tabs">
                        {TIMEFRAMES.map(item => (
                            <button
                                key={item.label}
                                className={item.label === timeframe ? 'active' : ''}
                                onClick={() => setTimeframe(item.label)}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                    <div className="chart-actions">
                        <button className={followLive ? 'active' : ''} onClick={toggleFollowLive}>{followLive ? 'Live On' : 'Live Off'}</button>
                        <button onClick={resetChart}>Reset</button>
                    </div>
                </div>
            </div>

            <div className="ohlc-strip">
                <span>{loading ? 'Loading real candles...' : formatTime(displayedOhlc?.time)} IST</span>
                <span>O <strong>{formatPrice(displayedOhlc?.open)}</strong></span>
                <span>H <strong>{formatPrice(displayedOhlc?.high)}</strong></span>
                <span>L <strong>{formatPrice(displayedOhlc?.low)}</strong></span>
                <span>C <strong>{formatPrice(displayedOhlc?.close)}</strong></span>
                {activeTrades.length > 0 && <span className="chart-overlay-pill">{activeTrades.length} active overlay{activeTrades.length === 1 ? '' : 's'}</span>}
            </div>

            <div ref={containerRef} className="live-chart-wrap" />

            <div className="chart-info">
                <p>Current Price: {formatPrice(latestCandleRef.current?.close)}</p>
                <p>Timeframe: {timeframe} candles</p>
                <p>Interactive: pan, zoom, pinch, crosshair</p>
                {error && <p style={{ color: '#f87171' }}>{error}</p>}
            </div>
        </div>
    );
};

export default LiveChart;
