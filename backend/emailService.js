const fetch = require('node-fetch');
const dotenv = require('dotenv');

dotenv.config();

class TelegramNotificationService {
    constructor() {
        this.initialized = false;
        this.verified = false;
        this.lastError = null;
        this.lastVerifiedAt = null;
        this.botUsername = null;
        this.cachedChatId = null;
        this.init();
    }

    _cleanEnv(value) {
        return String(value || '').trim().replace(/^['"]|['"]$/g, '');
    }

    _getConfig() {
        return {
            token: this._cleanEnv(process.env.TELEGRAM_BOT_TOKEN),
            chatId: this._cleanEnv(process.env.TELEGRAM_CHAT_ID)
        };
    }

    _recordError(prefix, error) {
        const description = error?.description || error?.message || 'Unknown error';
        this.lastError = `${prefix}: ${description}`;
        console.error(this.lastError);
    }

    _escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _formatMoney(value) {
        const number = Number(value);
        return Number.isFinite(number) ? `$${number.toFixed(2)}` : 'N/A';
    }

    _formatTime(value = Date.now()) {
        return new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    }

    _actionEmoji(action) {
        if (action === 'BUY') return '🟢';
        if (action === 'SELL') return '🔴';
        return '⚪';
    }

    _severityEmoji(severity) {
        return {
            INFO: 'ℹ️',
            WARNING: '⚠️',
            ERROR: '🚨'
        }[severity] || '📢';
    }

    init() {
        const { token, chatId } = this._getConfig();

        if (!token) {
            this.initialized = false;
            this.lastError = 'TELEGRAM_BOT_TOKEN is missing';
            console.warn('Telegram notification service disabled: TELEGRAM_BOT_TOKEN is missing.');
            return;
        }

        this.initialized = true;
        this.cachedChatId = chatId || null;
        this.lastError = chatId ? null : 'TELEGRAM_CHAT_ID is missing; send /start to the bot and call /api/telegram/verify';
        console.log(`Telegram notification service initialized${chatId ? ' with configured chat ID' : ' without chat ID'}`);
    }

    async _telegramRequest(method, payload = {}) {
        const { token } = this._getConfig();
        if (!token) throw new Error('TELEGRAM_BOT_TOKEN is missing');

        const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (!response.ok || data.ok === false) {
            const error = new Error(data.description || `Telegram API error ${response.status}`);
            error.description = data.description;
            throw error;
        }

        return data.result;
    }

    async _resolveChatId() {
        const config = this._getConfig();
        if (config.chatId) {
            this.cachedChatId = config.chatId;
            return config.chatId;
        }

        if (this.cachedChatId) return this.cachedChatId;

        const updates = await this._telegramRequest('getUpdates', { limit: 20 });
        const latestUpdate = [...updates].reverse().find(update => update.message?.chat?.id || update.channel_post?.chat?.id);
        const chatId = latestUpdate?.message?.chat?.id || latestUpdate?.channel_post?.chat?.id;

        if (!chatId) {
            throw new Error('TELEGRAM_CHAT_ID is missing and no Telegram chat was found. Send /start to the bot, then retry /api/telegram/verify.');
        }

        this.cachedChatId = String(chatId);
        return this.cachedChatId;
    }

    async verifyConnection() {
        if (!this.initialized) return false;

        try {
            const bot = await this._telegramRequest('getMe');
            this.botUsername = bot.username || null;
            await this._resolveChatId();
            this.verified = true;
            this.lastVerifiedAt = new Date().toISOString();
            this.lastError = null;
            console.log(`Telegram bot verified${this.botUsername ? `: @${this.botUsername}` : ''}`);
            return true;
        } catch (error) {
            this.verified = false;
            this._recordError('Telegram verification failed', error);
            return false;
        }
    }

    getStatus() {
        const config = this._getConfig();
        return {
            service: 'telegram',
            configured: Boolean(config.token),
            initialized: this.initialized,
            verified: this.verified,
            tokenConfigured: Boolean(config.token),
            chatIdConfigured: Boolean(config.chatId),
            chatId: config.chatId || this.cachedChatId || null,
            botUsername: this.botUsername,
            lastVerifiedAt: this.lastVerifiedAt,
            lastError: this.lastError
        };
    }

    async sendMessage(message, options = {}) {
        if (!this.initialized) {
            console.warn('Telegram notification service not initialized. Skipping message.');
            return false;
        }

        try {
            const chatId = await this._resolveChatId();
            await this._telegramRequest('sendMessage', {
                chat_id: chatId,
                text: message,
                parse_mode: options.parseMode || 'HTML',
                disable_web_page_preview: true
            });
            this.lastError = null;
            return true;
        } catch (error) {
            this._recordError('Telegram send failed', error);
            return false;
        }
    }

    async sendTradeNotification(trade, tradeType = 'TRADE') {
        const action = this._escapeHtml(trade.action || tradeType || 'TRADE');
        const score = trade.score ? `${trade.score}/10` : 'N/A';
        const actionEmoji = this._actionEmoji(trade.action);
        const title = tradeType.includes('AUTO') ? '🚀 Auto Paper Trade Opened' : '📌 Trading Bot Alert';

        return this.sendMessage([
            `<b>${title}</b>`,
            '━━━━━━━━━━━━━━━━━━━━',
            `${actionEmoji} <b>Action:</b> <code>${action}</code>`,
            `💰 <b>Entry:</b> <code>${this._formatMoney(trade.entry_price)}</code>`,
            `📦 <b>Lot:</b> <code>${trade.quantity || 0.01} BTC</code>`,
            `🛑 <b>Stop Loss:</b> <code>${this._formatMoney(trade.sl)}</code>`,
            `🎯 <b>Partial TP:</b> <code>${this._formatMoney(trade.tp1)}</code>`,
            `🏁 <b>Final TP:</b> <code>${this._formatMoney(trade.tp2)}</code>`,
            `⭐ <b>Confluence:</b> <code>${score}</code>`,
            '━━━━━━━━━━━━━━━━━━━━',
            `🕒 <b>Time:</b> ${this._escapeHtml(this._formatTime(trade.timestamp || Date.now()))} IST`
        ].join('\n'));
    }

    async sendDailySummary(summary) {
        const totalPnl = Number(summary.totalPnL || 0);
        const pnlEmoji = totalPnl >= 0 ? '🟢' : '🔴';

        return this.sendMessage([
            '<b>📊 Daily Trading Summary</b>',
            '━━━━━━━━━━━━━━━━━━━━',
            `📈 <b>Total Trades:</b> <code>${summary.tradesExecuted || 0}</code>`,
            `✅ <b>Wins:</b> <code>${summary.winningTrades || 0}</code>`,
            `❌ <b>Losses:</b> <code>${summary.losingTrades || 0}</code>`,
            `${pnlEmoji} <b>Total PnL:</b> <code>${this._formatMoney(totalPnl)}</code>`,
            '━━━━━━━━━━━━━━━━━━━━',
            `🕒 <b>Time:</b> ${this._escapeHtml(this._formatTime())} IST`
        ].join('\n'));
    }

    async sendAlert(title, message, severity = 'INFO') {
        const emoji = this._severityEmoji(severity);
        const safeTitle = this._escapeHtml(title);
        const safeMessage = this._escapeHtml(message);

        return this.sendMessage([
            `<b>${emoji} Trading Bot ${this._escapeHtml(severity)}</b>`,
            '━━━━━━━━━━━━━━━━━━━━',
            `📌 <b>${safeTitle}</b>`,
            '',
            safeMessage,
            '━━━━━━━━━━━━━━━━━━━━',
            `🕒 <b>Time:</b> ${this._escapeHtml(this._formatTime())} IST`
        ].join('\n'));
    }
}

module.exports = new TelegramNotificationService();
