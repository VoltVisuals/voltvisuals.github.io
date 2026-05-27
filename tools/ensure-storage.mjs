#!/usr/bin/env node
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
const headers = {
  apikey: secret,
  Authorization: `Bearer ${secret}`,
  'Content-Type': 'application/json',
  'User-Agent': 'VoltVisuals-Setup/1.0',
};

const res = await fetch(`${url}/storage/v1/bucket`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ id: 'mod-releases', name: 'mod-releases', public: true }),
});
if (res.ok || res.status === 409) {
  console.log('Bucket mod-releases OK');
} else {
  console.error('Bucket error:', await res.text());
  process.exit(1);
}
