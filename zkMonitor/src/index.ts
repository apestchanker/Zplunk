// =============================================================================
// ZKSplunk zkMonitor — Live Orchestrator
// =============================================================================
// Wires the REAL connector to LIVE infrastructure:
//
//   HttpVitalsProvider (live HTTP) → SplunkForwarder (REAL) → Splunk Cloud HEC
//                                          │
//                                          └─ optional on-chain attestation
//
// Same SplunkForwarder + adapter + commitment code as demoLand — only the
// source (live HTTP) and sink (real HEC) differ.
//
// Usage:
//   cp .env.zkmonitor .env   # then fill in SPLUNK_HEC_TOKEN etc.
//   npm install && npm run start
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfigFromEnvironment } from '../../connector/src/config.ts';
import { SplunkForwarder } from '../../connector/src/splunk-forwarder.ts';
import { MockAttestationClient } from '../../connector/src/attestation-client.ts';
import type { AttestationClient } from '../../connector/src/attestation-client.ts';
import type { ContractInfo } from '../../vitals/types.ts';

import { HttpVitalsProvider } from './http-vitals-provider.ts';
import { MidnightJsAttestationClient } from './midnight-attestation-client.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Load .env (then .env.zkmonitor as fallback) into process.env, no dependency.
// ---------------------------------------------------------------------------
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

hydrateEnv();

const config = loadConfigFromEnvironment();
const DAPP_NAME = process.env.ZKSPLUNK_DAPP_NAME || 'unknown-dapp';
const ENVIRONMENT = process.env.ZKSPLUNK_ENVIRONMENT || 'zkmonitor';

const CONTRACTS: ContractInfo[] = process.env.ZKSPLUNK_CONTRACT_ADDRESS
  ? [{ id: 'zksplunk-attest', name: 'ZKSplunk Attestation', address: process.env.ZKSPLUNK_CONTRACT_ADDRESS }]
  : [];

// A wallet address to observe without private keys. Unshielded activity is
// public and can be monitored via the indexer subscription; shielded balances
// remain private and ZKSplunk deliberately never asks for a viewing key.
const WALLET_ADDRESS = process.env.MIDNIGHT_WALLET_ADDRESS || '';
const WALLET_NETWORK = process.env.MIDNIGHT_WALLET_NETWORK
  || (WALLET_ADDRESS.includes('_preview') ? 'preview'
    : WALLET_ADDRESS.includes('_test') ? 'testnet'
    : WALLET_ADDRESS ? 'unknown' : '');

/**
 * Build the attestation client (relayer model).
 *
 * When ENABLE_ATTESTATION=true AND all three of:
 *   OPERATOR_ZSWAP_SEED          — unfunded Zswap keypair (no NIGHT/DUST)
 *   ATTESTATION_RELAYER_URL      — URL of the running attestation-relayer service
 *   ZKSPLUNK_CONTRACT_ADDRESS    — deployed contract address
 * ...are set, returns a real MidnightJsAttestationClient that proves locally
 * and POSTs to the relayer. Otherwise falls back to MockAttestationClient.
 *
 * The operator side holds ONLY an unfunded Zswap keypair. It never holds or
 * spends NIGHT/DUST. Fee payment is handled entirely by the relayer's SYSTEM
 * wallet (RELAYER_WALLET_SEED), keeping the fee-payer unlinkable from the
 * operator's identity.
 *
 * Note: MIDNIGHT_WALLET_SEED is no longer used by the operator/collector.
 */
function buildAttestationClient(): { client: AttestationClient; isMock: boolean } {
  const enableAttestation = process.env.ENABLE_ATTESTATION === 'true';
  const hasOperatorSeed = !!(process.env.OPERATOR_ZSWAP_SEED?.trim());
  const hasRelayerUrl = !!(process.env.ATTESTATION_RELAYER_URL?.trim());
  const hasAddress = !!(process.env.ZKSPLUNK_CONTRACT_ADDRESS?.trim());

  if (enableAttestation && hasOperatorSeed && hasRelayerUrl && hasAddress) {
    return {
      client: new MidnightJsAttestationClient(),
      isMock: false,
    };
  }

  if (enableAttestation && (!hasOperatorSeed || !hasRelayerUrl || !hasAddress)) {
    // eslint-disable-next-line no-console
    console.warn(
      '[zkMonitor] ENABLE_ATTESTATION=true but missing: ' +
        (!hasOperatorSeed ? 'OPERATOR_ZSWAP_SEED ' : '') +
        (!hasRelayerUrl ? 'ATTESTATION_RELAYER_URL ' : '') +
        (!hasAddress ? 'ZKSPLUNK_CONTRACT_ADDRESS' : '') +
        '— falling back to MockAttestationClient. ' +
        'Ensure the relayer is deployed and all three vars are set.',
    );
  }

  return {
    client: new MockAttestationClient({ latencyRangeMs: [200, 800] }),
    isMock: true,
  };
}

