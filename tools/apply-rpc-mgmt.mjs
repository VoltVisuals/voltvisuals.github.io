#!/usr/bin/env node
/** Применяет supabase/rpc.sql через Supabase Management API */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const secretsPath = path.join(root, 'supabase', 'secrets.local.env');
const sqlPath = path.join(root, 'supabase', 'rpc.sql');
const ref = 'njgdqgrugpvaptfzejdv';

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
const token = env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('Нужен SUPABASE_ACCESS_TOKEN в secrets.local.env');
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, 'utf8');
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});

const text = await res.text();
if (!res.ok) {
  console.error('SQL failed:', res.status, text);
  process.exit(1);
}
console.log('rpc.sql applied via Management API');
