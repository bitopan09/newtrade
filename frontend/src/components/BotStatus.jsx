import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { formatTimeIST } from '../utils/timeFormatter';
import { API_BASE_URL, getCurrentUserId, getTerminalAccessToken } from '../services/api';

const BotStatus = () => {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [telegramTesting, setTelegramTesting] = useState(false);
    const [telegramMessage, setTelegramMessage] = useState(null);

    const testTelegram = async () => {
        setTelegramTesting(true);
        setTelegramMessage(null);
        try {
            await axios.post(`${API_BASE_URL}/telegram/test`);
            setTelegramMessage({ type: 'success', text: 'Test Telegram alert sent successfully.' });
        } catch (error) {
            setTelegramMessage({ type: 'error', text: error.response?.data?.status?.lastError || 'Failed to send Telegram alert.' });
        }
        setTelegramTesting(false);
        setTimeout(() => setTelegramMessage(null), 5000);
    };
    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const response = await axios.get(`${API_BASE_URL}/bot/status`, {
                    params: { userId: getCurrentUserId(), accessToken: getTerminalAccessToken() },
                    headers: { 'x-terminal-access-token': getTerminalAccessToken() }
                });
                setStatus(response.data);
                setLoading(false);
            } catch (error) {
                console.error('Error fetching bot status:', error);
            }
        };

        fetchStatus();
        const interval = setInterval(fetchStatus, 10000);
        return () => clearInterval(interval);
    }, []);

    if (loading || !status) return <div className="bot-status-container">Loading bot status...</div>;

    const { bot, todayTrade } = status;

    return (
        <div className="bot-status-container">
            <div className="panel-heading">
                <div>
                    <h2>Today's Activity</h2>
                    <p className="panel-kicker">Live strategy state for the selected terminal.</p>
                </div>
            </div>
            <div className="bot-metrics-row">
                <div className="bot-metric-card">
                    <span>Bot Status</span>
                    <strong className={bot.isRunning ? 'status-online' : 'status-offline'}>{bot.isRunning ? 'ONLINE' : 'OFFLINE'}</strong>
                </div>
                <div className="bot-metric-card">
                    <span>Daily Trades</span>
                    <strong>{bot.dailyTradeCount || 0}/{bot.config?.maxDailyTrades || 1}</strong>
                </div>
                <div className="bot-metric-card">
                    <span>Confluence</span>
                    <strong>{bot.currentScore}/10</strong>
                </div>
                <div className="bot-metric-card">
                    <span>Signal</span>
                    <strong className={`signal-text signal-${String(bot.currentSignal || 'neutral').toLowerCase()}`}>{bot.currentSignal}</strong>
                </div>
            </div>
            <div className="status-grid">
                <div className="status-card">
                    <h4>Strategy Guardrails</h4>

                    {bot.lastAnalysisTime && (
                        <p className="analysis-time">
                            Last Analysis: {formatTimeIST(bot.lastAnalysisTime, 'date-time')} IST
                        </p>
                    )}

                    {bot.config && (
                        <div className="bot-config-grid">
                            <p><strong>Risk:</strong> {bot.config.riskPercentage}% | <strong>Score:</strong> {bot.config.minConfluenceScore}/10 | <strong>ADX:</strong> {bot.config.adxThreshold}</p>
                            <p><strong>SL:</strong> {bot.config.atrStopMultiplier}x ATR | <strong>TP:</strong> {bot.config.partialTpRr}R/{bot.config.finalTpRr}R | <strong>Trail:</strong> {bot.config.trailingStartRr}R</p>
                            <p><strong>Max ATR:</strong> {(bot.config.maxAtrPercentOfPrice * 100).toFixed(2)}% | <strong>Min RR:</strong> {bot.config.minRewardToRisk}R</p>
                            <p><strong>Session:</strong> {bot.config.sessionUtc}</p>
                            <p><strong>Lot:</strong> {bot.config.minQuantity}-{bot.config.maxQuantity} BTC | <strong>Daily Losses:</strong> {bot.config.maxDailyLosses}</p>
                        </div>
                    )}
                     
                    <button 
                        onClick={testTelegram} 
                        disabled={telegramTesting}
                        className="btn-secondary"
                    >
                        {telegramTesting ? 'Sending...' : 'Test Telegram Alert'}
                    </button>
                    {telegramMessage && (
                        <p className={`inline-message ${telegramMessage.type}`}>
                            {telegramMessage.text}
                        </p>
                    )}
                </div>
                
                <div className="today-trade-card">
                    <h4>Today's Single Trade</h4>
                    {todayTrade ? (
                        <div className={`mini-trade-details ${todayTrade.action.toLowerCase()}`}>
                            <p><strong>{todayTrade.action}</strong> at ${todayTrade.entry_price.toFixed(2)}</p>
                            <p>Status: <span className={`status-${todayTrade.status.toLowerCase()}`}>{todayTrade.status}</span></p>
                            {todayTrade.pnl !== null && <p>Result: <span className={todayTrade.pnl >= 0 ? 'profit' : 'loss'}>${todayTrade.pnl.toFixed(2)}</span></p>}
                            <p className="mini-trade-time">{formatTimeIST(todayTrade.timestamp, 'date-time')}</p>
                        </div>
                    ) : (
                        <p className="no-trade">No trade taken yet today.</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BotStatus;
