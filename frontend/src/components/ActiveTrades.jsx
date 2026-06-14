import React, { useState, useEffect } from 'react';
import { fetchActiveTrades, closeTrade, createPriceWebSocket } from '../services/api';

const ActiveTrades = () => {
    const [trades, setTrades] = useState([]);
    const [currentPrice, setCurrentPrice] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadTrades = async () => {
            try {
                const data = await fetchActiveTrades();
                setTrades(data);
            } catch (error) {
                console.error('Failed to fetch active trades', error);
            } finally {
                setLoading(false);
            }
        };

        loadTrades();
        
        // Listen to WebSocket for live price updates
        const ws = createPriceWebSocket((message) => {
            if (message.type === 'price') {
                setCurrentPrice(message.data.price);
            }
        });

        const interval = setInterval(loadTrades, 5000); // Sync trades list every 5s
        
        return () => {
            clearInterval(interval);
            ws.close();
        };
    }, []);

    const handleExit = async (id) => {
        try {
            await closeTrade(id);
            // Remove from list or reload
            setTrades(prev => prev.filter(t => t.id !== id));
        } catch (error) {
            alert('Failed to exit trade: ' + (error.error || error.message));
        }
    };

    const calculatePnL = (trade) => {
        if (!currentPrice) return 0;
        if (trade.action === 'BUY') {
            return (currentPrice - trade.entry_price) * trade.quantity;
        } else {
            return (trade.entry_price - currentPrice) * trade.quantity;
        }
    };

    return (
        <div className="active-trades-container">
            <div className="panel-heading">
                <div>
                    <h2>Live Signals & Active Trades</h2>
                    <p className="panel-kicker">Realtime P&L is based on the live BTC/USD price stream.</p>
                </div>
            </div>
            {loading ? (
                <div className="state-panel loading-state">Loading active trades...</div>
            ) : trades.length === 0 ? (
                <div className="state-panel empty-state">
                    <strong>No active trades right now.</strong>
                    <span>Waiting for the next valid paper trade or manual entry.</span>
                </div>
            ) : (
                <div className="active-trades-grid">
                    {trades.map(trade => {
                        const pnl = calculatePnL(trade);
                        return (
                            <div key={trade.id} className={`active-trade-card ${trade.action.toLowerCase()}`}>
                                <div className="trade-header">
                                    <span className="action">{trade.action}</span>
                                    <span className={`pnl ${pnl >= 0 ? 'profit' : 'loss'}`}>
                                        {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                                    </span>
                                </div>
                                <div className="trade-details trade-detail-grid">
                                    <p><strong>Entry</strong><span>${trade.entry_price?.toFixed(2)}</span></p>
                                    <p><strong>Live Price</strong><span>${currentPrice.toFixed(2)}</span></p>
                                    <p><strong>SL</strong><span>${trade.sl?.toFixed(2) || 'N/A'}</span></p>
                                    <p><strong>TP2</strong><span>${trade.tp2?.toFixed(2) || 'N/A'}</span></p>
                                </div>
                                <button 
                                    className="btn-exit" 
                                    onClick={() => handleExit(trade.id)}
                                >
                                    EXIT NOW
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default ActiveTrades;
