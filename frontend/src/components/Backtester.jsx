import React, { useEffect, useState } from 'react';
import { API_BASE_URL, apiFetch, userId } from '../services/api';

const Backtester = () => {
    const [results, setResults] = useState(null);
    const [savedRuns, setSavedRuns] = useState([]);
    const [isRunning, setIsRunning] = useState(false);
    const [settings, setSettings] = useState({
        days: 90,
        riskPercentage: 5,
        maxDailyTrades: 1,
        maxDailyLosses: 1,
        minConfluenceScore: 4,
        adxThreshold: 18,
        atrStopMultiplier: 0.05,
        finalTpRr: 100,
        maxAtrPercent: 8,
        feeRate: 0.1,
        slippageRate: 0.05,
        spreadRate: 0.02
    });

    const updateSetting = (name, value) => {
        setSettings(prev => ({ ...prev, [name]: value }));
    };

    const numberSetting = (name, fallback) => {
        const value = Number(settings[name]);
        return Number.isFinite(value) ? value : fallback;
    };

    const buildBacktestConfig = () => ({
        RISK_PERCENTAGE: numberSetting('riskPercentage', 5),
        DAILY_TRADE_LIMIT: numberSetting('maxDailyTrades', 1),
        MAX_DAILY_LOSSES: numberSetting('maxDailyLosses', 1),
        MIN_CONFLUENCE_SCORE: numberSetting('minConfluenceScore', 4),
        ADX_THRESHOLD: numberSetting('adxThreshold', 18),
        ATR_STOP_MULTIPLIER: numberSetting('atrStopMultiplier', 0.05),
        FINAL_TP_RR: numberSetting('finalTpRr', 100),
        MAX_ATR_PERCENT_OF_PRICE: numberSetting('maxAtrPercent', 8) / 100,
        BACKTEST_FEE_RATE: numberSetting('feeRate', 0.1) / 100,
        BACKTEST_SLIPPAGE_RATE: numberSetting('slippageRate', 0.05) / 100,
        BACKTEST_SPREAD_RATE: numberSetting('spreadRate', 0.02) / 100
    });

    const loadSavedRuns = async () => {
        try {
            const response = await apiFetch(`${API_BASE_URL}/backtest/results?userId=${encodeURIComponent(userId)}&limit=5`);
            if (response.ok) {
                const data = await response.json();
                setSavedRuns(data || []);
            }
        } catch (error) {
            console.error('Failed to load saved backtests:', error);
        }
    };

    useEffect(() => {
        loadSavedRuns();
    }, []);

    const runBacktest = async () => {
        setIsRunning(true);
        try {
            const response = await apiFetch(`${API_BASE_URL}/backtest`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    days: numberSetting('days', 90),
                    strategy: 'confluence_scoring',
                    userId: userId,
                    config: buildBacktestConfig()
                })
            });

            if (!response.ok) {
                throw new Error(`Backtest failed: ${response.status}`);
            }

            const data = await response.json();
            setResults(data);
            downloadCsv(data);
            loadSavedRuns();
        } catch (error) {
            console.error('Backtest failed:', error);
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

    const createCsv = (sourceResults) => {
        if (!sourceResults) return '';

        let csv = `Backtest Summary (${settings.days} Days)\n`;
        csv += `Run ID,${sourceResults.runId || ''}\n`;
        csv += `Metric,Value\n`;
        csv += `Total Trades,${sourceResults.totalTrades}\n`;
        csv += `Win Rate,${(sourceResults.winRate * 100).toFixed(1)}%\n`;
        csv += `Profit Factor,${sourceResults.profitFactor.toFixed(2)}\n`;
        csv += `Max Drawdown,${(sourceResults.maxDrawdown * 100).toFixed(1)}%\n`;
        csv += `Sharpe Ratio,${sourceResults.sharpeRatio.toFixed(2)}\n`;
        csv += `Total Return,${(sourceResults.totalReturn * 100).toFixed(1)}%\n`;
        csv += `Final Equity,$${(sourceResults.finalEquity || 50 + sourceResults.totalReturn * 50).toFixed(2)}\n`;
        csv += `Expectancy,$${(sourceResults.expectancy || 0).toFixed(2)}\n`;
        csv += `Average R,${(sourceResults.averageRMultiple || 0).toFixed(2)}\n`;
        csv += `Fees Paid,$${(sourceResults.totalFees || 0).toFixed(2)}\n`;
        csv += `Slippage Cost,$${(sourceResults.totalSlippageCost || 0).toFixed(2)}\n`;
        csv += `Skipped Signals,${sourceResults.skippedSignals || 0}\n`;
        csv += `Long Win Rate,${((sourceResults.longWinRate || 0) * 100).toFixed(1)}%\n`;
        csv += `Short Win Rate,${((sourceResults.shortWinRate || 0) * 100).toFixed(1)}%\n`;
        csv += `Lot Size Range,0.01 - 0.04\n\n`;

        if (sourceResults.skippedReasons && Object.keys(sourceResults.skippedReasons).length > 0) {
            csv += 'Skipped Reasons\n';
            csv += 'Reason,Count\n';
            Object.entries(sourceResults.skippedReasons).forEach(([reason, count]) => {
                csv += `"${reason}",${count}\n`;
            });
            csv += '\n';
        }

        csv += 'Equity Curve\n';
        csv += 'Day,Equity\n';
        sourceResults.equityCurve.forEach(point => {
            csv += `${point.day},${point.equity.toFixed(2)}\n`;
        });

        if (sourceResults.trades && sourceResults.trades.length > 0) {
            csv += '\nIndividual Trades\n';
            csv += 'ID,Timestamp,Exit Timestamp,Action,Lot Size,Entry Price,Exit Price,SL1,SL2 (Final),TP1,TP2,PnL,Score,Confluence,Reason\n';
            sourceResults.trades.forEach(trade => {
                const entryTime = trade.entryTimestamp || trade.timestamp;
                const exitTime = trade.exitTimestamp || '';
                const score = trade.score || '';
                const confluence = trade.confluence ? `"${trade.confluence}"` : '';
                const reason = trade.exitReason || '';
                csv += `${trade.id},${entryTime},${exitTime},${trade.action},${trade.quantity?.toFixed(4) || '0.01'},${trade.entryPrice.toFixed(2)},${trade.exitPrice?.toFixed(2) || ''},${trade.originalSl?.toFixed(2) || trade.sl?.toFixed(2) || ''},${trade.sl?.toFixed(2) || ''},${trade.tp1?.toFixed(2) || ''},${trade.tp2?.toFixed(2) || ''},${trade.pnl?.toFixed(2) || ''},${score},${confluence},${reason}\n`;
            });
        }

        return csv;
    };

    const downloadCsv = (sourceResults = results) => {
        if (!sourceResults) return;
        const csv = createCsv(sourceResults);

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.setAttribute('hidden', '');
        a.setAttribute('href', url);
        a.setAttribute('download', `backtest_results${sourceResults.runId ? `_run_${sourceResults.runId}` : ''}.csv`);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    };

    const lotStats = getLotStats();

    return (
        <div className="backtester-container">
            <div className="backtester-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', marginBottom: '15px' }}>
                <h2 style={{ borderBottom: 'none', marginBottom: 0 }}>Backtester</h2>
                {results && (
                    <button onClick={() => downloadCsv()} className="btn-export-small">
                        Download CSV
                    </button>
                )}
            </div>

            <div style={{ marginBottom: '10px', padding: '6px 10px', background: 'rgba(99, 102, 241, 0.1)', borderRadius: '6px', border: '1px solid rgba(99, 102, 241, 0.2)', fontSize: '0.78rem', color: '#a5b4fc' }}>
                <strong>⚡ Dynamic Lot:</strong> 0.01 – 0.04 BTC (risk-based, skipped if risk is too high)
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px', marginBottom: '12px', padding: '10px', border: '1px solid rgba(148, 163, 184, 0.18)', borderRadius: '8px', background: 'rgba(5, 5, 5, 0.86)' }}>
                {[
                    ['days', 'Days', 30, 365, 1],
                    ['riskPercentage', 'Risk %', 0.25, 5, 0.25],
                    ['maxDailyTrades', 'Trades/Day', 1, 5, 1],
                    ['maxDailyLosses', 'Losses/Day', 1, 5, 1],
                    ['minConfluenceScore', 'Score', 1, 10, 1],
                    ['adxThreshold', 'ADX', 10, 40, 1],
                    ['atrStopMultiplier', 'SL ATR', 0.01, 3, 0.01],
                    ['finalTpRr', 'Final TP R', 1, 100, 0.5],
                    ['maxAtrPercent', 'Max ATR %', 0.5, 8, 0.25],
                    ['feeRate', 'Fee %', 0, 0.5, 0.01],
                    ['slippageRate', 'Slippage %', 0, 0.5, 0.01],
                    ['spreadRate', 'Spread %', 0, 0.5, 0.01]
                ].map(([name, label, min, max, step]) => (
                    <label key={name} style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.72rem', color: '#cbd5e0' }}>
                        {label}
                        <input
                            type="number"
                            min={min}
                            max={max}
                            step={step}
                            value={settings[name]}
                            onChange={(event) => updateSetting(name, event.target.value)}
                            style={{ background: '#0f172a', border: '1px solid rgba(148, 163, 184, 0.25)', borderRadius: '6px', color: '#e2e8f0', padding: '6px' }}
                        />
                    </label>
                ))}
            </div>

            <div className="backtester-controls">
                <button
                    onClick={runBacktest}
                    disabled={isRunning}
                    className={isRunning ? 'running' : ''}
                >
                    {isRunning ? 'Running...' : `Run ${settings.days}-Day Backtest`}
                </button>
            </div>

            {savedRuns.length > 0 && (
                <div style={{ marginTop: '12px', padding: '10px', border: '1px solid rgba(148, 163, 184, 0.18)', borderRadius: '8px', background: 'rgba(5, 5, 5, 0.82)', color: '#cbd5e0' }}>
                    <h4 style={{ margin: '0 0 8px 0', color: '#e2e8f0' }}>Saved Backtest Runs</h4>
                    {savedRuns.map(run => (
                        <div key={run.id} style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderTop: '1px solid rgba(148, 163, 184, 0.12)', fontSize: '0.75rem' }}>
                            <span>#{run.id} | {new Date(run.timestamp).toLocaleString()} | {run.total_trades} trades | PF {(run.profit_factor || 0).toFixed(2)} | Return {((run.total_return || 0) * 100).toFixed(2)}%</span>
                            <a href={`${API_BASE_URL}/backtest/results/${run.id}/export`} style={{ color: '#93c5fd' }}>CSV</a>
                        </div>
                    ))}
                </div>
            )}

            {results && (
                <div className="backtester-results">
                    <h3>Backtest Results ({settings.days} days)</h3>
                    {results.runId && (
                        <p style={{ color: '#93c5fd', fontSize: '0.8rem' }}>Saved run #{results.runId}. CSV auto-download was triggered after completion.</p>
                    )}
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
                        <div className="result-item">
                            <h4>Expectancy</h4>
                            <p>${(results.expectancy || 0).toFixed(2)}</p>
                        </div>
                        <div className="result-item">
                            <h4>Average R</h4>
                            <p>{(results.averageRMultiple || 0).toFixed(2)}</p>
                        </div>
                        <div className="result-item">
                            <h4>Fees</h4>
                            <p>${(results.totalFees || 0).toFixed(2)}</p>
                        </div>
                        <div className="result-item">
                            <h4>Slippage</h4>
                            <p>${(results.totalSlippageCost || 0).toFixed(2)}</p>
                        </div>
                        <div className="result-item">
                            <h4>Skipped Signals</h4>
                            <p>{results.skippedSignals || 0}</p>
                        </div>
                        <div className="result-item">
                            <h4>Losing Streak</h4>
                            <p>{results.longestLosingStreak || 0}</p>
                        </div>
                        <div className="result-item">
                            <h4>Long Win</h4>
                            <p>{((results.longWinRate || 0) * 100).toFixed(1)}%</p>
                        </div>
                        <div className="result-item">
                            <h4>Short Win</h4>
                            <p>{((results.shortWinRate || 0) * 100).toFixed(1)}%</p>
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
                        <p>Total Equity: ${(results.finalEquity || 50 + results.totalReturn * 50).toFixed(2)} (Initial: $50.00)</p>
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
