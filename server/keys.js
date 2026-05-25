const crypto = require('crypto');
const { db, uuidv4, getUserById, isSubscriptionActive } = require('./db');
const { hmac, hashCode, rateLimitMiddleware, logAuthFail, getClientIp } = require('./security');

const PLAN_CODES = {
  '30d': '30D',
  '6m': '6MO',
  lifetime: 'LIFE',
};

const CODE_TO_PLAN = Object.fromEntries(
  Object.entries(PLAN_CODES).map(([k, v]) => [v, k])
);

function normalizeCode(raw) {
  return (raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

function buildSignature(planCode, randomPart) {
  return hmac(`KEY|${planCode}|${randomPart}`).slice(0, 8).toUpperCase();
}

function generateActivationKey(planId, createdBy) {
  const planCode = PLAN_CODES[planId];
  if (!planCode) throw new Error('Unknown plan');

  const randomPart = crypto.randomBytes(6).toString('hex').toUpperCase();
  const sig = buildSignature(planCode, randomPart);
  const code = `VV-${planCode}-${randomPart}-${sig}`;
  const id = uuidv4();

  db.prepare(`
    INSERT INTO activation_keys (id, code_hash, plan_id, created_at, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, hashCode(code), planId, new Date().toISOString(), createdBy || null);

  return { id, code, planId };
}

function validateKeyFormat(code) {
  const normalized = normalizeCode(code);
  const match = normalized.match(/^VV-(30D|6MO|LIFE)-([A-F0-9]{12})-([A-F0-9]{8})$/);
  if (!match) return null;

  const [, planCode, randomPart, sig] = match;
  const expected = buildSignature(planCode, randomPart);
  if (sig !== expected) return null;

  return { planId: CODE_TO_PLAN[planCode], normalized: `VV-${planCode}-${randomPart}-${sig}` };
}

function redeemActivationKey(rawCode, userId, expectedPlanId) {
  const parsed = validateKeyFormat(rawCode);
  if (!parsed) {
    return { ok: false, error: 'Неверный код активации', code: 'INVALID_KEY' };
  }

  if (expectedPlanId && parsed.planId !== expectedPlanId) {
    return {
      ok: false,
      error: 'Код не подходит к выбранному тарифу',
      code: 'PLAN_MISMATCH',
    };
  }

  const row = db
    .prepare('SELECT * FROM activation_keys WHERE code_hash = ?')
    .get(hashCode(parsed.normalized));

  if (!row) {
    return { ok: false, error: 'Код не найден или подделан', code: 'INVALID_KEY' };
  }
  if (row.used_at) {
    return { ok: false, error: 'Код уже использован', code: 'KEY_USED' };
  }
  if (row.key_expires_at && new Date(row.key_expires_at) < new Date()) {
    return { ok: false, error: 'Срок действия кода истёк', code: 'KEY_EXPIRED' };
  }

  const user = getUserById(userId);
  if (!user) return { ok: false, error: 'Пользователь не найден' };

  const expires = computeExpiry(row.plan_id, user);
  db.prepare(`
    UPDATE users SET subscription_plan = ?, subscription_expires = ? WHERE id = ?
  `).run(row.plan_id, expires, userId);

  db.prepare(`
    UPDATE activation_keys SET used_at = ?, used_by = ? WHERE id = ?
  `).run(new Date().toISOString(), userId, row.id);

  return { ok: true, user: getUserById(userId), planId: row.plan_id };
}

function computeExpiry(planId, user) {
  if (planId === 'lifetime') return 'lifetime';
  const days = planId === '6m' ? 180 : 30;
  const base =
    isSubscriptionActive(user) && user.subscriptionExpires !== 'lifetime'
      ? new Date(user.subscriptionExpires)
      : new Date();
  base.setDate(base.getDate() + days);
  return base.toISOString();
}

function listKeys() {
  return db
    .prepare(
      `SELECT k.*, u.username AS used_by_name
       FROM activation_keys k
       LEFT JOIN users u ON u.id = k.used_by
       ORDER BY k.created_at DESC
       LIMIT 200`
    )
    .all()
    .map(row => ({
      id: row.id,
      planId: row.plan_id,
      createdAt: row.created_at,
      usedAt: row.used_at,
      usedBy: row.used_by_name || null,
      status: row.used_at ? 'used' : 'active',
    }));
}

function registerKeyRoutes(app, { requireAuth, requireAdmin }) {
  const redeemLimit = rateLimitMiddleware('redeem', 12);

  app.post('/api/subscription/redeem', requireAuth, redeemLimit, (req, res) => {
    const code = req.body.code || '';
    const planId = req.body.planId || null;
    const result = redeemActivationKey(code, req.user.id, planId);
    if (!result.ok) {
      logAuthFail('redeem', getClientIp(req), `${req.user.username}:${planId}`);
      return res.status(result.code === 'INVALID_KEY' ? 400 : 403).json(result);
    }
    res.json(result);
  });

  app.get('/api/admin/keys', requireAdmin, (req, res) => {
    res.json({ ok: true, keys: listKeys() });
  });

  app.post('/api/admin/keys/generate', requireAdmin, (req, res) => {
    const planId = req.body.planId;
    const count = Math.min(Math.max(parseInt(req.body.count, 10) || 1, 1), 20);
    if (!PLAN_CODES[planId]) {
      return res.status(400).json({ ok: false, error: 'Неизвестный тариф' });
    }

    const keys = [];
    for (let i = 0; i < count; i++) {
      keys.push(generateActivationKey(planId, req.user.id));
    }

    res.json({ ok: true, keys });
  });
}

module.exports = {
  generateActivationKey,
  redeemActivationKey,
  registerKeyRoutes,
  PLAN_CODES,
};
