const crypto = require('crypto');

const DEFAULT_STARTING_BALANCE = 50;
const AVATAR_COLORS = ['#2f6bff', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
}

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function normalizeDisplayName(displayName) {
    const name = String(displayName || '').trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('Terminal name is required');
    return name.slice(0, 40);
}

function avatarInitial(displayName) {
    return normalizeDisplayName(displayName).charAt(0).toUpperCase();
}

function defaultAvatarColor(displayName) {
    const name = normalizeDisplayName(displayName);
    const index = name.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR_COLORS.length;
    return AVATAR_COLORS[index];
}

function generateTerminalUserId() {
    return `terminal_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function createTerminalTables(db) {
    const statements = [
        `CREATE TABLE IF NOT EXISTS terminal_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT UNIQUE NOT NULL,
            displayName TEXT NOT NULL,
            avatarInitial TEXT,
            avatarColor TEXT,
            startingBalance REAL DEFAULT 50,
            archived INTEGER DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            lastUsedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            archivedAt DATETIME
        )`,

        `CREATE TABLE IF NOT EXISTS terminal_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT UNIQUE NOT NULL,
            riskPercentage REAL DEFAULT 5,
            minConfluenceScore INTEGER DEFAULT 4,
            maxDailyTrades INTEGER DEFAULT 1,
            maxDailyLosses INTEGER DEFAULT 1,
            defaultLotSize REAL DEFAULT 0.01,
            telegramEnabled INTEGER DEFAULT 1,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE TABLE IF NOT EXISTS terminal_activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT NOT NULL,
            eventType TEXT NOT NULL,
            eventJson TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,

        `CREATE INDEX IF NOT EXISTS idx_terminal_profiles_user_archived ON terminal_profiles(userId, archived)`,
        `CREATE INDEX IF NOT EXISTS idx_terminal_activity_user_timestamp ON terminal_activity_logs(userId, timestamp)`
    ];

    return statements.reduce((promise, statement) => promise.then(() => dbRun(db, statement)), Promise.resolve());
}

async function logActivity(db, userId, eventType, event = {}) {
    try {
        await dbRun(
            db,
            `INSERT INTO terminal_activity_logs (userId, eventType, eventJson) VALUES (?, ?, ?)`,
            [userId, eventType, JSON.stringify(event || {})]
        );
    } catch (error) {
        console.error('Terminal activity log failed:', error.message);
    }
}

async function ensureBalance(db, userId, startingBalance = DEFAULT_STARTING_BALANCE) {
    const existing = await dbGet(db, `SELECT id FROM balance WHERE userId = ? LIMIT 1`, [userId]);
    if (!existing) {
        await dbRun(
            db,
            `INSERT INTO balance (userId, usd_balance, btc_balance) VALUES (?, ?, 0)`,
            [userId, startingBalance]
        );
    }
}

async function ensureSettings(db, userId) {
    const existing = await dbGet(db, `SELECT id FROM terminal_settings WHERE userId = ? LIMIT 1`, [userId]);
    if (!existing) {
        await dbRun(db, `INSERT INTO terminal_settings (userId) VALUES (?)`, [userId]);
    }
}

async function ensureTerminalForUser(db, userId, displayName = 'Terminal') {
    const safeUserId = String(userId || '').trim();
    if (!safeUserId) throw new Error('userId is required');

    let terminal = await dbGet(db, `SELECT * FROM terminal_profiles WHERE userId = ?`, [safeUserId]);
    if (!terminal) {
        const name = normalizeDisplayName(displayName);
        await dbRun(
            db,
            `INSERT INTO terminal_profiles (userId, displayName, avatarInitial, avatarColor, startingBalance)
             VALUES (?, ?, ?, ?, ?)`,
            [safeUserId, name, avatarInitial(name), defaultAvatarColor(name), DEFAULT_STARTING_BALANCE]
        );
        terminal = await dbGet(db, `SELECT * FROM terminal_profiles WHERE userId = ?`, [safeUserId]);
        await logActivity(db, safeUserId, 'terminal_created', { displayName: name, migrated: true });
    }

    await ensureBalance(db, safeUserId, terminal.startingBalance || DEFAULT_STARTING_BALANCE);
    await ensureSettings(db, safeUserId);
    return terminal;
}

