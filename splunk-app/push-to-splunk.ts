/**
 * Push all ZKSplunk app views + nav to Splunk via REST, then reload the app.
 *
 * Usage:
 *   cd splunk-app
 *   npx tsx push-to-splunk.ts
 *
 * Reads auth from ai-agent/.env (SPLUNK_REST_URL + SPLUNK_REST_TOKEN).
 * Falls back to SPLUNK_USERNAME + SPLUNK_PASSWORD if no token.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const ROOT = resolve(HERE, '..');

// Load env from ai-agent/.env
function loadEnv(file: string) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim();
    }
  } catch { /* ignore */ }
}
loadEnv(join(ROOT, 'ai-agent', '.env'));
loadEnv(join(ROOT, 'zkMonitor', '.env'));

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // self-signed cert on :8089

const BASE  = (process.env.SPLUNK_REST_URL || 'https://10.0.0.10:8089').replace(/\/$/, '');
const TOKEN = process.env.SPLUNK_REST_TOKEN;
const USER  = process.env.SPLUNK_USERNAME  || 'admin';
const PASS  = process.env.SPLUNK_PASSWORD  || '';
const APP   = 'zksplunk';

let sessionKey = '';

async function authHeader(): Promise<Record<string, string>> {
  if (TOKEN) return { Authorization: `Bearer ${TOKEN}` };
  if (!sessionKey) {
    const res = await fetch(`${BASE}/services/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: USER, password: PASS, output_mode: 'json' }),
    });
    const j = (await res.json()) as { sessionKey?: string };
    sessionKey = j.sessionKey ?? '';
    if (!sessionKey) throw new Error('Login failed — set SPLUNK_REST_TOKEN or SPLUNK_USERNAME/PASSWORD');
  }
  return { Authorization: `Splunk ${sessionKey}` };
}

async function upsertView(viewName: string, xml: string): Promise<string> {
  const ns = `${BASE}/servicesNS/nobody/${APP}/data/ui/views`;
  const headers = await authHeader();

  // Try updating first (it may already exist)
  const updateRes = await fetch(`${ns}/${viewName}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ 'eai:data': xml }),
  });
  if (updateRes.ok || updateRes.status === 200) return `updated (${updateRes.status})`;

  // If not found, create it
  if (updateRes.status === 404 || updateRes.status === 409) {
    const createRes = await fetch(ns, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: viewName, 'eai:data': xml }),
    });
    if (createRes.ok) return `created (${createRes.status})`;
    const body = await createRes.text();
    throw new Error(`Create failed: HTTP ${createRes.status}: ${body.slice(0, 200)}`);
  }

  const body = await updateRes.text();
  throw new Error(`Update failed: HTTP ${updateRes.status}: ${body.slice(0, 200)}`);
}

async function pushNav(xml: string): Promise<string> {
  const url = `${BASE}/servicesNS/nobody/${APP}/data/ui/nav/default`;
  const headers = await authHeader();
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ 'eai:data': xml }),
  });
  if (res.ok) return `ok (${res.status})`;
  const body = await res.text();
  throw new Error(`Nav push failed: HTTP ${res.status}: ${body.slice(0, 300)}`);
}

async function reloadApp(): Promise<string> {
  const url = `${BASE}/services/apps/local/${APP}/_reload`;
  const headers = await authHeader();
  const res = await fetch(url, { method: 'POST', headers });
  return res.ok ? `ok (${res.status})` : `HTTP ${res.status}`;
}

async function main() {
  const viewsDir = join(HERE, APP, 'default', 'data', 'ui', 'views');
  const navFile  = join(HERE, APP, 'default', 'data', 'ui', 'nav', 'default.xml');

  const viewFiles = readdirSync(viewsDir).filter(f => f.endsWith('.xml'));

  console.log(`Pushing ZKSplunk app to ${BASE}\n`);

  for (const file of viewFiles) {
    const viewName = basename(file, '.xml');
    const xml = readFileSync(join(viewsDir, file), 'utf8');
    try {
      const result = await upsertView(viewName, xml);
      console.log(`  view  ${viewName.padEnd(40)} ${result}`);
    } catch (e) {
      console.error(`  view  ${viewName.padEnd(40)} ERROR: ${(e as Error).message}`);
    }
  }

  try {
    const navXml = readFileSync(navFile, 'utf8');
    const result = await pushNav(navXml);
    console.log(`  nav   default${' '.repeat(34)} ${result}`);
  } catch (e) {
    console.error(`  nav   default${' '.repeat(34)} ERROR: ${(e as Error).message}`);
  }

  console.log('\nReloading app...');
  const reload = await reloadApp();
  console.log(`  reload                                   ${reload}`);

  console.log('\nDone. Refresh ZKSplunk in Splunk to see the updated tabs.\n');
}

main().catch(e => { console.error('Push failed:', e.message); process.exit(1); });
