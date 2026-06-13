import React, { useState } from 'react';
import { getSelectedTerminal, manualTrade } from '../services/api';

const ManualTrade = () => {
    const [quantity, setQuantity] = useState(0.01);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [messageType, setMessageType] = useState('');
    const terminal = getSelectedTerminal();

    const handleTrade = async (action) => {
        setLoading(true);
        setMessage('');
        setMessageType('');
        try {
            const result = await manualTrade(action, quantity);
            setMessageType('success');
            setMessage(result.message || `Successfully executed ${action} at ${result.trade?.entryPrice?.toFixed(2)}`);
        } catch (error) {
            setMessageType('error');
            setMessage(error.error || error.reason || `Failed to execute ${action}`);
        } finally {
            setLoading(false);
            // Clear message after 4 seconds
            setTimeout(() => setMessage(''), 4000);
        }
    };

    return (
        <div className="manual-trade-container">
            <h2>Paper Trade ({terminal?.displayName || 'Selected Terminal'})</h2>
            <div className="trade-controls">
                <div className="input-group">
                    <label>Quantity (BTC)</label>
                    <select value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}>
                        <option value={0.01}>0.01 BTC</option>
                        <option value={0.02}>0.02 BTC</option>
                        <option value={0.03}>0.03 BTC</option>
                        <option value={0.04}>0.04 BTC</option>
                    </select>
                </div>
                <div className="action-buttons">
                    <button 
                        className="btn-buy" 
                        onClick={() => handleTrade('BUY')}
                        disabled={loading}
                    >
                        {loading ? 'Processing...' : 'BUY'}
                    </button>
                    <button 
                        className="btn-sell" 
                        onClick={() => handleTrade('SELL')}
                        disabled={loading}
                    >
                        {loading ? 'Processing...' : 'SELL'}
                    </button>
                </div>
            </div>
            {message && <div className={`trade-message ${messageType}`}>{message}</div>}
        </div>
    );
};

export default ManualTrade;
