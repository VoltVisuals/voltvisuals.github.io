const crypto = require('crypto');
const { db, uuidv4, getUserById, isSubscriptionActive } = require('./db');
const { hmac, hashCode, rateLimitMiddleware, logAuthFail, getClientIp } = require('./security');

const DURATIONS = {
  '1h': { code: '1H', minutes: 60, label: '1 час' },
  '2h': { code: '2H', minutes: 120, label: '2 часа' },
  '3h': { code: '3H', minutes: 180, label: '3 часа' },
  '6h': { code: '6H', minutes: 360, label: '6 часов' },
  '12h': { code: '12H', minutes: 720, label: '12 часов' },
  '1d': { code: '1D', minutes: 1440, label: '1 день' },
  '2d': { code: '2D', minutes: 2880, label: '2 дня' },
  '3d': { code: '3D', minutes: 4320, label: '3 дня' },
  '7d': { code: '7D', minutes: 10080, label: '1 неделя' },
  '14d': { code: '14D', minutes: 20160, label: '2 недели' },
  '30d': { code: '30D', minutes: 43200, label: '30 дней' },
  '6m': { code: '6MO', minutes: 259200, label: '6 месяцев' },
  lifetime: { code: 'LIFE', minutes: null, label: 'Навсегда' },
};

const PLAN_CODES = Object.fromEntries(
  Object.entries(DURATIONS).map(([id, d]) => [id, d.code])
);

const CODE_TO_PLAN = Object.fromEntries(
  Object.entries(DURATIONS).map(([id, d]) => [d.code, id])
);

const DUR_CODE_PATTERN = Object.values(DURATIONS)
  .map(d => d.code)
  .join('|');

function durationLabel(planId, durationMinutes) {
  if (durationMinutes && DURATIONS[planId]) {
    return DURATIONS[planId].label;
  }
  if (planId && DURATIONS[planId]) return DURATIONS[planId].label;
  if (planId === 'lifetime') return 'Навсегда';
  return planId || '—';
}

function normalizeCode(raw) {
  return (raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

function buildSignature(planCode, randomPart) {
  return hmac(`KEY|${planCode}|${randomPart}`).slice(0, 8).toUpperCase();
}

function generateActivationKey(planId, createdBy) {
  const meta = DURATIONS[planId];
  if (!meta) throw new Error('Unknown plan');

  const randomPart = crypto.randomBytes(6).toString('hex').toUpperCase();
  const sig = buildSignature(meta.code, randomPart);
  const code = `VV-${meta.code}-${randomPart}-${sig}`;
  const id = uuidv4();

  db.prepare(`
    INSERT INTO activation_keys (id, code_hash, plan_id, duration_minutes, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    hashCode(code),
    planId,
    meta.minutes,
    new Date().toISOString(),
    createdBy || null
  );

  return { id, code, planId, label: meta.label };
}

function validateKeyFormat(code) {
  const normalized = normalizeCode(code);
  const match = normalized.match(
    new RegExp(`^VV-(${DUR_CODE_PATTERN})-([A-F0-9]{12})-([A-F0-9]{8})$`)
  );
  if (!match) return null;

  const [, planCode, randomPart, sig] = match;
  const expected = buildSignature(planCode, randomPart);
  if (sig !== expected) return null;

  return {
    planId: CODE_TO_PLAN[planCode],
    normalized: `VV-${planCode}-${randomPart}-${sig}`,
  };
}

function computeExpiryFromKey(planId, durationMinutes, user) {
  if (planId === 'lifetime') return 'lifetime';

  let minutes = durationMinutes;
  if (minutes == null && DURATIONS[planId]) {
    minutes = DURATIONS[planId].minutes;
  }
  if (minutes == null) {
    const days = planId === '6m' ? 180 : 30;
    minutes = days * 24 * 60;
  }

  const base =
    isSubscriptionActive(user) && user.subscriptionExpires !== 'lifetime'
      ? new Date(user.subscriptionExpires)
      : new Date();
  base.setTime(base.getTime() + minutes * 60 * 1000);
  return base.toISOString();
}

function redeemActivationKey(rawCode, userId, expectedPlanId) {
  const parsed = validateKeyFormat(rawCode);
  if (!parsed) {
    return { ok: false, error: 'Неверный код активации', code: 'INVALID_KEY' };
  }

  const legacyPlans = ['30d', '6m', 'lifetime'];
  if (
    expectedPlanId &&
    legacyPlans.includes(expectedPlanId) &&
    legacyPlans.includes(parsed.planId) &&
    parsed.planId !== expectedPlanId
  ) {
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

  const expires = computeExpiryFromKey(row.plan_id, row.duration_minutes, user);
  db.prepare(`
    UPDATE users SET subscription_plan = ?, subscription_expires = ? WHERE id = ?
  `).run(row.plan_id, expires, userId);

  db.prepare(`
    UPDATE activation_keys SET used_at = ?, used_by = ? WHERE id = ?
  `).run(new Date().toISOString(), userId, row.id);

  return {
    ok: true,
    user: getUserById(userId),
    planId: row.plan_id,
    label: durationLabel(row.plan_id, row.duration_minutes),
  };
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
      durationMinutes: row.duration_minutes,
      label: durationLabel(row.plan_id, row.duration_minutes),
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
      logAuthFail('redeem', getClientIp(req), `${req.user.username}:${planId || 'any'}`);
      return res.status(result.code === 'INVALID_KEY' ? 400 : 403).json(result);
    }
    res.json(result);
  });

  app.get('/api/admin/keys', requireAdmin, (req, res) => {
    res.json({ ok: true, keys: listKeys() });
  });

  app.get('/api/admin/durations', requireAdmin, (req, res) => {
    const items = Object.entries(DURATIONS).map(([id, d]) => ({
      id,
      label: d.label,
      code: d.code,
    }));
    res.json({ ok: true, durations: items });
  });

  app.post('/api/admin/keys/generate', requireAdmin, (req, res) => {
    const planId = req.body.planId;
    const count = Math.min(Math.max(parseInt(req.body.count, 10) || 1, 1), 20);
    if (!DURATIONS[planId]) {
      return res.status(400).json({ ok: false, error: 'Неизвестный срок' });
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
  DURATIONS,
  durationLabel,
  computeExpiryFromKey,
};
