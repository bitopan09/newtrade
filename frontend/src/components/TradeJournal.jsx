import React, { useState, useEffect } from 'react';
import { exportTradesCsvUrl, fetchTrades, getSelectedTerminal } from '../services/api';
import { formatTimeIST } from '../utils/timeFormatter';

const TradeJournal = () => {
    const [trades, setTrades] = useState([]);
    const [loading, setLoading] = useState(true);
    const terminal = getSelectedTerminal();

    useEffect(() => {
        const fetchTradesData = async () => {
            try {
                setLoading(true);
                const data = await fetchTrades();
                setTrades(data);
                setLoading(false);
            } catch (error) {
                console.error('Error fetching trades:', error);
                setLoading(false);
            }
        };

        fetchTradesData();
        // Refresh trades every 30 seconds
        const interval = setInterval(fetchTradesData, 30000);
        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return (
            <div className="journal-container">
                <h2>Trade Journal</h2>
                <p>Loading trade data...</p>
            </div>
        );
    }

    return (
        <div className="journal-container">
            <div className="journal-header">
                <div>
                    <h2 className="compact-heading">Trade Journal (Paper Trading)</h2>
                    <small>Terminal: {terminal?.displayName || 'Selected'}</small>
                </div>
                <a href={exportTradesCsvUrl()} className="btn-export" download="trade_journal.csv">
                    Export CSV
                </a>
            </div>
            {trades.length === 0 ? (
                <div className="state-panel empty-state">
                    <strong>No paper trades recorded yet.</strong>
                    <span>Trades will appear here after manual or bot paper execution.</span>
                </div>
            ) : (
                <div className="trade-table-wrap">
                    <table className="trade-table">
                        <thead>
                            <tr>
                                <th>Date (IST)</th>
                                <th>Action</th>
                                <th>Entry</th>
                                <th>Exit</th>
                                <th>SL / TP1 / TP2</th>
                                <th>Status</th>
                                <th>Qty</th>
                                <th>P&L</th>
                                <th>Notes</th>
                            </tr>
                        </thead>
                        <tbody>
                            {trades.map(trade => (
                                <tr key={trade.id}>
                                    <td>{formatTimeIST(trade.timestamp, 'date-time')}</td>
                                    <td><strong className={`action-text ${trade.action?.toLowerCase()}`}>{trade.action}</strong></td>
                                    <td>${trade.entry_price?.toFixed(2) || 'N/A'}</td>
                                    <td>{trade.exit_price ? '$'+trade.exit_price.toFixed(2) : 'Open'}</td>
                                    <td className="levels-cell">
                                        SL: {trade.sl ? trade.sl.toFixed(2) : '-'} <br/>
                                        TP1: {trade.tp1 ? trade.tp1.toFixed(2) : '-'} <br/>
                                        TP2: {trade.tp2 ? trade.tp2.toFixed(2) : '-'}
                                    </td>
                                    <td><span className={`status-${trade.status?.toLowerCase() || 'open'}`}>{trade.status || 'OPEN'}</span></td>
                                    <td>{trade.quantity}</td>
                                    <td className={trade.pnl >= 0 ? 'profit' : 'loss'}>
                                        {trade.pnl !== null ? '$' + trade.pnl.toFixed(2) : 'Open'}
                                    </td>
                                    <td>{trade.exit_reason || trade.notes || '-'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default TradeJournal;
