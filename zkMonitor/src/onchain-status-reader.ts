// =============================================================================
// ZKSplunk — On-Chain Status Reader
// =============================================================================
// A polling service that reads the deployed zksplunk contract's PUBLIC ledger
// state via the indexer and emits Splunk telemetry.
//
// READ-ONLY: no wallet, no proof server, no private state required.
// Only needs: MIDNIGHT_INDEXER_URL + ZKSPLUNK_CONTRACT_ADDRESS.
//
// Events emitted:
//   zksplunk.onchain.status   — every poll: deployment/counts summary
//   zksplunk.onchain.incident — per new incident-log entry (high-water seq)
//
// Env vars:
//   ZKSPLUNK_CONTRACT_ADDRESS   — deployed contract address (optional; emits
//                                 deployed=false if missing/empty)
//   MIDNIGHT_INDEXER_URL        — https://…/api/v4/graphql
//   MIDNIGHT_NETWORK_ID         — 'preview' | 'undeployed' (default: preview)
//   ONCHAIN_POLL_INTERVAL_MS    — poll cadence (default: 60000)
//   SPLUNK_HEC_URL / SPLUNK_HEC_TOKEN / SPLUNK_INDEX — HEC config (no-op if
//   missing; useful for local dev — events still print to stdout)
//
// Usage:
//   npm run onchain-status
// =============================================================================

import WebSocket from 'ws';
(globalThis as any).WebSocket = WebSocket;

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import type { PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';

// Verified: ContractState.data is ChargedState; ledger(ChargedState) → Ledger.
// See contract/managed/zksplunk/contract/index.d.ts line 124.
import { ledger, IncidentClass, Severity } from '../../contract/managed/zksplunk/contract/index.js';
import type { Ledger, IncidentRecord } from '../../contract/managed/zksplunk/contract/index.js';

import { loadConfigFromEnvironment } from '../../connector/src/config.ts';
import { SplunkHecClient } from '../../connector/src/hec-client.ts';
import type { SplunkHecEvent } from '../../connector/src/hec-client.ts';

// ---------------------------------------------------------------------------
// .env loader (identical pattern to index.ts and attestation-relayer.ts)
// ---------------------------------------------------------------------------

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
    } catch { /* file missing is ok */ }
  }
}

hydrateEnv();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONTRACT_ADDRESS = process.env.ZKSPLUNK_CONTRACT_ADDRESS?.trim() || '';
const INDEXER_HTTP_URL = process.env.MIDNIGHT_INDEXER_URL ?? 'http://localhost:8088/api/v4/graphql';
const MIDNIGHT_NETWORK_ID = process.env.MIDNIGHT_NETWORK_ID ?? 'preview';
const POLL_INTERVAL_MS = parseInt(process.env.ONCHAIN_POLL_INTERVAL_MS ?? '60000', 10);

// Derive WebSocket URL from HTTP URL — same pattern as midnight-attestation-client.ts.
// indexerPublicDataProvider signature (verified from dist/index.d.ts line 374):
//   indexerPublicDataProvider(queryURL: string, subscriptionURL: string, webSocketImpl?) → PublicDataProvider
function deriveWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^https/, 'wss').replace(/^http/, 'ws').replace(/\/+$/, '') + '/ws';
}

const INDEXER_WS_URL = deriveWsUrl(INDEXER_HTTP_URL);

// ---------------------------------------------------------------------------
// Splunk HEC (no-op if token not configured)
// ---------------------------------------------------------------------------

const hecConfig = loadConfigFromEnvironment();
const hec: SplunkHecClient | null =
  hecConfig.splunkHecUrl && hecConfig.splunkHecToken
    ? new SplunkHecClient(hecConfig)
    : null;

const ONCHAIN_SOURCETYPE = 'zksplunk:onchain';
const ONCHAIN_SOURCE = 'zksplunk-onchain';

