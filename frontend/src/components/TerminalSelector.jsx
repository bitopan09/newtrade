import React, { useEffect, useState } from 'react';
import { archiveTerminal, createTerminal, fetchTerminals, restoreTerminal, selectTerminal, setTerminalPin } from '../services/api';

const TerminalSelector = ({ onSelect, onCancel, currentTerminal = null, mode = 'entry' }) => {
    const [terminals, setTerminals] = useState([]);
    const [showArchived, setShowArchived] = useState(false);
    const [displayName, setDisplayName] = useState('');
    const [createPin, setCreatePin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [terminalPins, setTerminalPins] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const loadTerminals = async () => {
        setLoading(true);
        setError('');
        try {
            const data = await fetchTerminals(showArchived);
            setTerminals(data || []);
        } catch (loadError) {
            setError(loadError.response?.data?.error || 'Could not load terminals');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadTerminals();
    }, [showArchived]);

    const handleCreate = async (event) => {
        event.preventDefault();
        const name = displayName.trim();
        if (!name) return;
        if (createPin !== confirmPin) {
            setError('PIN confirmation does not match');
            return;
        }

        try {
            const terminal = await createTerminal({ displayName: name, pin: createPin, termsAccepted });
            const selected = await selectTerminal(terminal.userId, createPin);
            onSelect(selected);
        } catch (createError) {
            setError(createError.response?.data?.error || 'Could not create terminal');
        }
    };

    const terminalPin = (terminal) => terminalPins[terminal.userId] || '';

    const updateTerminalPin = (terminal, value) => {
        setTerminalPins(prev => ({ ...prev, [terminal.userId]: value.replace(/\D/g, '').slice(0, 8) }));
    };

    const handleSelect = async (event, terminal) => {
        event.preventDefault();
        if (terminal.archived) return;
        try {
            const selected = await selectTerminal(terminal.userId, terminalPin(terminal));
            onSelect(selected);
        } catch (selectError) {
            setError(selectError.response?.data?.error || 'Could not select terminal');
        }
    };

    const handleSetLegacyPin = async (event, terminal) => {
        event.preventDefault();
        if (!termsAccepted) {
            setError('Accept the terminal access terms before setting a PIN');
            return;
        }
        try {
            await setTerminalPin(terminal.userId, { pin: terminalPin(terminal), termsAccepted });
            await loadTerminals();
        } catch (pinError) {
            setError(pinError.response?.data?.error || 'Could not set terminal PIN');
        }
    };

    const handleArchive = async (event, terminal) => {
        event.stopPropagation();
        if (!window.confirm(`Archive ${terminal.displayName}? Data will be kept and can be restored later.`)) return;
        await archiveTerminal(terminal.userId, terminalPin(terminal));
        loadTerminals();
    };

    const handleRestore = async (event, terminal) => {
        event.stopPropagation();
        await restoreTerminal(terminal.userId, terminalPin(terminal));
        loadTerminals();
    };

    const activeTerminals = terminals.filter(terminal => !terminal.archived);
    const archivedTerminals = terminals.filter(terminal => terminal.archived);
    const visibleTerminals = showArchived ? terminals : activeTerminals;
    const activeCount = activeTerminals.length;
    const archivedCount = archivedTerminals.length;
    const isSwitchMode = mode === 'switch';
    const isCurrentTerminal = (terminal) => currentTerminal?.userId === terminal.userId;

    return (
        <div className={`terminal-selector-screen ${isSwitchMode ? 'switch-mode' : ''}`}>
            <div className="terminal-selector-shell">
                {isSwitchMode && (
                    <button className="terminal-switcher-close" onClick={onCancel} aria-label="Close terminal switcher">
                        Close
                    </button>
                )}
                <div className="terminal-selector-hero">
                    <div className="terminal-selector-heading">
                        <div className="terminal-brand-mark">B</div>
                        <div>
                            <div className="terminal-kicker">{isSwitchMode ? 'Switch Terminal' : 'Paper Trading Workspace'}</div>
                            <h1>{isSwitchMode ? 'Choose Profile' : 'Bullseye'}</h1>
                            <p>{isSwitchMode ? 'Your current dashboard stays open until another terminal is unlocked with its PIN.' : 'Choose a terminal. Each profile keeps its own $50 balance, paper trades, backtests, and activity.'}</p>
                        </div>
                    </div>
                    <div className="terminal-stats">
                        <div>
                            <strong>{activeCount}</strong>
                            <span>Active</span>
                        </div>
                        <div>
                            <strong>{archivedCount}</strong>
                            <span>Archived</span>
                        </div>
                        <div>
                            <strong>$50</strong>
                            <span>Start</span>
                        </div>
                        {isSwitchMode && currentTerminal && (
                            <div className="terminal-current-stat">
                                <strong>{currentTerminal.avatarInitial || currentTerminal.displayName?.charAt(0) || 'B'}</strong>
                                <span>Current</span>
                            </div>
                        )}
                    </div>
                </div>

                {error && <div className="terminal-error">{error}</div>}

                <div className="terminal-section-bar">
                    <div>
                        <h2>{showArchived ? 'All Terminals' : isSwitchMode ? 'Switch Without Losing Context' : 'Choose Your Terminal'}</h2>
                        <p>{showArchived ? 'Archived terminals are muted and can be restored.' : isSwitchMode ? 'Enter the PIN for a different terminal, or close this panel to stay where you are.' : 'Open a terminal to continue your paper trading session.'}</p>
                    </div>
                    <button className="terminal-toggle-archived" onClick={() => setShowArchived(prev => !prev)}>
                        {showArchived ? 'Hide Archived' : `Show Archived (${archivedCount})`}
                    </button>
                </div>

                <div className="terminal-grid">
                    {loading ? (
                        <div className="terminal-loading">
                            <span className="terminal-loader" />
                            Loading terminals...
                        </div>
                    ) : visibleTerminals.length === 0 ? (
                        <div className="terminal-empty">
                            <strong>No terminals yet</strong>
                            <span>Create your first $50 Bullseye paper terminal to begin.</span>
                        </div>
                    ) : visibleTerminals.map(terminal => (
                        <form
                            key={terminal.userId}
                            className={`terminal-card ${terminal.archived ? 'archived' : ''} ${isCurrentTerminal(terminal) ? 'current' : ''}`}
                            onSubmit={(event) => terminal.hasPin ? handleSelect(event, terminal) : handleSetLegacyPin(event, terminal)}
                        >
                            <div className="terminal-card-topline">
                                <span>{isCurrentTerminal(terminal) ? 'Current' : terminal.archived ? 'Archived' : terminal.hasPin ? 'PIN locked' : 'PIN setup'}</span>
                                <span>{terminal.archived ? 'Restore to use' : terminal.hasPin ? 'Protected' : 'Required'}</span>
                            </div>
                            <div className="terminal-avatar" style={{ borderColor: terminal.avatarColor, color: terminal.avatarColor }}>
                                {terminal.avatarInitial || terminal.displayName?.charAt(0) || 'B'}
                            </div>
                            <div className="terminal-name">{terminal.displayName}</div>
                            <div className="terminal-meta">$50 paper balance</div>
                            <input
                                className="terminal-pin-input"
                                value={terminalPin(terminal)}
                                onChange={(event) => updateTerminalPin(terminal, event.target.value)}
                                placeholder={terminal.hasPin ? 'Enter PIN' : 'Create PIN'}
                                inputMode="numeric"
                                type="password"
                                maxLength={8}
                                autoComplete="off"
                            />
                            {!terminal.hasPin && <div className="terminal-meta">Accept terms below, then set a PIN for this existing terminal.</div>}
                            {!terminal.archived && (
                                <button className="terminal-open-button" type="submit" disabled={terminalPin(terminal).length < 4}>
                                    {isCurrentTerminal(terminal) ? 'Reopen Current' : terminal.hasPin ? 'Open Terminal' : 'Set PIN'}
                                </button>
                            )}
                            {terminal.archived ? (
                                <button type="button" className="terminal-card-action restore" onClick={(event) => handleRestore(event, terminal)} disabled={terminalPin(terminal).length < 4}>Restore</button>
                            ) : (
                                <button type="button" className="terminal-card-action" onClick={(event) => handleArchive(event, terminal)}>Archive</button>
                            )}
                        </form>
                    ))}

                    <form className="terminal-card terminal-create-card" onSubmit={handleCreate}>
                        <div className="terminal-avatar add">+</div>
                        <div className="terminal-name">Add Terminal</div>
                        <div className="terminal-meta">New isolated $50 workspace</div>
                        <input
                            value={displayName}
                            onChange={(event) => setDisplayName(event.target.value)}
                            placeholder="New terminal name"
                            maxLength={40}
                        />
                        <input
                            className="terminal-pin-input"
                            value={createPin}
                            onChange={(event) => setCreatePin(event.target.value.replace(/\D/g, '').slice(0, 8))}
                            placeholder="Create 4-8 digit PIN"
                            inputMode="numeric"
                            type="password"
                            maxLength={8}
                            autoComplete="new-password"
                        />
                        <input
                            className="terminal-pin-input"
                            value={confirmPin}
                            onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
                            placeholder="Confirm PIN"
                            inputMode="numeric"
                            type="password"
                            maxLength={8}
                            autoComplete="new-password"
                        />
                        <label className="terminal-terms-check">
                            <input
                                type="checkbox"
                                checked={termsAccepted}
                                onChange={(event) => setTermsAccepted(event.target.checked)}
                            />
                            <span>I understand this terminal is PIN-protected, I am responsible for keeping the PIN private, and I must not access another person’s terminal without permission.</span>
                        </label>
                        <button type="submit" disabled={!displayName.trim() || createPin.length < 4 || createPin !== confirmPin || !termsAccepted}>Create Terminal</button>
                    </form>
                </div>

                <div className="terminal-selector-footer">
                    <span>{isSwitchMode ? 'Closing this switcher keeps the current terminal active and unlocked.' : 'Archive never deletes data. PIN access is required before opening protected balances, trades, backtests, or settings.'}</span>
                </div>
            </div>
        </div>
    );
};

export default TerminalSelector;