async function main(): Promise<void> {
  const { client: attestationClient, isMock } = buildAttestationClient();

  // eslint-disable-next-line no-console
  console.log(
    `ZKSplunk zkMonitor starting\n` +
      `  dapp        : ${DAPP_NAME}\n` +
      `  HEC         : ${config.splunkHecUrl} (index=${config.splunkIndex})\n` +
      `  proofServer : ${config.midnightProofServerUrl}\n` +
      `  indexer     : ${config.midnightIndexerUrl}\n` +
      `  attestation : ${isMock ? 'mock (path-exercised)' : 'on-chain (midnight-js)'}`,
  );

  const provider = new HttpVitalsProvider({
    proofServerUrl: config.midnightProofServerUrl,
    indexerUrl: config.midnightIndexerUrl,
    nodeUrl: config.midnightNodeUrl,
    proofServerHealthPath: config.proofServerHealthPath,
    proofServerVersionPath: config.proofServerVersionPath,
  });

  const forwarder = new SplunkForwarder(config, {
    dappName: DAPP_NAME,
    environment: ENVIRONMENT,
    networkId: process.env.MIDNIGHT_NETWORK_ID || 'undeployed',
    attestationClient,
    onStateChange: (state) => {
      // eslint-disable-next-line no-console
      console.log(`[forwarder] ${state.status}${state.errorMessage ? ' — ' + state.errorMessage : ''}`);
    },
  });

  const connected = await forwarder.connect();
  if (!connected) {
    // eslint-disable-next-line no-console
    console.error(
      'Could not connect to Splunk HEC. Check SPLUNK_HEC_URL / SPLUNK_HEC_TOKEN in .env. ' +
        'Polling will still run and log locally (enable ENABLE_LOCAL_JSONL_SINK to capture output).',
    );
  }

  // Generic scheduler: fire `run` immediately, then on `everyMs`.
  const intervals: Array<ReturnType<typeof setInterval>> = [];
  const every = (label: string, everyMs: number, run: () => Promise<void>) => {
    const tick = async () => {
      try {
        await run();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[${label}] failed:`, (err as Error).message);
      }
    };
    void tick();
    intervals.push(setInterval(tick, everyMs));
  };

  // 1. Proof server reachability        → midnight.vital.check
  every('proof-server', config.pollIntervalProofServer, async () =>
    forwarder.handleVitalCheck('proof-server', await provider.checkProofServer()),
  );
  // 2. Indexer GraphQL reachability      → midnight.vital.check
  every('indexer', config.pollIntervalIndexer, async () =>
    forwarder.handleVitalCheck('indexer', await provider.checkIndexer()),
  );
  // 3. Indexer latest block / cadence    → midnight.chain.block_latest
  every('chain', config.pollIntervalChain, async () =>
    forwarder.handleChainBlock(await provider.checkLatestBlock()),
  );
  // 4. Node health                       → midnight.vital.check
  every('node', config.pollIntervalNode, async () =>
    forwarder.handleVitalCheck('node', await provider.checkNode()),
  );
  // 5. Proof server version              → midnight.component.version
  every('proof-version', config.pollIntervalVersion, async () =>
    forwarder.handleVersion('proof-server', await provider.checkProofServerVersion()),
  );
  // 6. Contract monitorability           → midnight.contract.monitorability
  every('contracts', config.pollIntervalContracts, async () =>
    forwarder.handleContractMonitorability(await provider.checkContractMonitorability(CONTRACTS)),
  );
  // 7. Wallet boundary                   → midnight.wallet.boundary
  // With an address: observe PUBLIC unshielded activity/balance over the
  // indexer WS (no viewing key). Without one: honest headless `unknown`.
  every('wallet', config.pollIntervalWallet, async () => {
    if (WALLET_ADDRESS) {
      const r = await provider.checkWalletUnshielded(WALLET_ADDRESS);
      r.extra = { ...r.extra, wallet_network: WALLET_NETWORK };
      forwarder.handleWalletBoundary(r);
    } else {
      forwarder.handleWalletBoundary(await provider.checkWallet());
    }
  });

  // eslint-disable-next-line no-console
  console.log('Polling live vitals. Press Ctrl-C to stop.');

  const shutdown = async () => {
    // eslint-disable-next-line no-console
    console.log('\nShutting down — flushing remaining events…');
    forwarder.setSchedulerActive(false);
    for (const i of intervals) clearInterval(i);
    await forwarder.shutdown();
    // Gracefully close the Midnight wallet WebSocket connections if the real
    // client was initialized (MidnightJsAttestationClient exposes shutdown()).
    if (attestationClient instanceof MidnightJsAttestationClient) {
      await attestationClient.shutdown().catch(() => { /* best-effort */ });
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('zkMonitor failed to start:', err);
  process.exit(1);
});
