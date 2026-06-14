import React, { useEffect, useState } from 'react';
import { archiveTerminal, createTerminal, fetchTerminals, restoreTerminal, selectTerminal } from '../services/api';

const TerminalSelector = ({ onSelect }) => {
    const [terminals, setTerminals] = useState([]);
    const [showArchived, setShowArchived] = useState(false);
    const [displayName, setDisplayName] = useState('');
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

        try {
            const terminal = await createTerminal({ displayName: name });
            const selected = await selectTerminal(terminal.userId);
            onSelect(selected);
        } catch (createError) {
            setError(createError.response?.data?.error || 'Could not create terminal');
        }
    };

    const handleSelect = async (terminal) => {
        if (terminal.archived) return;
        try {
            const selected = await selectTerminal(terminal.userId);
            onSelect(selected);
        } catch (selectError) {
            setError(selectError.response?.data?.error || 'Could not select terminal');
        }
    };

    const handleArchive = async (event, terminal) => {
        event.stopPropagation();
        if (!window.confirm(`Archive ${terminal.displayName}? Data will be kept and can be restored later.`)) return;
        await archiveTerminal(terminal.userId);
        loadTerminals();
    };

    const handleRestore = async (event, terminal) => {
        event.stopPropagation();
        await restoreTerminal(terminal.userId);
        loadTerminals();
    };

    const activeTerminals = terminals.filter(terminal => !terminal.archived);
    const archivedTerminals = terminals.filter(terminal => terminal.archived);
    const visibleTerminals = showArchived ? terminals : activeTerminals;
    const activeCount = activeTerminals.length;
    const archivedCount = archivedTerminals.length;

    return (
        <div className="terminal-selector-screen">
            <div className="terminal-selector-shell">
                <div className="terminal-selector-hero">
                    <div className="terminal-selector-heading">
                        <div className="terminal-brand-mark">B</div>
                        <div>
                            <div className="terminal-kicker">Paper Trading Workspace</div>
                            <h1>Bullseye</h1>
                            <p>Choose a terminal. Each profile keeps its own $50 balance, paper trades, backtests, and activity.</p>
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
                    </div>
                </div>

                {error && <div className="terminal-error">{error}</div>}

                <div className="terminal-section-bar">
                    <div>
                        <h2>{showArchived ? 'All Terminals' : 'Choose Your Terminal'}</h2>
                        <p>{showArchived ? 'Archived terminals are muted and can be restored.' : 'Open a terminal to continue your paper trading session.'}</p>
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
                        <button
                            key={terminal.userId}
                            className={`terminal-card ${terminal.archived ? 'archived' : ''}`}
                            onClick={() => handleSelect(terminal)}
                        >
                            <div className="terminal-card-topline">
                                <span>{terminal.archived ? 'Archived' : 'Ready'}</span>
                                <span>{terminal.archived ? 'Restore to use' : 'Open terminal'}</span>
                            </div>
                            <div className="terminal-avatar" style={{ borderColor: terminal.avatarColor, color: terminal.avatarColor }}>
                                {terminal.avatarInitial || terminal.displayName?.charAt(0) || 'B'}
                            </div>
                            <div className="terminal-name">{terminal.displayName}</div>
                            <div className="terminal-meta">$50 paper balance</div>
                            {terminal.archived ? (
                                <span className="terminal-card-action restore" onClick={(event) => handleRestore(event, terminal)}>Restore</span>
                            ) : (
                                <span className="terminal-card-action" onClick={(event) => handleArchive(event, terminal)}>Archive</span>
                            )}
                        </button>
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
                        <button type="submit" disabled={!displayName.trim()}>Create Terminal</button>
                    </form>
                </div>

                <div className="terminal-selector-footer">
                    <span>Archive never deletes data. Restoring brings the terminal back with all history intact.</span>
                </div>
            </div>
        </div>
    );
};

export default TerminalSelector;
