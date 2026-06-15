const crypto = require('crypto');
const { UNIFIED_PRESET_CONFIG } = require('./strategyConfig');

const DEFAULT_STARTING_BALANCE = 50;
const LEGACY_STARTING_BALANCE = 100;
const AVATAR_COLORS = ['#2f6bff', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
const SESSION_TTL_HOURS = 12;
const DEFAULT_TERMINAL_SETTINGS = Object.freeze({
    riskPercentage: UNIFIED_PRESET_CONFIG.RISK_PERCENTAGE,
    minConfluenceScore: UNIFIED_PRESET_CONFIG.MIN_CONFLUENCE_SCORE,
    maxDailyTrades: UNIFIED_PRESET_CONFIG.DAILY_TRADE_LIMIT,
    maxDailyLosses: UNIFIED_PRESET_CONFIG.MAX_DAILY_LOSSES,
    defaultLotSize: UNIFIED_PRESET_CONFIG.TRADING_MIN_BTC_QTY
});

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

function validatePin(pin) {
    const value = String(pin || '').trim();
    if (!/^\d{4,8}$/.test(value)) throw new Error('PIN must be 4 to 8 digits');
    return value;
}

function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
    const safePin = validatePin(pin);
    const hash = crypto.pbkdf2Sync(safePin, salt, 120000, 32, 'sha256').toString('hex');
    return { salt, hash };
}

