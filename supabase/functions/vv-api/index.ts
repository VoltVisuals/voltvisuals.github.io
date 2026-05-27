import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

const DURATIONS: Record<string, { code: string; minutes: number | null; label: string }> = {
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

const CODE_TO_PLAN = Object.fromEntries(Object.entries(DURATIONS).map(([k, v]) => [v.code, k]));
const DUR_CODE_PATTERN = Object.values(DURATIONS).map((d) => d.code).join('|');
const MOD_VERSION = '1.6.3';
const JAR_NAME = `voltvisuals-${MOD_VERSION}.jar`;
const MOD_TOKEN_DAYS = 14;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function err(error: string, status = 400, code?: string) {
  return json({ ok: false, error, code }, status);
}

async function hmacHex(data: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashCode(code: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code.trim().toUpperCase()));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function mapProfile(row: Record<string, unknown>) {
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

function isSubscriptionActive(user: ReturnType<typeof mapProfile>) {
  if (!user.subscriptionExpires) return false;
  if (user.subscriptionExpires === 'lifetime') return true;
  return new Date(user.subscriptionExpires as string) > new Date();
}

function computeExpiryFromKey(planId: string, durationMinutes: number | null, user: ReturnType<typeof mapProfile>) {
  if (planId === 'lifetime') return 'lifetime';
  let minutes = durationMinutes;
  if (minutes == null && DURATIONS[planId]) minutes = DURATIONS[planId].minutes;
  if (minutes == null) minutes = planId === '6m' ? 259200 : 43200;
  const base =
    isSubscriptionActive(user) && user.subscriptionExpires !== 'lifetime'
      ? new Date(user.subscriptionExpires as string)
      : new Date();
  base.setTime(base.getTime() + (minutes as number) * 60 * 1000);
  return base.toISOString();
}

async function buildSignature(planCode: string, randomPart: string, secret: string) {
  return (await hmacHex(`KEY|${planCode}|${randomPart}`, secret)).slice(0, 8).toUpperCase();
}

async function validateKeyFormat(code: string, secret: string) {
  const normalized = (code || '').trim().toUpperCase().replace(/\s+/g, '');
  const match = normalized.match(new RegExp(`^VV-(${DUR_CODE_PATTERN})-([A-F0-9]{12})-([A-F0-9]{8})$`));
  if (!match) return null;
  const [, planCode, randomPart, sig] = match;
  const expected = await buildSignature(planCode, randomPart, secret);
  if (sig !== expected) return null;
  return { planId: CODE_TO_PLAN[planCode], normalized: `VV-${planCode}-${randomPart}-${sig}` };
}

async function signModResponse(token: string, username: string, expiresAt: number, modKey: string) {
  return (await hmacHex(`Vv1.6.1#volt|${token}|${username}|${expiresAt}`, modKey)).slice(0, 16);
}

function getRoute(req: Request) {
  const url = new URL(req.url);
  let path = url.pathname;
  path = path.replace(/^\/functions\/v1\/vv-api/, '');
  if (!path.startsWith('/')) path = '/' + path;
  return { path, url };
}

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
    Deno.env.get('SUPABASE_SECRET_KEY') ||
    '';
  return createClient(url, key);
}

async function getAuthUser(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await adminClient().from('profiles').select('*').eq('id', user.id).single();
  if (!profile || profile.banned) return null;
  return { user, profile: mapProfile(profile) };
}

async function requireAdmin(req: Request) {
  const auth = await getAuthUser(req);
  if (!auth || auth.profile.role !== 'admin') return null;
  return auth;
}

async function encryptPassword(plain: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode('volt-reg-v1'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  const encBytes = new Uint8Array(enc);
  const ivHex = Array.from(iv).map((b) => b.toString(16).padStart(2, '0')).join('');
  const dataHex = Array.from(encBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${ivHex}:${dataHex}`;
}

async function decryptPassword(payload: string, secret: string) {
  const [ivHex, dataHex] = payload.split(':');
  const iv = new Uint8Array(ivHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const data = new Uint8Array(dataHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode('volt-reg-v1'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(dec);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const { path, url } = getRoute(req);
  const db = adminClient();
  const hmacSecret = Deno.env.get('VOLT_HMAC_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!.slice(0, 32);
  const modKey = Deno.env.get('VOLT_MOD_KEY') || 'Vv7K#m0dR3sp';
  const regSecret = Deno.env.get('VOLT_REG_SECRET') || hmacSecret;

  try {
    // ── Auth helper ──
    if (path === '/auth/store-credentials' && req.method === 'POST') {
      const auth = await getAuthUser(req);
      if (!auth) return err('Не авторизован', 401);
      const body = await req.json();
      const password = body.password || '';
      if (password.length < 6) return err('Пароль слишком короткий');
      const enc = await encryptPassword(password, regSecret);
      await db.from('registration_credentials').upsert({
        user_id: auth.user.id,
        username: auth.profile.username,
        email: auth.profile.email,
        password_enc: enc,
        created_at: new Date().toISOString(),
      });
      return json({ ok: true });
    }

    // ── Redeem key ──
    if (path === '/subscription/redeem' && req.method === 'POST') {
      const auth = await getAuthUser(req);
      if (!auth) return err('Не авторизован', 401);
      const body = await req.json();
      const parsed = await validateKeyFormat(body.code || '', hmacSecret);
      if (!parsed) return err('Неверный код активации', 400, 'INVALID_KEY');

      const codeHash = await hashCode(parsed.normalized);
      const { data: row } = await db.from('activation_keys').select('*').eq('code_hash', codeHash).single();
      if (!row) return err('Код не найден или подделан', 400, 'INVALID_KEY');
      if (row.used_at) return err('Код уже использован', 403, 'KEY_USED');

      const expires = computeExpiryFromKey(row.plan_id, row.duration_minutes, auth.profile);
      await db.from('profiles').update({
        subscription_plan: row.plan_id,
        subscription_expires: expires,
      }).eq('id', auth.user.id);

      await db.from('activation_keys').update({
        used_at: new Date().toISOString(),
        used_by: auth.user.id,
      }).eq('id', row.id);

      const { data: fresh } = await db.from('profiles').select('*').eq('id', auth.user.id).single();
      return json({ ok: true, user: mapProfile(fresh!), planId: row.plan_id });
    }

    // ── Mod API ──
    if (path === '/mod/login' || path === '/api/mod/login') {
      if (req.method !== 'POST') return err('Method not allowed', 405);
      const body = await req.json();
      const login = (body.login || '').trim();
      const password = body.password || '';
      const hwid = (body.hwid || '').trim().toUpperCase();
      if (!login || !password) return err('Укажите логин и пароль');
      if (!hwid || hwid.length < 16) return err('Некорректный HWID');

      let email = login.includes('@') ? login.toLowerCase() : null;
      if (!email) {
        const { data: resolved } = await db.rpc('get_email_by_username', { p_username: login });
        email = resolved;
      }
      if (!email) return err('Неверный логин или пароль', 401);

      const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
      const { error: signErr } = await anon.auth.signInWithPassword({ email, password });
      if (signErr) return err('Неверный логин или пароль', 401);

      const { data: row } = await db.from('profiles').select('*').eq('email', email).single();
      if (!row) return err('Пользователь не найден', 401);
      const user = mapProfile(row);
      if (user.role === 'admin') return err('Войдите через обычный аккаунт с подпиской', 403);
      if (user.banned) return err('Аккаунт заблокирован', 403, 'BANNED');
      if (!isSubscriptionActive(user)) return err('Нет активной подписки', 403, 'NO_SUBSCRIPTION');

      if (!user.hwid) {
        await db.from('profiles').update({ hwid }).eq('id', user.id);
        user.hwid = hwid;
      } else if (user.hwid !== hwid) {
        return err('HWID не совпадает', 403, 'HWID_MISMATCH');
      }

      await db.from('mod_sessions').delete().eq('user_id', user.id);
      const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
      const now = Date.now();
      const expiresAt = now + MOD_TOKEN_DAYS * 86400000;
      await db.from('mod_sessions').insert({
        token, user_id: user.id, hwid, expires_at: expiresAt, created_at: now,
      });

      const sig = await signModResponse(token, user.username, expiresAt, modKey);
      return json({
        ok: true, token, expiresAt,
        username: user.username,
        subscriptionPlan: user.subscriptionPlan,
        subscriptionExpires: user.subscriptionExpires,
        hwidBound: true,
        modVersion: MOD_VERSION,
        sig,
      });
    }

    if (path === '/mod/verify' || path === '/api/mod/verify') {
      if (req.method !== 'POST') return err('Method not allowed', 405);
      const body = await req.json();
      const token = (body.token || '').trim();
      const hwid = (body.hwid || '').trim().toUpperCase();
      if (!token || !hwid) return err('Нет токена или HWID');

      const { data: session } = await db.from('mod_sessions').select('*').eq('token', token).gt('expires_at', Date.now()).single();
      if (!session) return err('Сессия истекла', 401, 'TOKEN_EXPIRED');
      if (session.hwid !== hwid) return err('HWID не совпадает', 403, 'HWID_MISMATCH');

      const { data: profileRow } = await db.from('profiles').select('*').eq('id', session.user_id).single();
      if (!profileRow) return err('Пользователь не найден', 401);
      const user = mapProfile(profileRow);
      if (user.banned) return err('Аккаунт заблокирован', 403, 'BANNED');
      if (!isSubscriptionActive(user)) return err('Подписка истекла', 403, 'NO_SUBSCRIPTION');

      const expiresAt = Date.now() + MOD_TOKEN_DAYS * 86400000;
      const sig = await signModResponse(token, user.username, expiresAt, modKey);
      return json({
        ok: true, expiresAt,
        username: user.username,
        subscriptionPlan: user.subscriptionPlan,
        subscriptionExpires: user.subscriptionExpires,
        hwidBound: !!user.hwid,
        modVersion: MOD_VERSION,
        sig,
      });
    }

    if (path === '/mod/download' || path === '/api/mod/download') {
      const auth = await getAuthUser(req);
      if (!auth) return err('Не авторизован', 401);
      if (!isSubscriptionActive(auth.profile)) return err('Нужна активная подписка', 403);

      await db.from('download_logs').insert({
        user_id: auth.user.id,
        downloaded_at: new Date().toISOString(),
        ip: req.headers.get('x-forwarded-for')?.split(',')[0] || null,
      });

      const { data, error } = await db.storage.from('mod-releases').createSignedUrl(JAR_NAME, 300);
      if (error || !data?.signedUrl) {
        return err(`Загрузите ${JAR_NAME} в Storage → bucket mod-releases`, 503);
      }
      return json({ ok: true, url: data.signedUrl, filename: JAR_NAME });
    }

    // ── Admin ──
    if (path === '/admin/durations' && req.method === 'GET') {
      if (!(await requireAdmin(req))) return err('Доступ запрещён', 403);
      const items = Object.entries(DURATIONS).map(([id, d]) => ({ id, label: d.label, code: d.code }));
      return json({ ok: true, durations: items });
    }

    if (path === '/admin/stats' && req.method === 'GET') {
      if (!(await requireAdmin(req))) return err('Доступ запрещён', 403);
      const { count: total } = await db.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'user');
      const { data: users } = await db.from('profiles').select('subscription_expires, role, banned').eq('role', 'user');
      const now = new Date();
      const active = (users || []).filter((u) => {
        if (!u.subscription_expires) return false;
        if (u.subscription_expires === 'lifetime') return true;
        return new Date(u.subscription_expires) > now;
      }).length;
      const banned = (users || []).filter((u) => u.banned).length;
      return json({ ok: true, stats: { total: total || 0, active, banned } });
    }

    if (path === '/admin/users' && req.method === 'GET') {
      if (!(await requireAdmin(req))) return err('Доступ запрещён', 403);
      const q = url.searchParams.get('q')?.trim() || '';
      let query = db.from('profiles').select('*').eq('role', 'user').order('created_at', { ascending: false });
      if (q) {
        query = query.or(`username.ilike.%${q}%,email.ilike.%${q}%`);
      }
      const { data } = await query;
      return json({ ok: true, users: (data || []).map(mapProfile) });
    }

    if (path === '/admin/keys' && req.method === 'GET') {
      if (!(await requireAdmin(req))) return err('Доступ запрещён', 403);
      const { data } = await db.from('activation_keys').select('*').order('created_at', { ascending: false }).limit(200);
      const keys = await Promise.all((data || []).map(async (k) => {
        let usedByName = null;
        if (k.used_by) {
          const { data: u } = await db.from('profiles').select('username').eq('id', k.used_by).single();
          usedByName = u?.username || null;
        }
        return {
          id: k.id,
          planId: k.plan_id,
          label: DURATIONS[k.plan_id]?.label || k.plan_id,
          createdAt: k.created_at,
          usedAt: k.used_at,
          usedBy: usedByName,
          status: k.used_at ? 'used' : 'active',
        };
      }));
      return json({ ok: true, keys });
    }

    if (path === '/admin/keys/generate' && req.method === 'POST') {
      const admin = await requireAdmin(req);
      if (!admin) return err('Доступ запрещён', 403);
      const body = await req.json();
      const planId = body.planId;
      const meta = DURATIONS[planId];
      if (!meta) return err('Неизвестный срок');

      const randomPart = Array.from(crypto.getRandomValues(new Uint8Array(6))).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      const sig = await buildSignature(meta.code, randomPart, hmacSecret);
      const code = `VV-${meta.code}-${randomPart}-${sig}`;
      const codeHash = await hashCode(code);

      await db.from('activation_keys').insert({
        code_hash: codeHash,
        plan_id: planId,
        duration_minutes: meta.minutes,
        created_by: admin.user.id,
      });

      return json({ ok: true, keys: [{ code, planId, label: meta.label }] });
    }

    if (path.startsWith('/admin/users/') && path.endsWith('/revoke-subscription') && req.method === 'POST') {
      if (!(await requireAdmin(req))) return err('Доступ запрещён', 403);
      const id = path.split('/')[3];
      const { data: target } = await db.from('profiles').select('*').eq('id', id).single();
      if (!target) return err('Не найден', 404);
      if (target.role === 'admin') return err('Нельзя изменять администратора', 403);
      await db.from('profiles').update({ subscription_plan: null, subscription_expires: null }).eq('id', id);
      await db.from('mod_sessions').delete().eq('user_id', id);
      const { data: fresh } = await db.from('profiles').select('*').eq('id', id).single();
      return json({ ok: true, user: mapProfile(fresh!) });
    }

    if (path.startsWith('/admin/users/') && path.endsWith('/credentials') && req.method === 'GET') {
      if (!(await requireAdmin(req))) return err('Доступ запрещён', 403);
      const id = path.split('/')[3];
      const { data: row } = await db.from('registration_credentials').select('*').eq('user_id', id).single();
      if (!row) return json({ ok: true, credentials: null, message: 'Данные недоступны' });
      try {
        const password = await decryptPassword(row.password_enc, regSecret);
        return json({ ok: true, credentials: { username: row.username, email: row.email, password, createdAt: row.created_at } });
      } catch {
        return err('Не удалось расшифровать', 500);
      }
    }

    if (path.startsWith('/admin/users/') && req.method === 'PATCH') {
      if (!(await requireAdmin(req))) return err('Доступ запрещён', 403);
      const id = path.split('/')[3];
      const { data: target } = await db.from('profiles').select('*').eq('id', id).single();
      if (!target) return err('Не найден', 404);
      if (target.role === 'admin') return err('Нельзя редактировать администратора', 403);

      const patch = await req.json();
      const update: Record<string, unknown> = {};

      if (typeof patch.banned === 'boolean') {
        update.banned = patch.banned;
        if (patch.banned) await db.from('mod_sessions').delete().eq('user_id', id);
      }
      if (patch.hwid === null || patch.hwid === '') {
        update.hwid = null;
        await db.from('mod_sessions').delete().eq('user_id', id);
      } else if (typeof patch.hwid === 'string') update.hwid = patch.hwid.trim();

      if (patch.subscriptionPlan !== undefined) {
        if (!patch.subscriptionPlan) {
          update.subscription_plan = null;
          update.subscription_expires = null;
        } else {
          update.subscription_plan = patch.subscriptionPlan;
          const user = mapProfile(target);
          if (patch.subscriptionExpires !== undefined) {
            update.subscription_expires = patch.subscriptionExpires;
          } else {
            update.subscription_expires = computeExpiryFromKey(
              patch.subscriptionPlan,
              DURATIONS[patch.subscriptionPlan]?.minutes ?? null,
              user,
            );
          }
        }
      }

      if (Object.keys(update).length) await db.from('profiles').update(update).eq('id', id);
      const { data: fresh } = await db.from('profiles').select('*').eq('id', id).single();
      return json({ ok: true, user: mapProfile(fresh!) });
    }

    if (path.startsWith('/admin/users/') && req.method === 'DELETE') {
      if (!(await requireAdmin(req))) return err('Доступ запрещён', 403);
      const id = path.split('/')[3];
      const { data: target } = await db.from('profiles').select('role').eq('id', id).single();
      if (!target) return err('Не найден', 404);
      if (target.role === 'admin') return err('Нельзя удалить администратора', 403);
      await db.from('mod_sessions').delete().eq('user_id', id);
      await db.auth.admin.deleteUser(id);
      return json({ ok: true });
    }

    return err('Not found: ' + path, 404);
  } catch (e) {
    console.error(e);
    return err('Internal error', 500);
  }
});
