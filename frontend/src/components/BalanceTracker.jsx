import React, { useState, useEffect } from 'react';
import { fetchBalance, fetchPrice, getSelectedTerminal } from '../services/api';

const BalanceTracker = () => {
    const [balanceData, setBalanceData] = useState(null);
    const [currentPrice, setCurrentPrice] = useState(0);
    const [loading, setLoading] = useState(true);
    const terminal = getSelectedTerminal();

    useEffect(() => {
        const fetchData = async () => {
            try {
                if (loading) setLoading(true);
                const [balance, price] = await Promise.all([
                    fetchBalance(),
                    fetchPrice()
                ]);
                setBalanceData(balance);
                setCurrentPrice(price.price || 0);
                setLoading(false);
            } catch (error) {
                console.error('Error fetching balance data:', error);
                setLoading(false);
            }
        };

        fetchData();
        const interval = setInterval(fetchData, 10000); // Update every 10 seconds
        return () => clearInterval(interval);
    }, []);

    if (loading && !balanceData) {
        return (
            <div className="balance-container">
                <div className="panel-heading">
                    <div>
                        <h2>Balance Tracker</h2>
                        <p className="panel-kicker">Terminal: {terminal?.displayName || 'Selected'}</p>
                    </div>
                </div>
                <div className="state-panel loading-state">Loading balance data...</div>
            </div>
        );
    }

    if (!balanceData) {
        return (
            <div className="balance-container">
                <div className="panel-heading">
                    <div>
                        <h2>Balance Tracker</h2>
                        <p className="panel-kicker">Terminal: {terminal?.displayName || 'Selected'}</p>
                    </div>
                </div>
                <div className="state-panel empty-state">No balance data available</div>
            </div>
        );
    }

    const { usd_balance, btc_balance } = balanceData;
    const totalValue = usd_balance + (btc_balance * currentPrice);

    return (
        <div className="balance-container">
            <div className="panel-heading">
                <div>
                    <h2>Balance Tracker</h2>
                    <p className="panel-kicker">Terminal: {terminal?.displayName || 'Selected'}</p>
                </div>
            </div>
            <div className="balance-details">
                <div className="balance-item">
                    <h3>USD Balance</h3>
                    <p>${usd_balance.toFixed(2)}</p>
                </div>
                <div className="balance-item">
                    <h3>BTC Balance</h3>
                    <p>{btc_balance.toFixed(6)} BTC</p>
                </div>
                <div className="balance-item">
                    <h3>Total Value (USD)</h3>
                    <p>${totalValue.toFixed(2)}</p>
                    <span>Based on BTC @ ${currentPrice.toLocaleString()}</span>
                </div>
            </div>
        </div>
    );
};

export default BalanceTracker;
