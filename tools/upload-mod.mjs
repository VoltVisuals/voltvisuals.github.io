#!/usr/bin/env node
/** Загружает voltvisuals-*.jar в Supabase Storage */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

const siteRoot = fs.existsSync(path.join(__dirname, '..', 'supabase'))
  ? path.join(__dirname, '..')
  : path.join(root, 'Сайт VoltVisuals');

const env = {
  ...loadEnv(path.join(siteRoot, 'supabase', 'secrets.local.env')),
  ...process.env,
};

const secret = env.SUPABASE_SECRET_KEY;
const url = env.SUPABASE_URL || 'https://njgdqgrugpvaptfzejdv.supabase.co';
const jarName = env.MOD_JAR_NAME || 'voltvisuals-1.6.1.jar';

function storageHeaders(contentType = 'application/octet-stream') {
  const h = {
    apikey: secret,
    'Content-Type': contentType,
    'User-Agent': 'VoltVisuals-Setup/1.0',
  };
  // sb_secret_* keys: only apikey header (Bearer breaks Storage API)
  if (!secret?.startsWith('sb_secret_')) {
    h.Authorization = `Bearer ${secret}`;
  }
  return h;
}

const candidates = [
  path.join(root, 'VoltVisuals', 'build', 'libs', jarName),
  path.join(siteRoot, 'server', 'files', jarName),
  process.argv[2],
].filter(Boolean);

const jarPath = candidates.find((p) => fs.existsSync(p));
if (!jarPath) {
  console.error('JAR не найден. Сначала соберите мод: cd VoltVisuals && gradlew build');
  console.error('Искали:', candidates.join(', '));
  process.exit(1);
}

const bucketRes = await fetch(`${url}/storage/v1/bucket`, {
  method: 'POST',
  headers: storageHeaders('application/json'),
  body: JSON.stringify({ id: 'mod-releases', name: 'mod-releases', public: true }),
});
if (!bucketRes.ok && bucketRes.status !== 409) {
  console.warn('Bucket warn:', await bucketRes.text());
}

await fetch(`${url}/storage/v1/bucket/mod-releases`, {
  method: 'PUT',
  headers: storageHeaders('application/json'),
  body: JSON.stringify({ public: true }),
}).catch(() => {});

const body = fs.readFileSync(jarPath);
const upload = await fetch(`${url}/storage/v1/object/mod-releases/${jarName}`, {
  method: 'POST',
  headers: { ...storageHeaders(), 'x-upsert': 'true' },
  body,
});

if (!upload.ok) {
  console.error('Upload failed:', upload.status, await upload.text());
  process.exit(1);
}

console.log(`Uploaded ${jarName} (${body.length} bytes) from ${jarPath}`);
