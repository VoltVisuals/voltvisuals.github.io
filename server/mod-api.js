const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const {
  db,
  uuidv4,
  sanitizeUser,
  getUserById,
  isSubscriptionActive,
} = require('./db');
const { signModResponse, rateLimitMiddleware, logAuthFail, getClientIp } = require('./security');

const MOD_TOKEN_DAYS = 14;
const MOD_VERSION = '1.6.1';
const JAR_NAME = `voltvisuals-${MOD_VERSION}.jar`;
const JAR_PATH = path.join(__dirname, 'files', JAR_NAME);

function cleanModSessions() {
  db.prepare('DELETE FROM mod_sessions WHERE expires_at < ?').run(Date.now());
}

function createModToken(userId, hwid) {
  cleanModSessions();
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + MOD_TOKEN_DAYS * 24 * 60 * 60 * 1000;
  db.prepare(`
    INSERT INTO mod_sessions (token, user_id, hwid, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, userId, hwid, expiresAt, now);
  return { token, expiresAt };
}

function revokeModSessions(userId) {
  db.prepare('DELETE FROM mod_sessions WHERE user_id = ?').run(userId);
}

function getModSession(token, hwid) {
  if (!token || !hwid) return null;
  cleanModSessions();
  const row = db
    .prepare(
      `SELECT ms.*, u.* FROM mod_sessions ms
       JOIN users u ON u.id = ms.user_id
       WHERE ms.token = ? AND ms.expires_at > ?`
    )
    .get(token, Date.now());
  if (!row) return null;
  if (row.hwid !== hwid) return { mismatch: true, user: sanitizeUser(row) };
  return { user: sanitizeUser(row) };
}

function findUserByLogin(login) {
  const q = login.trim().toLowerCase();
  return db
    .prepare(
      `SELECT * FROM users
       WHERE email = ? OR username = ? COLLATE NOCASE`
    )
    .get(q, login.trim());
}

function modPayload(user, token, expiresAt) {
  const payload = {
    username: user.username,
    subscriptionPlan: user.subscriptionPlan,
    subscriptionExpires: user.subscriptionExpires,
    hwidBound: !!user.hwid,
    modVersion: MOD_VERSION,
  };
  if (token && expiresAt) {
    payload.sig = signModResponse(token, user.username, expiresAt);
  }
  return payload;
}

function registerModRoutes(app, { requireAuth }) {
  const modLoginLimit = rateLimitMiddleware('mod-login', 10);
  const modVerifyLimit = rateLimitMiddleware('mod-verify', 30);

  app.post('/api/mod/login', modLoginLimit, (req, res) => {
    const login = (req.body.login || '').trim();
    const password = req.body.password || '';
    const hwid = (req.body.hwid || '').trim().toUpperCase();
    const modVersion = req.body.modVersion || '';

    if (!login || !password) {
      return res.status(400).json({ ok: false, error: 'Укажите логин и пароль' });
    }
    if (!hwid || hwid.length < 16 || hwid.length > 64) {
      return res.status(400).json({ ok: false, error: 'Некорректный HWID' });
    }
    if (modVersion && modVersion !== MOD_VERSION) {
      return res.status(400).json({
        ok: false,
        error: `Обновите мод до v${MOD_VERSION} на сайте`,
        code: 'VERSION_MISMATCH',
      });
    }

    const row = findUserByLogin(login);
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      logAuthFail('mod-login', getClientIp(req), login);
      return res.status(401).json({ ok: false, error: 'Неверный логин или пароль' });
    }

    const user = sanitizeUser(row);
    if (user.role === 'admin') {
      return res.status(403).json({ ok: false, error: 'Войдите через обычный аккаунт с подпиской' });
    }
    if (user.banned) {
      return res.status(403).json({ ok: false, error: 'Аккаунт заблокирован', code: 'BANNED' });
    }
    if (!isSubscriptionActive(user)) {
      return res.status(403).json({
        ok: false,
        error: 'Нет активной подписки. Купите на сайте voltvisuals',
        code: 'NO_SUBSCRIPTION',
      });
    }

    if (!user.hwid) {
      db.prepare('UPDATE users SET hwid = ? WHERE id = ?').run(hwid, user.id);
      user.hwid = hwid;
    } else if (user.hwid !== hwid) {
      return res.status(403).json({
        ok: false,
        error: 'HWID не совпадает. Сбросьте привязку в профиле или через поддержку',
        code: 'HWID_MISMATCH',
      });
    }

    revokeModSessions(user.id);
    const session = createModToken(user.id, hwid);
    const fresh = getUserById(user.id);
    res.json({
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      ...modPayload(fresh, session.token, session.expiresAt),
    });
  });

  app.post('/api/mod/verify', modVerifyLimit, (req, res) => {
    const token = (req.body.token || '').trim();
    const hwid = (req.body.hwid || '').trim().toUpperCase();

    if (!token || !hwid) {
      return res.status(400).json({ ok: false, error: 'Нет токена или HWID' });
    }

    const session = getModSession(token, hwid);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Сессия истекла — войдите снова', code: 'TOKEN_EXPIRED' });
    }
    if (session.mismatch) {
      return res.status(403).json({ ok: false, error: 'HWID не совпадает', code: 'HWID_MISMATCH' });
    }

    const user = session.user;
    if (user.banned) {
      revokeModSessions(user.id);
      return res.status(403).json({ ok: false, error: 'Аккаунт заблокирован', code: 'BANNED' });
    }
    if (!isSubscriptionActive(user)) {
      return res.status(403).json({ ok: false, error: 'Подписка истекла', code: 'NO_SUBSCRIPTION' });
    }
    if (user.hwid !== hwid) {
      return res.status(403).json({ ok: false, error: 'HWID не совпадает', code: 'HWID_MISMATCH' });
    }

    res.json({
      ok: true,
      expiresAt: Date.now() + MOD_TOKEN_DAYS * 86400000,
      ...modPayload(user, token, Date.now() + MOD_TOKEN_DAYS * 86400000),
    });
  });

  app.get('/api/mod/download', requireAuth, (req, res) => {
    if (!isSubscriptionActive(req.user)) {
      return res.status(403).json({ ok: false, error: 'Скачивание доступно только с активной подпиской' });
    }

    if (!fs.existsSync(JAR_PATH)) {
      return res.status(503).json({
        ok: false,
        error: `Положите ${JAR_NAME} в папку server/files/ на сервере`,
      });
    }

    db.prepare(`
      INSERT INTO download_logs (user_id, downloaded_at, ip)
      VALUES (?, ?, ?)
    `).run(req.user.id, new Date().toISOString(), req.ip || null);

    res.download(JAR_PATH, JAR_NAME);
  });
}

module.exports = {
  registerModRoutes,
  revokeModSessions,
  MOD_VERSION,
  JAR_NAME,
};