async function createTerminal(db, payload = {}) {
    const displayName = normalizeDisplayName(payload.displayName);
    const userId = payload.userId ? String(payload.userId).trim() : generateTerminalUserId();
    const color = payload.avatarColor || defaultAvatarColor(displayName);

    await dbRun(
        db,
        `INSERT INTO terminal_profiles (userId, displayName, avatarInitial, avatarColor, startingBalance)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, displayName, avatarInitial(displayName), color, DEFAULT_STARTING_BALANCE]
    );

    await ensureBalance(db, userId, DEFAULT_STARTING_BALANCE);
    await ensureSettings(db, userId);
    await logActivity(db, userId, 'terminal_created', { displayName });
    return dbGet(db, `SELECT * FROM terminal_profiles WHERE userId = ?`, [userId]);
}

function listTerminals(db, includeArchived = false) {
    return dbAll(
        db,
        `SELECT * FROM terminal_profiles ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY archived ASC, lastUsedAt DESC, createdAt DESC`
    );
}

function getTerminal(db, userId, includeArchived = true) {
    return dbGet(
        db,
        `SELECT * FROM terminal_profiles WHERE userId = ? ${includeArchived ? '' : 'AND archived = 0'}`,
        [userId]
    );
}

async function selectTerminal(db, userId) {
    const terminal = await getTerminal(db, userId, false);
    if (!terminal) throw new Error('Terminal not found');

    await dbRun(db, `UPDATE terminal_profiles SET lastUsedAt = CURRENT_TIMESTAMP WHERE userId = ?`, [userId]);
    await ensureBalance(db, userId, terminal.startingBalance || DEFAULT_STARTING_BALANCE);
    await ensureSettings(db, userId);
    await logActivity(db, userId, 'terminal_selected');
    return getTerminal(db, userId, false);
}

async function updateTerminal(db, userId, payload = {}) {
    const terminal = await getTerminal(db, userId, true);
    if (!terminal) throw new Error('Terminal not found');

    const displayName = payload.displayName !== undefined ? normalizeDisplayName(payload.displayName) : terminal.displayName;
    const color = payload.avatarColor || terminal.avatarColor || defaultAvatarColor(displayName);

    await dbRun(
        db,
        `UPDATE terminal_profiles SET displayName = ?, avatarInitial = ?, avatarColor = ? WHERE userId = ?`,
        [displayName, avatarInitial(displayName), color, userId]
    );
    await logActivity(db, userId, 'terminal_updated', { displayName, avatarColor: color });
    return getTerminal(db, userId, true);
}

async function archiveTerminal(db, userId) {
    const terminal = await getTerminal(db, userId, true);
    if (!terminal) throw new Error('Terminal not found');

    await dbRun(
        db,
        `UPDATE terminal_profiles SET archived = 1, archivedAt = CURRENT_TIMESTAMP WHERE userId = ?`,
        [userId]
    );
    await logActivity(db, userId, 'terminal_archived');
    return getTerminal(db, userId, true);
}

async function restoreTerminal(db, userId) {
    const terminal = await getTerminal(db, userId, true);
    if (!terminal) throw new Error('Terminal not found');

    await dbRun(
        db,
        `UPDATE terminal_profiles SET archived = 0, archivedAt = NULL, lastUsedAt = CURRENT_TIMESTAMP WHERE userId = ?`,
        [userId]
    );
    await logActivity(db, userId, 'terminal_restored');
    return getTerminal(db, userId, true);
}

async function getSettings(db, userId) {
    await ensureSettings(db, userId);
    return dbGet(db, `SELECT * FROM terminal_settings WHERE userId = ?`, [userId]);
}

async function updateSettings(db, userId, payload = {}) {
    await ensureSettings(db, userId);
    const allowed = ['riskPercentage', 'minConfluenceScore', 'maxDailyTrades', 'maxDailyLosses', 'defaultLotSize', 'telegramEnabled'];
    const updates = [];
    const params = [];

    allowed.forEach(key => {
        if (payload[key] !== undefined) {
            updates.push(`${key} = ?`);
            params.push(payload[key]);
        }
    });

    if (updates.length > 0) {
        params.push(userId);
        await dbRun(
            db,
            `UPDATE terminal_settings SET ${updates.join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?`,
            params
        );
        await logActivity(db, userId, 'settings_updated', payload);
    }

    return getSettings(db, userId);
}

async function getActivity(db, userId, limit = 50) {
    return dbAll(
        db,
        `SELECT * FROM terminal_activity_logs WHERE userId = ? ORDER BY timestamp DESC LIMIT ?`,
        [userId, Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)]
    );
}

module.exports = {
    DEFAULT_STARTING_BALANCE,
    createTerminalTables,
    createTerminal,
    listTerminals,
    getTerminal,
    selectTerminal,
    updateTerminal,
    archiveTerminal,
    restoreTerminal,
    getSettings,
    updateSettings,
    getActivity,
    ensureTerminalForUser,
    ensureBalance,
    logActivity,
    dbRun,
    dbGet,
    dbAll
};