function emitEvent(eventName: string, data: Record<string, unknown>): void {
  const payload: SplunkHecEvent = {
    sourcetype: ONCHAIN_SOURCETYPE,
    source: ONCHAIN_SOURCE,
    index: hecConfig.splunkIndex,
    event: { event: eventName, ...data },
  };

  if (hec) {
    hec.enqueue(payload);
  }

  // Always print to stdout so the service is useful even without Splunk.
  // eslint-disable-next-line no-console
  console.log(`[onchain] ${eventName}`, JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Enum → string name mapping
// Verified against contract/managed/zksplunk/contract/index.d.ts:
//   IncidentClass { proofServerOutage=0, authBruteforceBurst=1, mintAnomaly=2,
//                   blockStall=3, walletDrain=4 }
//   Severity      { info=0, warning=1, degraded=2, critical=3, outage=4 }
// ---------------------------------------------------------------------------

const INCIDENT_CLASS_NAMES: Record<number, string> = {
  [IncidentClass.proofServerOutage]:    'proof-server-outage',
  [IncidentClass.authBruteforceBurst]:  'auth-bruteforce-burst',
  [IncidentClass.mintAnomaly]:          'mint-anomaly',
  [IncidentClass.blockStall]:           'block-stall',
  [IncidentClass.walletDrain]:          'wallet-drain',
};

const SEVERITY_NAMES: Record<number, string> = {
  [Severity.info]:     'info',
  [Severity.warning]:  'warning',
  [Severity.degraded]: 'degraded',
  [Severity.critical]: 'critical',
  [Severity.outage]:   'outage',
};

function incidentClassName(cls: IncidentClass): string {
  return INCIDENT_CLASS_NAMES[cls as number] ?? `unknown(${cls})`;
}

function severityName(sev: Severity): string {
  return SEVERITY_NAMES[sev as number] ?? `unknown(${sev})`;
}

// ---------------------------------------------------------------------------
// Uint8Array → hex string
// ---------------------------------------------------------------------------

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

// ---------------------------------------------------------------------------
// High-water mark: tracks the highest seq (bigint) we have already emitted
// for zksplunk.onchain.incident. Persisted in memory; resets on process restart.
// On restart we re-emit incidents seen since process start (acceptable — Splunk
// deduplication can be configured by seq if needed).
// ---------------------------------------------------------------------------

let highWaterSeq: bigint = -1n;

// ---------------------------------------------------------------------------
// Core poll
// ---------------------------------------------------------------------------

async function poll(publicDataProvider: PublicDataProvider): Promise<void> {
  const pollStart = Date.now();

  // If no contract address is configured, emit a "not deployed" status and return.
  if (!CONTRACT_ADDRESS) {
    emitEvent('zksplunk.onchain.status', {
      deployed: false,
      contract_address: '',
      network_id: MIDNIGHT_NETWORK_ID,
      read_latency_ms: Date.now() - pollStart,
    });
    return;
  }

  // Query the latest on-chain contract state.
  // Verified API: publicDataProvider.queryContractState(address, config?) → Promise<ContractState | null>
  // No config arg → returns latest block state.
  const contractState = await publicDataProvider.queryContractState(CONTRACT_ADDRESS);

  const readLatencyMs = Date.now() - pollStart;

  if (contractState === null) {
    // Contract address set but not found on-chain yet (not deployed, or indexer lag).
    emitEvent('zksplunk.onchain.status', {
      deployed: false,
      contract_address: CONTRACT_ADDRESS,
      network_id: MIDNIGHT_NETWORK_ID,
      read_latency_ms: readLatencyMs,
    });
    return;
  }

  // Decode the public ledger state.
  // Verified: ContractState.data is ChargedState (onchain-runtime-v3.d.ts line 801).
  // Verified: ledger(ChargedState) → Ledger (index.d.ts line 124).
  const state: Ledger = ledger(contractState.data);

  // Extract scalar counts, converting BigInt → Number for Splunk JSON compat.
  // Verified Ledger fields (index.d.ts lines 79–106):
  //   operators.firstFree() → bigint  (number of registered operators)
  //   spentNullifiers.size() → bigint
  //   attestationCount → bigint       (readonly)
  //   incidentLog.size() → bigint
  const operatorsRegistered = Number(state.operators.firstFree());
  const nullifiersSpent     = Number(state.spentNullifiers.size());
  const attestationCount    = Number(state.attestationCount);
  const incidentLogSize     = Number(state.incidentLog.size());

  // Emit the aggregate status event.
  emitEvent('zksplunk.onchain.status', {
    deployed: true,
    contract_address: CONTRACT_ADDRESS,
    network_id: MIDNIGHT_NETWORK_ID,
    attestation_count: attestationCount,
    operators_registered: operatorsRegistered,
    nullifiers_spent: nullifiersSpent,
    incident_log_size: incidentLogSize,
    read_latency_ms: readLatencyMs,
  });

  // Emit one event per NEW incident-log entry since last high-water seq.
  // Verified iteration: incidentLog[Symbol.iterator]() → Iterator<[bigint, IncidentRecord]>
  // (index.d.ts line 104: [Symbol.iterator](): Iterator<[bigint, IncidentRecord]>)
  // Verified IncidentRecord fields (index.d.ts lines 17–22):
  //   incidentClass: IncidentClass, severity: Severity,
  //   epoch: bigint, payloadCommitment: Uint8Array, nullifier: Uint8Array
  for (const [seq, record] of state.incidentLog) {
    if (seq > highWaterSeq) {
      emitEvent('zksplunk.onchain.incident', {
        seq: Number(seq),
        incident_class: incidentClassName(record.incidentClass),
        severity: severityName(record.severity),
        epoch: Number(record.epoch),
        payload_commitment: toHex(record.payloadCommitment),
        nullifier: toHex(record.nullifier),
        contract_address: CONTRACT_ADDRESS,
        network_id: MIDNIGHT_NETWORK_ID,
      });
    }
  }

  // Advance the high-water mark to the current log size (seq is 0-based;
  // last valid seq = size - 1).
  if (incidentLogSize > 0) {
    const newHighWater = BigInt(incidentLogSize) - 1n;
    if (newHighWater > highWaterSeq) {
      highWaterSeq = newHighWater;
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  setNetworkId(MIDNIGHT_NETWORK_ID);

  // Build the read-only public data provider.
  // No wallet, no proof server, no private state needed.
  // Third arg (webSocketImpl) is required in Node.js — pass the ws constructor.
  // Verified: indexerPublicDataProvider(queryURL, subscriptionURL, webSocketImpl?)
  // (dist/index.d.ts line 374)
  const publicDataProvider: PublicDataProvider = indexerPublicDataProvider(
    INDEXER_HTTP_URL,
    INDEXER_WS_URL,
    WebSocket as any,
  );

  // eslint-disable-next-line no-console
  console.log(
    `[onchain] ZKSplunk on-chain status reader starting\n` +
      `  network      : ${MIDNIGHT_NETWORK_ID}\n` +
      `  indexer      : ${INDEXER_HTTP_URL}\n` +
      `  contract     : ${CONTRACT_ADDRESS || '(not set — will emit deployed=false)'}\n` +
      `  poll interval: ${POLL_INTERVAL_MS}ms\n` +
      `  HEC          : ${hec ? hecConfig.splunkHecUrl : 'disabled (no token)'}`,
  );

  let running = true;

  const runPoll = async () => {
    try {
      await poll(publicDataProvider);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[onchain] poll error:', (err as Error).message);
      // Do not crash — emit a status event indicating read failure.
      emitEvent('zksplunk.onchain.status', {
        deployed: false,
        contract_address: CONTRACT_ADDRESS,
        network_id: MIDNIGHT_NETWORK_ID,
        read_error: (err as Error).message,
        read_latency_ms: 0,
      });
    }
  };

  // Fire immediately, then on interval.
  await runPoll();
  const timer = setInterval(() => {
    if (running) void runPoll();
  }, POLL_INTERVAL_MS);

  const shutdown = async () => {
    running = false;
    clearInterval(timer);
    // eslint-disable-next-line no-console
    console.log('\n[onchain] Shutting down…');
    if (hec) await hec.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[onchain] Fatal error:', err);
  process.exit(1);
});
