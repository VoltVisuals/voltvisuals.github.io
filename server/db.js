const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'voltvisuals.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    hwid TEXT,
    subscription_plan TEXT,
    subscription_expires TEXT,
    created_at TEXT NOT NULL,
    banned INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS mod_sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    hwid TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS download_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    downloaded_at TEXT NOT NULL,
    ip TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_mod_sessions_user ON mod_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_mod_sessions_expires ON mod_sessions(expires_at);

  CREATE TABLE IF NOT EXISTS activation_keys (
    id TEXT PRIMARY KEY,
    code_hash TEXT UNIQUE NOT NULL,
    plan_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT,
    used_at TEXT,
    used_by TEXT,
    key_expires_at TEXT
  );

  CREATE TABLE IF NOT EXISTS auth_failures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    ip TEXT,
    detail TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_activation_keys_hash ON activation_keys(code_hash);
`);

function seedAdmin() {
  const existing = db
    .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
    .get('Lynivich');
  if (existing) return;

  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    'Lynivich',
    'admin@voltvisuals.local',
    bcrypt.hashSync('viva2288', 10),
    'admin',
    new Date().toISOString()
  );
}

seedAdmin();

function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    hwid: row.hwid,
    subscriptionPlan: row.subscription_plan,
    subscriptionExpires: row.subscription_expires,
    createdAt: row.created_at,
    banned: !!row.banned,
  };
}

function getUserById(id) {
  return sanitizeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

function isSubscriptionActive(user) {
  if (!user?.subscriptionExpires) return false;
  if (user.subscriptionExpires === 'lifetime') return true;
  return new Date(user.subscriptionExpires) > new Date();
}

module.exports = {
  db,
  uuidv4,
  sanitizeUser,
  getUserById,
  isSubscriptionActive,
};
