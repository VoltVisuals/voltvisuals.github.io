const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const {
  db,
  uuidv4,
  sanitizeUser,
  getUserById,
  isSubscriptionActive,
} = require('./db');
const { registerModRoutes, revokeModSessions } = require('./mod-api');
const { registerKeyRoutes, DURATIONS, computeExpiryFromKey } = require('./keys');
const { encryptPassword, decryptPassword } = require('./credentials');
const { rateLimitMiddleware, logAuthFail, getClientIp } = require('./security');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');
const SESSION_DAYS = 30;
const COOKIE_NAME = 'volt_session';

const PLANS = {
  '30d': { days: 30, price: 150, label: '30 дней' },
  '6m': { days: 180, price: 250, label: '6 месяцев' },
  lifetime: { days: null, price: 399, label: 'Навсегда' },
};

app.use(express.json());
app.use(cookieParser());
app.use(express.static(ROOT));

function cleanExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

function createSession(userId) {
  cleanExpiredSessions();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    expiresAt
  );
  return { token, expiresAt };
}

function getSessionUser(req) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return null;
  cleanExpiredSessions();
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    )
    .get(token, Date.now());
  return sanitizeUser(row);
}

function setSessionCookie(res, token, expiresAt) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: expiresAt - Date.now(),
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Не авторизован' });
  if (user.banned) return res.status(403).json({ ok: false, error: 'Аккаунт заблокирован' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = getSessionUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Доступ запрещён' });
  }
  req.user = user;
  next();
}

function findUserByLogin(login) {
  const q = login.trim().toLowerCase();
  const row = db
    .prepare(
      `SELECT * FROM users
       WHERE email = ? OR username = ? COLLATE NOCASE`
    )
    .get(q, login.trim());
  return row;
}

function computeExpiry(planId, currentUser) {
  if (planId === 'lifetime') return 'lifetime';
  const plan = PLANS[planId];
  const base =
    isSubscriptionActive(currentUser) && currentUser.subscriptionExpires !== 'lifetime'
      ? new Date(currentUser.subscriptionExpires)
      : new Date();
  base.setDate(base.getDate() + plan.days);
  return base.toISOString();
}

// ── Auth ──────────────────────────────────────────────

app.get('/api/auth/me', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.json({ ok: true, user: null });
  if (user.banned) {
    clearSessionCookie(res);
    const token = req.cookies[COOKIE_NAME];
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return res.json({ ok: true, user: null });
  }
  res.json({ ok: true, user });
});

app.post('/api/auth/register', (req, res) => {
  const username = (req.body.username || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';

  if (username.length < 3) {
    return res.status(400).json({ ok: false, error: 'Ник минимум 3 символа' });
  }
  if (!email.includes('@')) {
    return res.status(400).json({ ok: false, error: 'Некорректный email' });
  }
  if (password.length < 6) {
    return res.status(400).json({ ok: false, error: 'Пароль минимум 6 символов' });
  }

  const emailTaken = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (emailTaken) return res.status(409).json({ ok: false, error: 'Этот email уже зарегистрирован' });

  const nickTaken = db
    .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
    .get(username);
  if (nickTaken) return res.status(409).json({ ok: false, error: 'Этот ник уже занят' });

  const id = uuidv4();
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, role, created_at)
    VALUES (?, ?, ?, ?, 'user', ?)
  `).run(id, username, email, bcrypt.hashSync(password, 10), createdAt);

  try {
    db.prepare(`
      INSERT INTO registration_credentials (user_id, username, email, password_enc, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, username, email, encryptPassword(password), createdAt);
  } catch {
    /* ignore duplicate */
  }

  const session = createSession(id);
  setSessionCookie(res, session.token, session.expiresAt);
  res.json({ ok: true, user: getUserById(id) });
});

