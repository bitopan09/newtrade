import React, { useState } from 'react';
import { manualTrade } from '../services/api';

const ManualTrade = () => {
    const [quantity, setQuantity] = useState(0.01);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');

    const handleTrade = async (action) => {
        setLoading(true);
        setMessage('');
        try {
            const result = await manualTrade(action, quantity);
            setMessage(result.message || `Successfully executed ${action}`);
        } catch (error) {
            setMessage(error.error || error.reason || `Failed to execute ${action}`);
        } finally {
            setLoading(false);
            // Clear message after 3 seconds
            setTimeout(() => setMessage(''), 3000);
        }
    };

    return (
        <div className="manual-trade-container">
            <h2>Manual Trade</h2>
            <div className="trade-controls">
                <div className="input-group">
                    <label>Quantity (BTC)</label>
                    <input 
                        type="number" 
                        step="0.01" 
                        min="0.01" 
                        value={quantity} 
                        onChange={(e) => setQuantity(parseFloat(e.target.value))}
                    />
                </div>
                <div className="action-buttons">
                    <button 
                        className="btn-buy" 
                        onClick={() => handleTrade('BUY')}
                        disabled={loading}
                    >
                        BUY
                    </button>
                    <button 
                        className="btn-sell" 
                        onClick={() => handleTrade('SELL')}
                        disabled={loading}
                    >
                        SELL
                    </button>
                </div>
            </div>
            {message && <div className="trade-message">{message}</div>}
        </div>
    );
};

export default ManualTrade;
