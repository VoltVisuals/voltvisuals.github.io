#!/usr/bin/env node
/** Применяет supabase/rpc.sql через прямое подключение к Postgres */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const secretsPath = path.join(root, 'supabase', 'secrets.local.env');
const sqlPath = path.join(root, 'supabase', 'rpc.sql');

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
const ref = 'njgdqgrugpvaptfzejdv';
const password = env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error('Добавьте SUPABASE_DB_PASSWORD в supabase/secrets.local.env');
  console.error('Dashboard → Project Settings → Database → Database password');
  process.exit(1);
}

const connectionString =
  env.SUPABASE_DB_URL ||
  `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-1-eu-central-1.pooler.supabase.com:6543/postgres`;

const sql = fs.readFileSync(sqlPath, 'utf8');
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);
  console.log('rpc.sql applied OK');
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
} finally {
  await client.end();
}
