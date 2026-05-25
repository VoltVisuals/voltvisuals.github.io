#!/usr/bin/env node
/** Создаёт/обновляет админа Lynivich через Auth Admin API */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const secretsPath = path.join(__dirname, '..', 'supabase', 'secrets.local.env');

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  }
  return env;
}

const env = { ...loadEnv(secretsPath), ...process.env };
const url = env.SUPABASE_URL || 'https://njgdqgrugpvaptfzejdv.supabase.co';
const secret = env.SUPABASE_SECRET_KEY;
if (!secret) {
  console.error('Нет SUPABASE_SECRET_KEY');
  process.exit(1);
}

const headers = {
  apikey: secret,
  Authorization: `Bearer ${secret}`,
  'Content-Type': 'application/json',
  'User-Agent': 'VoltVisuals-Setup/1.0',
};

const adminEmail = 'lynivich@voltvisuals.local';
const adminPassword = 'viva2288';
const adminUsername = 'Lynivich';

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(typeof data === 'object' ? data.message || JSON.stringify(data) : text);
  return data;
}

let user;
const list = await api(`/auth/v1/admin/users?email=${encodeURIComponent(adminEmail)}`);
user = list.users?.[0];

if (!user) {
  user = await api('/auth/v1/admin/users', {
    method: 'POST',
    body: {
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { username: adminUsername, role: 'admin' },
      app_metadata: { role: 'admin' },
    },
  });
  console.log('Created admin user', user.id);
} else {
  user = await api(`/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    body: {
      password: adminPassword,
      user_metadata: { username: adminUsername, role: 'admin' },
      app_metadata: { role: 'admin' },
    },
  });
  console.log('Updated admin user', user.id);
}

await api(`/rest/v1/profiles?id=eq.${user.id}`, {
  method: 'PATCH',
  body: { role: 'admin', username: adminUsername },
});

console.log('Admin ready:', adminUsername, '/', adminPassword);
