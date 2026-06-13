// =============================================================================
// ZKSplunk demoLand — Orchestrator
// =============================================================================
// Drives the FULL ZKSplunk pipeline with zero live infrastructure:
//
//   MockVitalsProvider  →  vitals-adapter (REAL)  →  LocalHecSink (console+jsonl)
//                              │
//                              └─ zkZap detector → telemetry-commitment (REAL)
//                                                → MockAttestationClient (REAL iface)
//
// Everything except the *source* (mock vitals) and the *sink* (local file) is
// the same code zkMonitor uses. Run with:  npm run demo
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MockVitalsProvider } from '../../vitals/mock-vitals-provider.ts';
import type { VitalId, ContractInfo } from '../../vitals/types.ts';
import {
  vitalCheckToSplunkEvent,
  attestationConfirmedToSplunkEvent,
  chainBlockToSplunkEvent,
  connectorStatusToSplunkEvent,
  contractMonitorabilityToSplunkEvent,
  walletBoundaryToSplunkEvent,
} from '../../connector/src/vitals-adapter.ts';
import { buildSnapshot, commitSnapshot } from '../../connector/src/telemetry-commitment.ts';
import { MockAttestationClient } from '../../connector/src/attestation-client.ts';
import type { SplunkHecEvent } from '../../connector/src/hec-client.ts';

import { LocalHecSink } from './local-hec-sink.ts';
import { ZkZapDetector } from './zkzap-detector.ts';
import { ATTACK_SCENARIOS } from './attack-scenarios.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Tiny .env loader (no dependency) — reads .env.demoland KEY=VALUE lines.
// ---------------------------------------------------------------------------
function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  try {
    const raw = readFileSync(resolve(HERE, '..', '.env.demoland'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (env[key] === undefined) env[key] = trimmed.slice(eq + 1).trim();
    }
  } catch {
    /* template missing is fine — fall back to defaults */
  }
  return env;
}

const env = loadEnv();
const DAPP_NAME = env.ZKSPLUNK_DAPP_NAME || 'BlindOracle';
const ENVIRONMENT = env.ZKSPLUNK_ENVIRONMENT || 'demoland';
const OUT_FILE = resolve(HERE, '..', env.ZKSPLUNK_DEMO_OUT || 'out/events.jsonl');
const BASELINE_CYCLES = parseInt(env.ZKSPLUNK_DEMO_BASELINE_CYCLES || '3', 10);
const ATTACKS_ONLY = process.argv.includes('--attacks-only');

const META = { dappName: DAPP_NAME, environment: ENVIRONMENT };
const SAMPLE_CONTRACTS: ContractInfo[] = [
  { id: 'zksplunk-attest', name: 'ZKSplunk Attestation', address: '0200abc…' },
  { id: 'blindoracle-round', name: 'BlindOracle Round', address: '0200def…' },
];