function verifyPin(pin, salt, expectedHash) {
    if (!salt || !expectedHash) return false;
    const { hash } = hashPin(pin, salt);
    const actual = Buffer.from(hash, 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function publicTerminal(row) {
    if (!row) return null;
    const { pinHash, pinSalt, ...terminal } = row;
    return {
        ...terminal,
        hasPin: Boolean(pinHash && pinSalt)
    };
}

async function ensureColumn(db, table, column, definition) {
    const columns = await dbAll(db, `PRAGMA table_info(${table})`);
    if (!columns.some(row => row.name === column)) {
        await dbRun(db, `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

function createTerminalTables(db) {
    const statements = [
        `CREATE TABLE IF NOT EXISTS terminal_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT UNIQUE NOT NULL,
            displayName TEXT NOT NULL,
            avatarInitial TEXT,
            avatarColor TEXT,
            pinHash TEXT,
            pinSalt TEXT,
            termsAcceptedAt DATETIME,
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
            minConfluenceScore INTEGER DEFAULT 6,
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

        `CREATE TABLE IF NOT EXISTS terminal_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT NOT NULL,
            tokenHash TEXT UNIQUE NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            expiresAt DATETIME NOT NULL
        )`,

        `CREATE INDEX IF NOT EXISTS idx_terminal_profiles_user_archived ON terminal_profiles(userId, archived)`,
        `CREATE INDEX IF NOT EXISTS idx_terminal_activity_user_timestamp ON terminal_activity_logs(userId, timestamp)`,
        `CREATE INDEX IF NOT EXISTS idx_terminal_sessions_user_expires ON terminal_sessions(userId, expiresAt)`
    ];

    return statements.reduce((promise, statement) => promise.then(() => dbRun(db, statement)), Promise.resolve())
        .then(() => ensureColumn(db, 'terminal_profiles', 'pinHash', 'TEXT'))
        .then(() => ensureColumn(db, 'terminal_profiles', 'pinSalt', 'TEXT'))
        .then(() => ensureColumn(db, 'terminal_profiles', 'termsAcceptedAt', 'DATETIME'));
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

async function syncUntouchedStartingBalancesToDefault(db) {
    await dbRun(
        db,
        `UPDATE terminal_profiles SET startingBalance = ? WHERE startingBalance = ?`,
        [DEFAULT_STARTING_BALANCE, LEGACY_STARTING_BALANCE]
    );

    const latestBalances = await dbAll(
        db,
        `SELECT b.*
         FROM balance b
         INNER JOIN (
             SELECT userId, MAX(id) AS id
             FROM balance
             GROUP BY userId
         ) latest ON b.id = latest.id
         WHERE b.usd_balance = ? AND COALESCE(b.btc_balance, 0) = 0`,
        [LEGACY_STARTING_BALANCE]
    );

    for (const balance of latestBalances) {
        const tradeStats = await dbGet(db, `SELECT COUNT(*) AS count FROM trades WHERE userId = ?`, [balance.userId]);
        if ((tradeStats?.count || 0) === 0) {
            await dbRun(
                db,
                `INSERT INTO balance (userId, usd_balance, btc_balance) VALUES (?, ?, 0)`,
                [balance.userId, DEFAULT_STARTING_BALANCE]
            );
            await logActivity(db, balance.userId, 'starting_balance_upgraded', {
                from: LEGACY_STARTING_BALANCE,
                to: DEFAULT_STARTING_BALANCE
            });
        }
    }
}

async function ensureSettings(db, userId) {
    const existing = await dbGet(db, `SELECT id FROM terminal_settings WHERE userId = ? LIMIT 1`, [userId]);
    if (!existing) {
        await dbRun(
            db,
            `INSERT INTO terminal_settings (userId, riskPercentage, minConfluenceScore, maxDailyTrades, maxDailyLosses, defaultLotSize)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                userId,
                DEFAULT_TERMINAL_SETTINGS.riskPercentage,
                DEFAULT_TERMINAL_SETTINGS.minConfluenceScore,
                DEFAULT_TERMINAL_SETTINGS.maxDailyTrades,
                DEFAULT_TERMINAL_SETTINGS.maxDailyLosses,
                DEFAULT_TERMINAL_SETTINGS.defaultLotSize
            ]
        );
    }
}

async function upgradeLegacyTerminalSettings(db) {
    await dbRun(
        db,
        `UPDATE terminal_settings
         SET minConfluenceScore = ?, updatedAt = CURRENT_TIMESTAMP
         WHERE riskPercentage = 5
           AND minConfluenceScore = 4
           AND maxDailyTrades = 1
           AND maxDailyLosses = 1
           AND defaultLotSize = 0.01`,
        [DEFAULT_TERMINAL_SETTINGS.minConfluenceScore]
    );
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
    if (!payload.termsAccepted) throw new Error('You must accept the terminal access terms');
    const { hash, salt } = hashPin(payload.pin);
    const userId = payload.userId ? String(payload.userId).trim() : generateTerminalUserId();
    const color = payload.avatarColor || defaultAvatarColor(displayName);

    await dbRun(
        db,
        `INSERT INTO terminal_profiles (userId, displayName, avatarInitial, avatarColor, pinHash, pinSalt, termsAcceptedAt, startingBalance)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
        [userId, displayName, avatarInitial(displayName), color, hash, salt, DEFAULT_STARTING_BALANCE]
    );

    await ensureBalance(db, userId, DEFAULT_STARTING_BALANCE);
    await ensureSettings(db, userId);
    await logActivity(db, userId, 'terminal_created', { displayName });
    return publicTerminal(await dbGet(db, `SELECT * FROM terminal_profiles WHERE userId = ?`, [userId]));
}

async function listTerminals(db, includeArchived = false) {
    const rows = await dbAll(
        db,
        `SELECT * FROM terminal_profiles ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY archived ASC, lastUsedAt DESC, createdAt DESC`
    );
    return rows.map(publicTerminal);
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
    return publicTerminal(await getTerminal(db, userId, false));
}

async function authenticateTerminal(db, userId, pin) {
    const terminal = await getTerminal(db, userId, false);
    if (!terminal) throw new Error('Terminal not found');
    verifyTerminalPinRecord(terminal, pin);

    await dbRun(db, `DELETE FROM terminal_sessions WHERE userId = ? AND expiresAt <= CURRENT_TIMESTAMP`, [userId]);
    const token = crypto.randomBytes(32).toString('hex');
    await dbRun(
        db,
        `INSERT INTO terminal_sessions (userId, tokenHash, expiresAt) VALUES (?, ?, datetime('now', '+' || ? || ' hours'))`,
        [userId, hashToken(token), SESSION_TTL_HOURS]
    );
    const selected = await selectTerminal(db, userId);
    await logActivity(db, userId, 'terminal_unlocked');
    return { terminal: selected, accessToken: token, expiresInHours: SESSION_TTL_HOURS };
}

function verifyTerminalPinRecord(terminal, pin) {
    if (!terminal.pinHash || !terminal.pinSalt) throw new Error('PIN setup is required before opening this terminal');
    if (!verifyPin(pin, terminal.pinSalt, terminal.pinHash)) throw new Error('Incorrect PIN');
    return true;
}

async function verifyTerminalPin(db, userId, pin, includeArchived = true) {
    const terminal = await getTerminal(db, userId, includeArchived);
    if (!terminal) throw new Error('Terminal not found');
    return verifyTerminalPinRecord(terminal, pin);
}

async function verifyAccessToken(db, userId, token) {
    if (!userId || !token) return false;
    const row = await dbGet(
        db,
        `SELECT id FROM terminal_sessions WHERE userId = ? AND tokenHash = ? AND expiresAt > CURRENT_TIMESTAMP LIMIT 1`,
        [userId, hashToken(token)]
    );
    return Boolean(row);
}

async function setTerminalPin(db, userId, payload = {}) {
    const terminal = await getTerminal(db, userId, true);
    if (!terminal) throw new Error('Terminal not found');
    if (!payload.termsAccepted && !terminal.termsAcceptedAt) throw new Error('You must accept the terminal access terms');
    if (terminal.pinHash && terminal.pinSalt && !verifyPin(payload.currentPin, terminal.pinSalt, terminal.pinHash)) {
        throw new Error('Current PIN is incorrect');
    }

    const { hash, salt } = hashPin(payload.pin);
    await dbRun(
        db,
        `UPDATE terminal_profiles
         SET pinHash = ?, pinSalt = ?, termsAcceptedAt = COALESCE(termsAcceptedAt, CURRENT_TIMESTAMP)
         WHERE userId = ?`,
        [hash, salt, userId]
    );
    await dbRun(db, `DELETE FROM terminal_sessions WHERE userId = ?`, [userId]);
    await logActivity(db, userId, 'terminal_pin_updated');
    return publicTerminal(await getTerminal(db, userId, true));
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
    return publicTerminal(await getTerminal(db, userId, true));
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
    return publicTerminal(await getTerminal(db, userId, true));
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
    return publicTerminal(await getTerminal(db, userId, true));
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
    authenticateTerminal,
    verifyAccessToken,
    verifyTerminalPin,
    setTerminalPin,
    updateTerminal,
    archiveTerminal,
    restoreTerminal,
    getSettings,
    updateSettings,
    getActivity,
    ensureTerminalForUser,
    ensureBalance,
    syncUntouchedStartingBalancesToDefault,
    upgradeLegacyTerminalSettings,
    logActivity,
    dbRun,
    dbGet,
    dbAll,
    publicTerminal
};
