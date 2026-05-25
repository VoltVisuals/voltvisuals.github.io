const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET_PATH = path.join(__dirname, 'data', '.volt_secret');
const CLIENT_PEPPER = 'Vv1.6.1#volt';
const buckets = new Map();

function getSecret() {
  if (process.env.VOLT_SECRET) return process.env.VOLT_SECRET;
  if (fs.existsSync(SECRET_PATH)) {
    return fs.readFileSync(SECRET_PATH, 'utf8').trim();
  }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
  fs.writeFileSync(SECRET_PATH, secret, { mode: 0o600 });
  return secret;
}

const SECRET = getSecret();

function hmac(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest('hex');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

const MOD_RESPONSE_KEY = process.env.VOLT_MOD_KEY || 'Vv7K#m0dR3sp';

function signModResponse(token, username, expiresAt) {
  return crypto
    .createHmac('sha256', MOD_RESPONSE_KEY)
    .update(`${CLIENT_PEPPER}|${token}|${username}|${expiresAt}`)
    .digest('hex')
    .slice(0, 16);
}

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function rateLimit(key, maxAttempts = 8, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > maxAttempts) {
    const waitMin = Math.ceil((bucket.resetAt - now) / 60000);
    return { blocked: true, waitMin };
  }
  return { blocked: false };
}

function rateLimitMiddleware(scope, maxAttempts) {
  return (req, res, next) => {
    const ip = getClientIp(req);
    const result = rateLimit(`${scope}:${ip}`, maxAttempts);
    if (result.blocked) {
      return res.status(429).json({
        ok: false,
        error: `Слишком много попыток. Подождите ${result.waitMin} мин.`,
        code: 'RATE_LIMIT',
      });
    }
    next();
  };
}

function logAuthFail(type, ip, detail) {
  try {
    const { db } = require('./db');
    db.prepare(`
      INSERT INTO auth_failures (type, ip, detail, created_at)
      VALUES (?, ?, ?, ?)
    `).run(type, ip, detail || '', new Date().toISOString());
  } catch {
    /* ignore */
  }
}

module.exports = {
  SECRET,
  CLIENT_PEPPER,
  hmac,
  hashCode,
  signModResponse,
  getClientIp,
  rateLimit,
  rateLimitMiddleware,
  logAuthFail,
};
