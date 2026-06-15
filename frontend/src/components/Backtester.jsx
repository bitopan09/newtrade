import React, { useEffect, useState } from 'react';
import { API_BASE_URL, apiFetch, getCurrentUserId, getTerminalAccessToken } from '../services/api';

const Backtester = () => {
    const [results, setResults] = useState(null);
    const [savedRuns, setSavedRuns] = useState([]);
    const [isRunning, setIsRunning] = useState(false);
    const [settings, setSettings] = useState({
        days: 90
    });

    const updateSetting = (name, value) => {
        setSettings(prev => ({ ...prev, [name]: value }));
    };

    const numberSetting = (name, fallback) => {
        const value = Number(settings[name]);
        return Number.isFinite(value) ? value : fallback;
    };

    const buildBacktestConfig = () => ({ BACKTEST_INITIAL_EQUITY: 50 });

    const csvEscape = (value) => {
        if (value === null || value === undefined) return '';
        const text = String(value);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const loadSavedRuns = async () => {
        try {
            const response = await apiFetch(`${API_BASE_URL}/backtest/results?userId=${encodeURIComponent(getCurrentUserId())}&limit=5&accessToken=${encodeURIComponent(getTerminalAccessToken())}`);
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
                    userId: getCurrentUserId(),
                    accessToken: getTerminalAccessToken(),
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

        const rows = [];
        rows.push(['Backtest Summary', `${settings.days} Days`]);
        rows.push(['Run ID', sourceResults.runId || '']);
        rows.push(['Engine', sourceResults.backtestEngine || 'TradingBot.runBacktest']);
        rows.push(['Engine Version', sourceResults.backtestEngineVersion || 'unified-live-v1']);
        rows.push(['Signal Logic', 'Unified live/backtest logic']);
        rows.push(['Trade Accounting', sourceResults.tradeLifecycleAccounting || 'single-position']);
        rows.push([]);
        rows.push(['Metric', 'Value']);
        rows.push(['Total Trades', sourceResults.totalTrades || 0]);
        rows.push(['Win Rate %', ((sourceResults.winRate || 0) * 100).toFixed(2)]);
        rows.push(['Profit Factor', (sourceResults.profitFactor || 0).toFixed(2)]);
        rows.push(['Max Drawdown %', ((sourceResults.maxDrawdown || 0) * 100).toFixed(2)]);
        rows.push(['Sharpe Ratio', (sourceResults.sharpeRatio || 0).toFixed(2)]);
        rows.push(['Total Return %', ((sourceResults.totalReturn || 0) * 100).toFixed(2)]);
        rows.push(['Final Equity', (sourceResults.finalEquity || 0).toFixed(2)]);
        rows.push(['Expectancy', (sourceResults.expectancy || 0).toFixed(2)]);
        rows.push(['Average R', (sourceResults.averageRMultiple || 0).toFixed(2)]);
        rows.push(['Fees Paid', (sourceResults.totalFees || 0).toFixed(2)]);
        rows.push(['Slippage Cost', (sourceResults.totalSlippageCost || 0).toFixed(2)]);
        rows.push(['Skipped Signals', sourceResults.skippedSignals || 0]);
        rows.push(['Long Win Rate %', ((sourceResults.longWinRate || 0) * 100).toFixed(2)]);
        rows.push(['Short Win Rate %', ((sourceResults.shortWinRate || 0) * 100).toFixed(2)]);
        rows.push([]);

        if (sourceResults.effectiveConfig) {
            rows.push(['Effective Settings']);
            rows.push(['Key', 'Value']);
            Object.entries(sourceResults.effectiveConfig).forEach(([key, value]) => {
                rows.push([key, value]);
            });
            rows.push([]);
        }

        if (sourceResults.skippedReasons && Object.keys(sourceResults.skippedReasons).length > 0) {
            rows.push(['Skipped Reasons']);
            rows.push(['Reason', 'Count']);
            Object.entries(sourceResults.skippedReasons).forEach(([reason, count]) => {
                rows.push([reason, count]);
            });
            rows.push([]);
        }

        rows.push(['Equity Curve']);
        rows.push(['Point', 'Timestamp', 'Equity']);
        (sourceResults.equityCurve || []).forEach(point => {
            rows.push([point.day, point.timestamp || '', (point.equity || 0).toFixed(2)]);
        });
        rows.push([]);

        if (sourceResults.trades && sourceResults.trades.length > 0) {
            rows.push(['Trades']);
            rows.push(['ID', 'Entry Time', 'Exit Time', 'Side', 'Quantity', 'Remaining Qty', 'Entry', 'Exit', 'Original SL', 'Final SL', 'TP1', 'TP2', 'Partial Closed', 'Partial Exit', 'Partial PnL', 'Net PnL', 'Fees', 'Risk Amount', 'Actual Risk', 'Target Lot', 'Risk %', 'Score', 'Exit Reason', 'Confluence']);
            sourceResults.trades.forEach(trade => {
                rows.push([
                    trade.id,
                    trade.entryTimestamp || trade.timestamp || '',
                    trade.exitTimestamp || '',
                    trade.action || '',
                    trade.quantity !== undefined ? Number(trade.quantity).toFixed(2) : '',
                    trade.remainingQuantity !== undefined ? Number(trade.remainingQuantity).toFixed(2) : '',
                    trade.entryPrice ?? '',
                    trade.exitPrice ?? '',
                    trade.originalSl ?? '',
                    trade.sl ?? '',
                    trade.tp1 ?? '',
                    trade.tp2 ?? '',
                    trade.partialClosed ? 'yes' : 'no',
                    trade.partialExitPrice ?? '',
                    trade.partialPnl ?? '',
                    trade.pnl ?? '',
                    trade.fees ?? '',
                    trade.riskAmount ?? '',
                    trade.actualRisk ?? '',
                    trade.confluenceTargetQuantity !== undefined ? Number(trade.confluenceTargetQuantity).toFixed(2) : '',
                    trade.confluenceRiskPercentage !== undefined ? Number(trade.confluenceRiskPercentage).toFixed(2) : '',
                    trade.score ?? '',
                    trade.exitReason || '',
                    trade.confluence || ''
                ]);
            });
        }

        return rows.map(row => row.map(csvEscape).join(',')).join('\n');
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
            <div className="backtester-header">
                <div>
                    <h2 className="compact-heading">Backtester</h2>
                    <p className="panel-kicker">Historical strategy readout using the current configured parameters.</p>
                </div>
                {results && (
                    <button onClick={() => downloadCsv()} className="btn-export-small">
                        Download CSV
                    </button>
                )}
            </div>

            <div className="backtester-note">
                <strong>Unified Logic:</strong> Backtest and bot use the same closed-candle signal logic, realistic trade accounting, and risk settings.
            </div>

            <div className="backtester-settings-grid">
                <label>
                    Days
                    <input
                        type="number"
                        min="30"
                        max="365"
                        step="1"
                        value={settings.days}
                        onChange={(event) => updateSetting('days', event.target.value)}
                    />
                </label>
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
                <div className="saved-runs-panel">
                    <h4>Saved Backtest Runs</h4>
                    {savedRuns.map(run => (
                        <div key={run.id} className="saved-run-row">
                            <span>#{run.id} | Unified | {new Date(run.timestamp).toLocaleString()} | {run.total_trades} trades | PF {(run.profit_factor || 0).toFixed(2)} | Return {((run.total_return || 0) * 100).toFixed(2)}%</span>
                            <a href={`${API_BASE_URL}/backtest/results/${run.id}/export?userId=${encodeURIComponent(getCurrentUserId())}&accessToken=${encodeURIComponent(getTerminalAccessToken())}`}>CSV</a>
                        </div>
                    ))}
                </div>
            )}

            {results && (
                <div className="backtester-results">
                    <h3>Backtest Results ({settings.days} days)</h3>
                    <div className="backtester-note">
                        <strong>Logic:</strong> Unified live/backtest | <strong>Accounting:</strong> {results.tradeLifecycleAccounting || 'single-position'} | <strong>Engine:</strong> {results.backtestEngineVersion || 'unified-live-v1'}
                    </div>
                    {results.runId && (
                        <p className="saved-run-message">Saved run #{results.runId}. CSV auto-download was triggered after completion.</p>
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
                        <div className="lot-stats-grid">
                            <div className="lot-stat min">
                                <div>Min Lot</div>
                                <strong>{lotStats.minLot.toFixed(2)}</strong>
                            </div>
                            <div className="lot-stat avg">
                                <div>Avg Lot</div>
                                <strong>{lotStats.avgLot.toFixed(2)}</strong>
                            </div>
                            <div className="lot-stat max">
                                <div>Max Lot</div>
                                <strong>{lotStats.maxLot.toFixed(2)}</strong>
                            </div>
                        </div>
                    )}

                    <div className="equity-curve-placeholder">
                        <h4>Equity Curve</h4>
                        <p>Total Equity: ${(results.finalEquity || 50 + results.totalReturn * 50).toFixed(2)} (Initial: ${(results.effectiveConfig?.BACKTEST_INITIAL_EQUITY || 50).toFixed(2)})</p>
                    </div>

                    <div className="backtest-trades-list">
                        <h4>Individual Trades</h4>
                        <div className="trade-table-wrap compact-table">
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
                                            <td className={`action-text ${trade.action.toLowerCase()}`}>{trade.action}</td>
                                            <td className="lot-cell">{(trade.quantity || 0.01).toFixed(2)}</td>
                                            <td>${trade.entryPrice.toFixed(2)}</td>
                                            <td>${trade.exitPrice.toFixed(2)}</td>
                                            <td className={trade.pnl >= 0 ? 'profit' : 'loss'}>
                                                ${trade.pnl.toFixed(2)}
                                            </td>
                                            <td className="reason-cell">{trade.exitReason || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {results.trades.length > 15 && (
                            <p className="table-footnote">
                                Showing first 15 of {results.trades.length} real trades. Download CSV for full historical data.
                            </p>
                        )}
                    </div>
                </div>
            )}

            {!results && !isRunning && (
                <div className="state-panel empty-state">Click "Run 90-Day Backtest" to see historical performance</div>
            )}
        </div>
    );
};

export default Backtester;
