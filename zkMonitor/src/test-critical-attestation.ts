// =============================================================================
// ZKSplunk — Synthetic Critical Attestation Smoke Test
// =============================================================================
// Generates one critical incident through the real Midnight attestation client:
// local proof server -> relayer -> Midnight chain. This is intentionally not a
// fake HEC event; use it to prove the attestation pipeline end-to-end.
// =============================================================================

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MidnightJsAttestationClient } from './midnight-attestation-client.ts';
import type { IncidentClassName, SeverityName } from '../../connector/src/attestation-client.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

function hydrateEnv(): void {
  for (const file of ['.env', '.env.zkmonitor']) {
    try {
      const raw = readFileSync(resolve(HERE, '..', file), 'utf8');
      for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq === -1) continue;
        const key = t.slice(0, eq).trim();
        if (process.env[key] === undefined) process.env[key] = t.slice(eq + 1).trim();
      }
    } catch {
      /* file missing is fine */
    }
  }
}

function incidentClassFromEnv(): IncidentClassName {
  const value = process.env.ZKSPLUNK_TEST_INCIDENT_CLASS || 'block-stall';
  switch (value) {
    case 'proof-server-outage':
    case 'auth-bruteforce-burst':
    case 'mint-anomaly':
    case 'block-stall':
    case 'wallet-drain':
      return value;
    default:
      throw new Error(`Unsupported ZKSPLUNK_TEST_INCIDENT_CLASS=${value}`);
  }
}

function severityFromEnv(): SeverityName {
  const value = process.env.ZKSPLUNK_TEST_SEVERITY || 'critical';
  switch (value) {
    case 'info':
    case 'warning':
    case 'degraded':
    case 'critical':
    case 'outage':
      return value;
    default:
      throw new Error(`Unsupported ZKSPLUNK_TEST_SEVERITY=${value}`);
  }
}

async function main(): Promise<void> {
  hydrateEnv();
  if (process.env.ZKSPLUNK_TEST_USE_DEPLOYER_OPERATOR === 'true') {
    const deployerSeed = process.env.MIDNIGHT_WALLET_SEED?.trim().replace(/[^0-9a-fA-F]/g, '');
    if (!deployerSeed) {
      throw new Error('ZKSPLUNK_TEST_USE_DEPLOYER_OPERATOR=true requires MIDNIGHT_WALLET_SEED');
    }
    process.env.OPERATOR_ZSWAP_SEED = deployerSeed;
  }

  const incidentClass = incidentClassFromEnv();
  const severity = severityFromEnv();
  const snapshot = {
    kind: 'synthetic-critical-attestation-test',
    component: process.env.ZKSPLUNK_TEST_COMPONENT || 'synthetic',
    status: severity,
    incidentClass,
    createdAt: new Date().toISOString(),
    nonce: randomUUID(),
  };
  const payloadCommitmentHex = createHash('sha256')
    .update(JSON.stringify(snapshot))
    .digest('hex');

  console.log('[synthetic] submitting critical attestation');
  console.log(`[synthetic] incidentClass=${incidentClass} severity=${severity}`);
  console.log(`[synthetic] commitment=${payloadCommitmentHex}`);

  const client = new MidnightJsAttestationClient();
  try {
    const result = await client.attestCriticalIncident({
      incidentClass,
      severity,
      payloadCommitmentHex,
    });
    console.log('[synthetic] submitted');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.shutdown().catch(() => {
      /* best-effort */
    });
  }
}

main().catch((err) => {
  console.error('[synthetic] failed:', err instanceof Error ? err.stack || err.message : err);
  console.dir(err, { depth: 8 });
  process.exit(1);
});
