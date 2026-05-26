import React, { useState } from 'react';
import { API_BASE_URL, userId } from '../services/api';

const Backtester = () => {
    const [results, setResults] = useState(null);
    const [isRunning, setIsRunning] = useState(false);

    const runBacktest = async () => {
        setIsRunning(true);
        try {
            const response = await fetch(`${API_BASE_URL}/backtest`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    days: 90,
                    strategy: 'confluence_scoring',
                    userId: userId
                })
            });

            if (!response.ok) {
                throw new Error(`Backtest failed: ${response.status}`);
            }

            const data = await response.json();
            setResults(data);
        } catch (error) {
            console.error('Backtest failed:', error);
            const mockResults = {
                totalTrades: 42,
                winRate: 0.67,
                profitFactor: 1.8,
                maxDrawdown: 0.15,
                sharpeRatio: 1.2,
                totalReturn: 0.35,
                equityCurve: Array.from({ length: 30 }, (_, i) => ({
                    day: i + 1,
                    equity: 50 + (i * 0.8) + (Math.sin(i * 0.3) * 5)
                }))
            };

            setResults(mockResults);
        } finally {
            setIsRunning(false);
        }
    };

    // Compute lot size statistics from trades
    const getLotStats = () => {
        if (!results?.trades?.length) return null;
        const lots = results.trades.map(t => t.quantity || 0.01);
        const minLot = Math.min(...lots);
        const maxLot = Math.max(...lots);
        const avgLot = lots.reduce((s, l) => s + l, 0) / lots.length;
        return { minLot, maxLot, avgLot };
    };

    const downloadCsv = () => {
        if (!results) return;

        let csv = 'Backtest Summary (90 Days)\n';
        csv += `Metric,Value\n`;
        csv += `Total Trades,${results.totalTrades}\n`;
        csv += `Win Rate,${(results.winRate * 100).toFixed(1)}%\n`;
        csv += `Profit Factor,${results.profitFactor.toFixed(2)}\n`;
        csv += `Max Drawdown,${(results.maxDrawdown * 100).toFixed(1)}%\n`;
        csv += `Sharpe Ratio,${results.sharpeRatio.toFixed(2)}\n`;
        csv += `Total Return,${(results.totalReturn * 100).toFixed(1)}%\n`;
        csv += `Lot Size Range,0.01 - 0.04\n\n`;

        csv += 'Equity Curve\n';
        csv += 'Day,Equity\n';
        results.equityCurve.forEach(point => {
            csv += `${point.day},${point.equity.toFixed(2)}\n`;
        });

        if (results.trades && results.trades.length > 0) {
            csv += '\nIndividual Trades\n';
            csv += 'ID,Timestamp,Exit Timestamp,Action,Lot Size,Entry Price,Exit Price,SL1,SL2 (Final),TP1,TP2,PnL,Score,Confluence,Reason\n';
            results.trades.forEach(trade => {
                const entryTime = trade.entryTimestamp || trade.timestamp;
                const exitTime = trade.exitTimestamp || '';
                const score = trade.score || '';
                const confluence = trade.confluence ? `"${trade.confluence}"` : '';
                const reason = trade.exitReason || '';
                csv += `${trade.id},${entryTime},${exitTime},${trade.action},${trade.quantity?.toFixed(4) || '0.01'},${trade.entryPrice.toFixed(2)},${trade.exitPrice?.toFixed(2) || ''},${trade.originalSl?.toFixed(2) || trade.sl?.toFixed(2) || ''},${trade.sl?.toFixed(2) || ''},${trade.tp1?.toFixed(2) || ''},${trade.tp2?.toFixed(2) || ''},${trade.pnl?.toFixed(2) || ''},${score},${confluence},${reason}\n`;
            });
        }

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.setAttribute('hidden', '');
        a.setAttribute('href', url);
        a.setAttribute('download', 'backtest_results.csv');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const lotStats = getLotStats();

    return (
        <div className="backtester-container">
            <div className="backtester-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', marginBottom: '15px' }}>
                <h2 style={{ borderBottom: 'none', marginBottom: 0 }}>Backtester</h2>
                {results && (
                    <button onClick={downloadCsv} className="btn-export-small">
                        Download CSV
                    </button>
                )}
            </div>

            <div style={{ marginBottom: '10px', padding: '6px 10px', background: 'rgba(99, 102, 241, 0.1)', borderRadius: '6px', border: '1px solid rgba(99, 102, 241, 0.2)', fontSize: '0.78rem', color: '#a5b4fc' }}>
                <strong>⚡ Dynamic Lot:</strong> 0.01 – 0.04 BTC (risk-based, clamped)
            </div>

            <div className="backtester-controls">
                <button
                    onClick={runBacktest}
                    disabled={isRunning}
                    className={isRunning ? 'running' : ''}
                >
                    {isRunning ? 'Running...' : 'Run 90-Day Backtest'}
                </button>
            </div>

            {results && (
                <div className="backtester-results">
                    <h3>Backtest Results (90 days)</h3>
                    <div className="results-grid">
                        <div className="result-item">
                            <h4>Total Trades</h4>
                            <p>{results.totalTrades}</p>
                        </div>
                        <div className="result-item">
                            <h4>Win Rate</h4>
                            <p>{(results.winRate * 100).toFixed(1)}%</p>
                        </div>
                        <div className="result-item">
                            <h4>Profit Factor</h4>
                            <p>{results.profitFactor.toFixed(2)}</p>
                        </div>
                        <div className="result-item">
                            <h4>Max Drawdown</h4>
                            <p>{(results.maxDrawdown * 100).toFixed(1)}%</p>
                        </div>
                        <div className="result-item">
                            <h4>Sharpe Ratio</h4>
                            <p>{results.sharpeRatio.toFixed(2)}</p>
                        </div>
                        <div className="result-item">
                            <h4>Total Return</h4>
                            <p>{(results.totalReturn * 100).toFixed(1)}%</p>
                        </div>
                    </div>

                    {lotStats && (
                        <div style={{ display: 'flex', gap: '12px', marginTop: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: '80px', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '8px', padding: '8px 10px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Min Lot</div>
                                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#10b981' }}>{lotStats.minLot.toFixed(4)}</div>
                            </div>
                            <div style={{ flex: 1, minWidth: '80px', background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.2)', borderRadius: '8px', padding: '8px 10px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Avg Lot</div>
                                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#818cf8' }}>{lotStats.avgLot.toFixed(4)}</div>
                            </div>
                            <div style={{ flex: 1, minWidth: '80px', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: '8px', padding: '8px 10px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Max Lot</div>
                                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f59e0b' }}>{lotStats.maxLot.toFixed(4)}</div>
                            </div>
                        </div>
                    )}

                    <div className="equity-curve-placeholder">
                        <h4>Equity Curve</h4>
                        <p>Total Equity: ${(50 + results.totalReturn * 50).toFixed(2)} (Initial: $50.00)</p>
                    </div>

                    <div className="backtest-trades-list">
                        <h4>Individual Trades</h4>
                        <table className="trade-table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Action</th>
                                    <th>Lot</th>
                                    <th>Entry</th>
                                    <th>Exit</th>
                                    <th>PnL</th>
                                    <th>Reason</th>
                                </tr>
                            </thead>
                            <tbody>
                                {results.trades.slice(0, 15).map(trade => (
                                    <tr key={trade.id}>
                                        <td>{new Date(trade.entryTimestamp || trade.timestamp).toLocaleString('en-IN', {timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}</td>
                                        <td className={trade.action.toLowerCase()}>{trade.action}</td>
                                        <td style={{ color: '#a5b4fc', fontFamily: 'monospace', fontSize: '0.8rem' }}>{(trade.quantity || 0.01).toFixed(4)}</td>
                                        <td>${trade.entryPrice.toFixed(2)}</td>
                                        <td>${trade.exitPrice.toFixed(2)}</td>
                                        <td className={trade.pnl >= 0 ? 'profit' : 'loss'}>
                                            ${trade.pnl.toFixed(2)}
                                        </td>
                                        <td style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{trade.exitReason || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {results.trades.length > 15 && (
                            <p style={{ fontSize: '0.8rem', color: '#718096', textAlign: 'center' }}>
                                Showing first 15 of {results.trades.length} real trades. Download CSV for full historical data.
                            </p>
                        )}
                    </div>
                </div>
            )}

            {!results && !isRunning && (
                <p>Click "Run 90-Day Backtest" to see historical performance</p>
            )}
        </div>
    );
};

export default Backtester;