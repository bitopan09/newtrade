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
            <h2>Today's Activity</h2>
            <div className="status-grid">
                <div className="status-card">
                    <p><strong>Bot Status:</strong> <span className={bot.isRunning ? 'status-online' : 'status-offline'}>{bot.isRunning ? '🟢 ONLINE' : '🔴 OFFLINE'}</span></p>
                            <p><strong>Daily Trades:</strong> {bot.dailyTradeCount || 0}/{bot.config?.maxDailyTrades || 1}</p>
                    <p><strong>Live Confluence:</strong> {bot.currentScore}/10 
                        <span style={{ fontSize: '0.8rem', marginLeft: '8px', color: bot.currentSignal === 'NEUTRAL' ? '#94a3b8' : (bot.currentSignal === 'BUY' ? '#4ade80' : '#f87171') }}>
                            ({bot.currentSignal})
                        </span>
                    </p>
                    
                    {bot.lastAnalysisTime && (
                        <p style={{ fontSize: '0.8rem', marginTop: '8px', color: '#cbd5e0' }}>
                            Last Analysis: {formatTimeIST(bot.lastAnalysisTime, 'date-time')} IST
                        </p>
                    )}

                    {bot.config && (
                        <div style={{ marginTop: '10px', padding: '8px', border: '1px solid rgba(148, 163, 184, 0.2)', borderRadius: '6px', fontSize: '0.76rem', color: '#cbd5e0' }}>
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
                        style={{ marginTop: '12px', padding: '6px 12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}
                    >
                        {telegramTesting ? 'Sending...' : 'Test Telegram Alert'}
                    </button>
                    {telegramMessage && (
                        <p style={{ fontSize: '0.8rem', marginTop: '6px', color: telegramMessage.type === 'success' ? '#4ade80' : '#f87171' }}>
                            {telegramMessage.text}
                        </p>
                    )}
                </div>
                
                <div className="today-trade-card">
                    <h4 style={{ margin: '0 0 8px 0', color: '#e2e8f0' }}>Today's Single Trade</h4>
                    {todayTrade ? (
                        <div className={`mini-trade-details ${todayTrade.action.toLowerCase()}`}>
                            <p><strong>{todayTrade.action}</strong> at ${todayTrade.entry_price.toFixed(2)}</p>
                            <p>Status: <span className={`status-${todayTrade.status.toLowerCase()}`}>{todayTrade.status}</span></p>
                            {todayTrade.pnl !== null && <p>Result: <span className={todayTrade.pnl >= 0 ? 'profit' : 'loss'}>${todayTrade.pnl.toFixed(2)}</span></p>}
                            <p style={{ fontSize: '0.8rem', marginTop: '6px' }}>{formatTimeIST(todayTrade.timestamp, 'date-time')}</p>
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
