import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:5001/api' : '/api');

export const fetchPrice = async () => {
    try {
        const response = await axios.get(`${API_BASE_URL}/price`);
        return response.data;
    } catch (error) {
        console.error('Error fetching price:', error);
        throw error;
    }
};

export const fetchPrices = async (limit = 100) => {
    try {
        const response = await axios.get(`${API_BASE_URL}/prices`, {
            params: { limit }
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching prices:', error);
        throw error;
    }
};

export const fetchBalance = async () => {
    try {
        const response = await axios.get(`${API_BASE_URL}/balance`);
        return response.data;
    } catch (error) {
        console.error('Error fetching balance:', error);
        throw error;
    }
};

export const fetchTrades = async (limit = 50) => {
    try {
        const response = await axios.get(`${API_BASE_URL}/trades`, {
            params: { limit }
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching trades:', error);
        throw error;
    }
};

export const fetchActiveTrades = async () => {
    try {
        const response = await axios.get(`${API_BASE_URL}/trades/active`);
        return response.data;
    } catch (error) {
        console.error('Error fetching active trades:', error);
        throw error;
    }
};

export const manualTrade = async (action, quantity = 0.01) => {
    try {
        const response = await axios.post(`${API_BASE_URL}/manual-trade`, { action, quantity });
        return response.data;
    } catch (error) {
        console.error(`Error executing ${action} trade:`, error);
        throw error.response?.data || error;
    }
};

export const closeTrade = async (tradeId) => {
    try {
        const response = await axios.post(`${API_BASE_URL}/trades/${tradeId}/close`);
        return response.data;
    } catch (error) {
        console.error(`Error closing trade ${tradeId}:`, error);
        throw error.response?.data || error;
    }
};

export const exportTradesCsvUrl = `${API_BASE_URL}/trades/export`;

export const recordTrade = async (tradeData) => {
    try {
        const response = await axios.post(`${API_BASE_URL}/trades`, tradeData);
        return response.data;
    } catch (error) {
        console.error('Error recording trade:', error);
        throw error;
    }
};

// WebSocket service for real-time updates
export const createPriceWebSocket = (onMessage) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname === 'localhost' ? 'localhost:5001' : window.location.host;
    const ws = new WebSocket(`${protocol}//${host}`);

    ws.onopen = () => {
        console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            onMessage(data);
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected');
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    return ws;
};