app.post('/api/auth/login', rateLimitMiddleware('web-login', 15), (req, res) => {
  const login = req.body.login || '';
  const password = req.body.password || '';
  const row = findUserByLogin(login);

  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    logAuthFail('web-login', getClientIp(req), login);
    return res.status(401).json({ ok: false, error: 'Неверный логин или пароль' });
  }

  const user = sanitizeUser(row);
  if (user.banned) {
    return res.status(403).json({ ok: false, error: 'Аккаунт заблокирован' });
  }

  const session = createSession(user.id);
  setSessionCookie(res, session.token, session.expiresAt);
  res.json({ ok: true, user });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ── Subscription (только через ключи активации) ───────

registerKeyRoutes(app, { requireAuth, requireAdmin });

registerModRoutes(app, { requireAuth });

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS c FROM users WHERE role = ?').get('user').c;
  const active = db
    .prepare(
      `SELECT COUNT(*) AS c FROM users
       WHERE role = 'user' AND (
         subscription_expires = 'lifetime'
         OR (subscription_expires IS NOT NULL AND subscription_expires > datetime('now'))
       )`
    )
    .get().c;
  const banned = db.prepare('SELECT COUNT(*) AS c FROM users WHERE banned = 1').get().c;
  res.json({ ok: true, stats: { total, active, banned } });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    rows = db
      .prepare(
        `SELECT * FROM users WHERE role = 'user' AND (
          username LIKE ? COLLATE NOCASE OR email LIKE ?
        ) ORDER BY created_at DESC`
      )
      .all(`%${q}%`, `%${q}%`);
  } else {
    rows = db
      .prepare("SELECT * FROM users WHERE role = 'user' ORDER BY created_at DESC")
      .all();
  }
  res.json({ ok: true, users: rows.map(sanitizeUser) });
});

app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ ok: false, error: 'Пользователь не найден' });
  if (target.role === 'admin') {
    return res.status(403).json({ ok: false, error: 'Нельзя редактировать администратора' });
  }

  const patch = req.body || {};
  const fields = [];
  const values = [];

  if (typeof patch.banned === 'boolean') {
    fields.push('banned = ?');
    values.push(patch.banned ? 1 : 0);
    if (patch.banned) {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      revokeModSessions(target.id);
    }
  }

  if (patch.hwid === null || patch.hwid === '') {
    fields.push('hwid = NULL');
    revokeModSessions(target.id);
  } else if (typeof patch.hwid === 'string') {
    fields.push('hwid = ?');
    values.push(patch.hwid.trim());
  }

  if (patch.subscriptionPlan !== undefined) {
    const planId = patch.subscriptionPlan;
    if (planId === null || planId === '') {
      fields.push('subscription_plan = NULL', 'subscription_expires = NULL');
    } else if (PLANS[planId] || DURATIONS[planId]) {
      fields.push('subscription_plan = ?');
      values.push(planId);
      if (patch.subscriptionExpires !== undefined) {
        fields.push('subscription_expires = ?');
        values.push(patch.subscriptionExpires);
      } else if (DURATIONS[planId]) {
        fields.push('subscription_expires = ?');
        values.push(
          computeExpiryFromKey(planId, DURATIONS[planId].minutes, sanitizeUser(target))
        );
      } else {
        fields.push('subscription_expires = ?');
        values.push(computeExpiry(planId, sanitizeUser(target)));
      }
    }
  } else if (patch.subscriptionExpires !== undefined) {
    fields.push('subscription_expires = ?');
    values.push(patch.subscriptionExpires);
  }

  if (!fields.length) {
    return res.status(400).json({ ok: false, error: 'Нечего обновлять' });
  }

  values.push(req.params.id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json({ ok: true, user: getUserById(req.params.id) });
});

app.post('/api/admin/users/:id/revoke-subscription', requireAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ ok: false, error: 'Пользователь не найден' });
  if (target.role === 'admin') {
    return res.status(403).json({ ok: false, error: 'Нельзя изменять администратора' });
  }

  db.prepare(`
    UPDATE users SET subscription_plan = NULL, subscription_expires = NULL WHERE id = ?
  `).run(target.id);
  revokeModSessions(target.id);

  res.json({ ok: true, user: getUserById(target.id) });
});

app.get('/api/admin/users/:id/credentials', requireAdmin, (req, res) => {
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ ok: false, error: 'Пользователь не найден' });
  if (target.role === 'admin') {
    return res.status(403).json({ ok: false, error: 'Недоступно для администратора' });
  }

  const row = db
    .prepare('SELECT * FROM registration_credentials WHERE user_id = ?')
    .get(req.params.id);

  if (!row) {
    return res.json({
      ok: true,
      credentials: null,
      message: 'Данные регистрации недоступны (аккаунт создан до обновления)',
    });
  }

  try {
    res.json({
      ok: true,
      credentials: {
        username: row.username,
        email: row.email,
        password: decryptPassword(row.password_enc),
        createdAt: row.created_at,
      },
    });
  } catch {
    res.status(500).json({ ok: false, error: 'Не удалось расшифровать пароль' });
  }
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ ok: false, error: 'Пользователь не найден' });
  if (target.role === 'admin') {
    return res.status(403).json({ ok: false, error: 'Нельзя удалить администратора' });
  }
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.params.id);
  revokeModSessions(req.params.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`VoltVisuals → http://localhost:${PORT}`);
});
