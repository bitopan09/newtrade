import React, { useState, useEffect } from 'react';
import './App.css';
import LiveChart from './components/LiveChart';
import BalanceTracker from './components/BalanceTracker';
import TradeJournal from './components/TradeJournal';
import Backtester from './components/Backtester';
import ManualTrade from './components/ManualTrade';
import ActiveTrades from './components/ActiveTrades';
import BotStatus from './components/BotStatus';
import TerminalSelector from './components/TerminalSelector';
import bullseyeLogo from './assets/bullseye-logo.webp';
import { API_BASE_URL, apiFetch, clearSelectedTerminal, getCurrentUserId, getSelectedTerminal, getTerminalAccessToken } from './services/api';

function App() {
    const [clock, setClock] = useState('');
    const [botOnline, setBotOnline] = useState(false);
    const [apiConnected, setApiConnected] = useState(false);
    const [selectedTerminal, setSelectedTerminalState] = useState(getSelectedTerminal());
    const [showTerminalSwitcher, setShowTerminalSwitcher] = useState(false);
    const activeUserId = selectedTerminal?.userId || getCurrentUserId();

    useEffect(() => {
        const tick = () => {
            setClock(new Date().toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false,
                day: 'numeric', month: 'short'
            }) + ' IST');
        };
        tick();
        const id = setInterval(tick, 1000);

        // Check API connection
        const checkAPI = async () => {
            try {
                const res = await apiFetch(`${API_BASE_URL}/price`);
                if (res.ok) {
                    setApiConnected(true);
                } else {
                    setApiConnected(false);
                }
            } catch { 
                setApiConnected(false); 
            }
        };

        // Check bot status
        const checkBot = async () => {
            try {
                const res = await apiFetch(`${API_BASE_URL}/bot/status?userId=${encodeURIComponent(getCurrentUserId())}&accessToken=${encodeURIComponent(getTerminalAccessToken())}`);
                const data = await res.json();
                setBotOnline(data.bot?.isRunning || false);
            } catch { setBotOnline(false); }
        };

        checkAPI();
        checkBot();
        const apiInterval = setInterval(checkAPI, 15000);
        const botInterval = setInterval(checkBot, 15000);

        return () => { 
            clearInterval(id); 
            clearInterval(apiInterval); 
            clearInterval(botInterval); 
        };
    }, []);

    const lockTerminal = () => {
        clearSelectedTerminal();
        setShowTerminalSwitcher(false);
        setSelectedTerminalState(null);
    };

    const handleTerminalSelect = (terminal) => {
        setSelectedTerminalState(terminal);
        setShowTerminalSwitcher(false);
    };

    if (!selectedTerminal) {
        return <TerminalSelector onSelect={handleTerminalSelect} />;
    }

    return (
        <div className="App" key={activeUserId}>
            <header className="app-header">
                <div className="header-brand">
                    <div className="header-logo">
                        <img src={bullseyeLogo} alt="Bullseye" />
                    </div>
                    <div>
                        <div className="header-title">Bullseye</div>
                        <div className="header-subtitle">BTC/USD Paper Trading Terminal</div>
                    </div>
                </div>
                <div className="header-right">
                    <div className="header-clock">{clock}</div>
                    <div className="header-status">
                        <span className={`status-dot ${apiConnected ? 'online' : 'offline'}`}></span>
                        <span className={`header-status-label ${apiConnected ? 'online' : 'offline'}`}>
                            {apiConnected ? 'API ✓' : 'API ✗'}
                        </span>
                    </div>
                    <div className="header-status">
                        <span className={`status-dot ${botOnline ? 'online' : 'offline'}`}></span>
                        <span className={`header-status-label ${botOnline ? 'online' : 'offline'}`}>
                            {botOnline ? 'BOT LIVE' : 'BOT OFF'}
                        </span>
                    </div>
                    <div className="terminal-header-pill">
                        <div className="terminal-header-avatar" style={{ borderColor: selectedTerminal.avatarColor, color: selectedTerminal.avatarColor }}>
                            {selectedTerminal.avatarInitial || selectedTerminal.displayName?.charAt(0) || 'B'}
                        </div>
                        <div className="terminal-header-copy">
                            <span>Active Terminal</span>
                            <strong>{selectedTerminal.displayName}</strong>
                        </div>
                        <button onClick={() => setShowTerminalSwitcher(true)}>Switch</button>
                        <button className="terminal-lock-button" onClick={lockTerminal}>Lock</button>
                    </div>
                </div>
            </header>

            {showTerminalSwitcher && (
                <div className="terminal-switcher-overlay" role="dialog" aria-modal="true" aria-label="Switch terminal">
                    <TerminalSelector
                        mode="switch"
                        currentTerminal={selectedTerminal}
                        onSelect={handleTerminalSelect}
                        onCancel={() => setShowTerminalSwitcher(false)}
                    />
                </div>
            )}

            <main>
                <div className="dashboard-grid">
                    <div className="grid-left-column">
                        <LiveChart />
                        <BotStatus />
                        <ActiveTrades />
                        <ManualTrade />
                    </div>
                    <div className="grid-right-column">
                        <BalanceTracker />
                        <Backtester />
                    </div>
                </div>
                <div className="full-width-panel">
                    <TradeJournal />
                </div>
            </main>
        </div>
    );
}

export default App;