function rule(title: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n\x1b[1m── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}\x1b[0m`);
}

// ---------------------------------------------------------------------------
// Baseline: a few cycles of normal monitoring (mostly healthy).
// ---------------------------------------------------------------------------
async function runBaseline(provider: MockVitalsProvider, sink: LocalHecSink): Promise<void> {
  rule(`Baseline monitoring — ${BASELINE_CYCLES} cycles (mock vitals → Splunk event shape)`);
  for (let cycle = 0; cycle < BASELINE_CYCLES; cycle += 1) {
    const proof = await provider.checkProofServer();
    const network = await provider.checkNetwork();
    const wallet = await provider.checkWallet();
    const contracts = await provider.checkContracts(SAMPLE_CONTRACTS);
    const node = {
      status: network.status,
      message: network.status === 'healthy' ? 'Midnight node RPC is reachable.' : network.message,
      detailLine: network.detailLine,
      responseTimeMs: network.responseTimeMs,
      endpoint: 'mock://midnight-node/rpc',
      probeName: 'node_rpc_health',
    } as const;
    const blockHeight = 127_400 + cycle;
    const chain = {
      ...network,
      message: `Latest Midnight block is ${blockHeight}.`,
      detailLine: `height=${blockHeight}`,
      responseTimeMs: network.responseTimeMs,
      blockHeight,
      blockHash: `demo-block-${blockHeight}`,
      blockTimestamp: Math.floor(Date.now() / 1000),
      blockAgeSeconds: 4 + cycle,
      endpoint: 'mock://midnight-indexer/graphql',
      probeName: 'indexer_latest_block',
      extra: {
        protocol_version: 'demo-preview',
      },
    };
    const walletBoundary = {
      ...wallet,
      endpoint: 'mock://wallet/public-boundary',
      probeName: 'wallet_public_boundary',
      extra: {
        wallet_network: 'preview',
        wallet_address: 'demo.wallet',
        unshielded_tx_count: 2 + cycle,
        unshielded_created_utxos: 1,
        unshielded_spent_utxos: 0,
        unshielded_token_types: 1,
        unshielded_primary_balance: 42_000,
        indexer_highest_tx_id: `demo-tx-${cycle}`,
        wallet_balance_shielded_private: true,
      },
    };
    const contractMonitorability = {
      ...contracts,
      endpoint: 'mock://midnight-indexer/contracts',
      probeName: 'contract_monitorability',
      extra: {
        contracts_configured: SAMPLE_CONTRACTS.length,
        contracts_monitorable: SAMPLE_CONTRACTS.length,
      },
    };
    const events = [
      vitalCheckToSplunkEvent('proof-server', proof, META),
      vitalCheckToSplunkEvent('network', network, META),
      vitalCheckToSplunkEvent('node', node, META),
      walletBoundaryToSplunkEvent(walletBoundary, META),
      contractMonitorabilityToSplunkEvent(contractMonitorability, META),
      chainBlockToSplunkEvent(chain, META),
      connectorStatusToSplunkEvent({
        totalEventsSent: (cycle + 1) * 6,
        totalEventsFailed: 0,
        totalBatchesSent: cycle + 1,
        averageLatencyMs: 35 + cycle * 4,
        queuedEvents: 0,
        schedulerActive: true,
        failedEventsSinceLastHeartbeat: 0,
      }, META),
    ];
    sink.send(events);
  }
}

// ---------------------------------------------------------------------------
// Attacks: replay each scenario through the zkZap detect → commit → attest loop.
// ---------------------------------------------------------------------------
async function runAttacks(sink: LocalHecSink): Promise<number> {
  const detector = new ZkZapDetector(2);
  const attestor = new MockAttestationClient({ latencyRangeMs: [50, 150] });
  let incidentsOpened = 0;

  for (const scenario of ATTACK_SCENARIOS) {
    detector.reset();
    rule(`zkZap scenario: ${scenario.threatLabel}  (vital: ${scenario.vitalId})`);
    // eslint-disable-next-line no-console
    console.log(`\x1b[2m   ${scenario.description}\n   observable: ${scenario.observable}\x1b[0m`);

    for (const result of scenario.readings) {
      // 1) Every reading still becomes a normal vitals event (what Splunk sees).
      sink.send([vitalCheckToSplunkEvent(scenario.vitalId, result, META)]);

      // 2) zkZap evaluates the reading.
      const incident = detector.observe(scenario.vitalId, result, scenario.threatLabel);
      if (!incident) continue;

      incidentsOpened += 1;

      // 3) Build a canonical telemetry snapshot and commit it (REAL crypto).
      const snapshot = buildSnapshot(scenario.vitalId, 'preview', null, {
        threat: incident.threatLabel,
        severity: incident.severity,
        consecutive: incident.consecutiveCount,
        lastMessage: result.message,
      });
      const commitmentHex = commitSnapshot(snapshot);

      // 4) Anchor the commitment on-chain (mock backend in demoLand).
      const attestation = await attestor.attest(commitmentHex);

      // 5) Emit the zkZap incident event + the attestation-confirmed event.
      sink.send([incidentEvent(incident, commitmentHex)]);
      sink.send([attestationConfirmedToSplunkEvent(scenario.vitalId, attestation, {
        ...META,
        network: 'preview',
        contractAddress: SAMPLE_CONTRACTS[0].address,
      })]);
    }
  }
  return incidentsOpened;
}

/** Build a zkZap incident HEC event (no adapter fn for this yet — inline). */
function incidentEvent(
  incident: ReturnType<ZkZapDetector['observe']> & object,
  commitmentHex: string,
): SplunkHecEvent {
  return {
    time: Date.now() / 1000,
    event: {
      type: 'zkzap.incident.opened',
      severity: incident.severity === 'critical' || incident.severity === 'outage' ? 'critical' : 'warn',
      component: incident.vitalId === 'network' ? 'indexer' : incident.vitalId,
      incident_id: incident.incidentId,
      threat: incident.threatLabel,
      vital_id: incident.vitalId,
      consecutive_checks: incident.consecutiveCount,
      message: incident.message,
      attestation_commitment: commitmentHex,
      attestation_status: 'pending',
      dapp_name: META.dappName,
      environment: META.environment,
    },
    fields: {
      component: incident.vitalId === 'network' ? 'indexer' : incident.vitalId,
      vital_id: incident.vitalId,
      threat: incident.threatLabel,
      severity: incident.severity,
      attestation_commitment: commitmentHex,
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(
    `\x1b[1m\nZKSplunk demoLand\x1b[0m  ` +
      `\x1b[2m(dapp=${DAPP_NAME}, env=${ENVIRONMENT}, sink=${OUT_FILE})\x1b[0m`,
  );

  const sink = new LocalHecSink(OUT_FILE);

  if (!ATTACKS_ONLY) {
    const provider = new MockVitalsProvider();
    provider.setWalletConnected(true, 'demo.wallet');
    await runBaseline(provider, sink);
  }

  const incidents = await runAttacks(sink);

  rule('Summary');
  // eslint-disable-next-line no-console
  console.log(
    `   events emitted : ${sink.totalSent}\n` +
      `   zkZap incidents: ${incidents}\n` +
      `   written to     : ${OUT_FILE}\n` +
      `\x1b[2m   (each incident carries a real telemetry commitment, mock-attested on-chain)\x1b[0m`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('demoLand run failed:', err);
  process.exit(1);
});
