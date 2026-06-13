// =============================================================================
// ZKSplunk zkMonitor — Operator-Side Attestation Client (Relayer Model)
// =============================================================================
// This module runs on the OPERATOR (collector) side. Its only job is:
//
//   1. Derive an UNFUNDED Zswap keypair from OPERATOR_ZSWAP_SEED.
//      This keypair holds NO NIGHT/DUST and will never need funding.
//      It is needed purely so createUnprovenCallTx can encrypt coin outputs.
//
//   2. Build the UnprovenTransaction for attestCriticalIncident.
//
//   3. Prove it locally via the proof server (ZK proof is generated;
//      the operator's secretKey is consumed inside the proof and never
//      leaves the operator's process).
//
//   4. Serialize the resulting UnboundTransaction and POST it to the
//      ATTESTATION_RELAYER_URL. The relayer holds the funded SYSTEM wallet
//      and handles balancing + fee payment + submission.
//
// Env vars required on the OPERATOR (all three must be set + ENABLE_ATTESTATION=true):
//   ENABLE_ATTESTATION          — must be 'true'
//   OPERATOR_ZSWAP_SEED         — 64-char hex (32-byte seed, UNFUNDED, no DUST)
//   ATTESTATION_RELAYER_URL     — http(s)://host:port of the relayer service
//   ZKSPLUNK_CONTRACT_ADDRESS   — deployed contract address (hex)
//   MIDNIGHT_PROOF_SERVER_URL   — http(s)://host:port of the proof server
//   MIDNIGHT_INDEXER_URL        — https://…/api/v4/graphql
//   MIDNIGHT_NODE_URL           — ws(s)://host:port
//   MIDNIGHT_NETWORK_ID         — 'preview' | 'undeployed'
//
// Privacy model:
//   - Operator secretKey (for ZK Merkle membership witness) lives only in
//     the operator's LevelDB private state and in this process's memory.
//     It is consumed at prove time and is NOT present in the serialized
//     UnboundTransaction sent to the relayer.
//   - On-chain: public sees the SYSTEM wallet paid fees.
//     The operator's Zswap coinPublicKey MAY appear if the circuit creates
//     shielded outputs — but it is derived from OPERATOR_ZSWAP_SEED which
//     is separate from the operator identity. Use a fresh seed per operator.
//   - The relayer HTTP endpoint is the off-chain de-anonymization risk.
//     Rate-limiting / mTLS / VPN should be layered on the relayer side.
//
// NOTE: MIDNIGHT_WALLET_SEED is no longer used by this module.
//   The operator holds only OPERATOR_ZSWAP_SEED (unfunded Zswap keypair).
//   The relayer holds RELAYER_WALLET_SEED (funded, NIGHT→DUST).
// =============================================================================

import WebSocket from 'ws';
// Node.js environments need a WebSocket global for the wallet/indexer SDKs.
(globalThis as any).WebSocket = WebSocket;

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstValueFrom } from 'rxjs';

// ---- Midnight SDK ----
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { createUnprovenCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders, WalletProvider } from '@midnight-ntwrk/midnight-js-types';

// ---- compact-js — for building a CompiledContract ----
import * as CompactContract from '@midnight-ntwrk/compact-js';

// ---- Wallet SDK — key derivation only (no balance/DUST used here) ----
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { WalletFacade, WalletEntrySchema } from '@midnight-ntwrk/wallet-sdk-facade';
import type { DefaultConfiguration } from '@midnight-ntwrk/wallet-sdk-facade';
import {
  UnshieldedWallet,
  createKeystore,
  PublicKey as UnshieldedPublicKey,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as ledger from '@midnight-ntwrk/ledger-v8';

// ---- Contract compiled output ----
import { Contract, IncidentClass, Severity } from '../../contract/managed/zksplunk/contract/index.js';
import {
  witnesses,
  createZkSplunkPrivateState,
} from '../../contract/src/witnesses.js';
import type { ZkSplunkPrivateState } from '../../contract/src/witnesses.js';

// ---- Connector types (dependency-free) ----
import type {
  AttestationClient,
  AttestationResult,
  CriticalIncident,
  IncidentClassName,
  SeverityName,
} from '../../connector/src/attestation-client.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const MANAGED_CONTRACT_DIR = resolve(HERE, '../../contract/managed/zksplunk');
const PRIVATE_STATE_ID = 'zksplunk-operator' as const;
type PSI = typeof PRIVATE_STATE_ID;

type ZkSplunkICK =
  | 'registerOperator'
  | 'attestCriticalIncident'
  | 'getAttestationCount'
  | 'isNullifierSpent';

// ---------------------------------------------------------------------------
// Enum mapping helpers
// ---------------------------------------------------------------------------

function mapIncidentClass(name: IncidentClassName): IncidentClass {
  switch (name) {
    case 'proof-server-outage':   return IncidentClass.proofServerOutage;
    case 'auth-bruteforce-burst': return IncidentClass.authBruteforceBurst;
    case 'mint-anomaly':          return IncidentClass.mintAnomaly;
    case 'block-stall':           return IncidentClass.blockStall;
    case 'wallet-drain':          return IncidentClass.walletDrain;
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown incident class: ${String(_exhaustive)}`);
    }
  }
}

function mapSeverity(name: SeverityName): Severity {
  switch (name) {
    case 'info':     return Severity.info;
    case 'warning':  return Severity.warning;
    case 'degraded': return Severity.degraded;
    case 'critical': return Severity.critical;
    case 'outage':   return Severity.outage;
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown severity: ${String(_exhaustive)}`);
    }
  }
}

function hexTo32Bytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '').padEnd(64, '0').slice(0, 64);
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function currentEpochHour(): bigint {
  return BigInt(Math.floor(Date.now() / 3_600_000));
}

function deriveWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^https/, 'wss').replace(/^http/, 'ws').replace(/\/+$/, '') + '/ws';
}

// ---------------------------------------------------------------------------
// Derive UNFUNDED Zswap keypair
// ---------------------------------------------------------------------------
// This gives us getCoinPublicKey() and getEncryptionPublicKey() — the only
// wallet functions needed during createUnprovenCallTx. This wallet has NO
// NIGHT UTXOs and generates NO DUST. It must never be registered for dust
// generation or funded.
// ---------------------------------------------------------------------------

async function deriveOperatorZswapKeys(
  seedHex: string,
  walletConfig: DefaultConfiguration,
): Promise<{
  walletProvider: WalletProvider;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  stop: () => Promise<void>;
}> {
  const seedBytes = Buffer.from(seedHex.replace(/^0x/, ''), 'hex');
  const walletResult = HDWallet.fromSeed(seedBytes);
  if (walletResult.type !== 'seedOk') {
    throw new Error(`Invalid OPERATOR_ZSWAP_SEED: ${String(walletResult)}`);
  }

  const derivationResult = walletResult.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust] as const)
    .deriveKeysAt(0);

  walletResult.hdWallet.clear();

  if (derivationResult.type !== 'keysDerived') {
    throw new Error('HD key derivation failed for OPERATOR_ZSWAP_SEED: keyOutOfBounds');
  }

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derivationResult.keys[Roles.Zswap]);
  // dustSecretKey derived but never used for fee payment — operator has no DUST.
  // We derive it so WalletFacade.init doesn't fail on missing role.
  const dustSecretKey = ledger.DustSecretKey.fromSeed(derivationResult.keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(
    derivationResult.keys[Roles.NightExternal],
    walletConfig.networkId,
  );

  // Build a WalletFacade so we can read the stable coinPublicKey / encryptionPublicKey
  // from the shielded wallet state observable. These are purely derived from the seed
  // and do not require any on-chain state.
  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded: (c) => ShieldedWallet(c).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (c) =>
      UnshieldedWallet(c).startWithPublicKey(UnshieldedPublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (c) =>
      DustWallet(c).startWithSecretKey(
        dustSecretKey,
        ledger.LedgerParameters.initialParameters().dust,
      ),
  });

  await wallet.start(shieldedSecretKeys, dustSecretKey);

  // Read coinPublicKey / encryptionPublicKey once and cache them synchronously.
  // These values are stable (derived from seed) and do not change.
  const shieldedState = await firstValueFrom(wallet.shielded.state);
  const coinPublicKey = shieldedState.coinPublicKey;
  const encryptionPublicKey = shieldedState.encryptionPublicKey;

  // Minimal WalletProvider: only getCoinPublicKey + getEncryptionPublicKey are
  // ever called by createUnprovenCallTx. balanceTx must NOT be called by this
  // module — balancing is the relayer's responsibility.
  const walletProvider: WalletProvider = {
    getCoinPublicKey: () =>
      coinPublicKey as unknown as ReturnType<WalletProvider['getCoinPublicKey']>,
    getEncryptionPublicKey: () =>
      encryptionPublicKey as unknown as ReturnType<WalletProvider['getEncryptionPublicKey']>,
    balanceTx: (_tx, _ttl) => {
      // Should never be called on the operator side.
      return Promise.reject(
        new Error(
          '[MidnightJsAttestationClient] balanceTx must not be called on the operator side. ' +
            'The relayer handles fee payment and balancing.',
        ),
      );
    },
  };

  return {
    walletProvider,
    shieldedSecretKeys,
    stop: async () => { await wallet.stop(); },
  };
}

// ---------------------------------------------------------------------------
// Build CompiledContract
// ---------------------------------------------------------------------------

function buildCompiledContract() {
  return CompactContract.CompiledContract.make('zksplunk', Contract)
    .pipe(
      CompactContract.CompiledContract.withWitnesses(witnesses as any),
      CompactContract.CompiledContract.withCompiledFileAssets(MANAGED_CONTRACT_DIR),
    );
}

// ---------------------------------------------------------------------------
// MidnightJsAttestationClient
// ---------------------------------------------------------------------------

export class MidnightJsAttestationClient implements AttestationClient {
  readonly backendName: string;

  private initPromise: Promise<void> | null = null;
  private providers: MidnightProviders<ZkSplunkICK, PSI, ZkSplunkPrivateState> | null = null;
  private walletStop: (() => Promise<void>) | null = null;
  private initError: Error | null = null;

  // Cached after init — used to build callTxOptions per attestation.
  private compiledContract: ReturnType<typeof buildCompiledContract> | null = null;

  private readonly proofServerUrl: string;
  private readonly indexerHttpUrl: string;
  private readonly indexerWsUrl: string;
  private readonly nodeUrl: string;
  private readonly operatorZswapSeed: string | null;
  private readonly relayerUrl: string | null;
  private readonly contractAddress: string | null;
  private readonly networkId: string;

  constructor() {
    this.proofServerUrl = process.env.MIDNIGHT_PROOF_SERVER_URL ?? 'http://localhost:6300';
    this.indexerHttpUrl = process.env.MIDNIGHT_INDEXER_URL ?? 'http://localhost:8088/api/v4/graphql';
    this.indexerWsUrl = deriveWsUrl(this.indexerHttpUrl);
    this.nodeUrl = (process.env.MIDNIGHT_NODE_URL ?? 'ws://localhost:9944')
      .replace(/^http:\/\//, 'ws://')
      .replace(/^https:\/\//, 'wss://')
      .replace(/\/health$/, '');
    this.operatorZswapSeed = process.env.OPERATOR_ZSWAP_SEED?.trim() || null;
    this.relayerUrl = process.env.ATTESTATION_RELAYER_URL?.trim().replace(/\/+$/, '') || null;
    this.contractAddress = process.env.ZKSPLUNK_CONTRACT_ADDRESS?.trim() || null;
    this.networkId = process.env.MIDNIGHT_NETWORK_ID ?? 'preview';
    this.backendName = `midnight-js-relayer@${this.networkId}`;
  }

  // -------------------------------------------------------------------------
  // Lazy initialization
  // -------------------------------------------------------------------------

  private async init(): Promise<void> {
    if (this.initError) throw this.initError;
    if (!this.initPromise) {
      this.initPromise = this._doInit().catch((err: unknown) => {
        const e = err instanceof Error ? err : new Error(String(err));
        this.initError = e;
        this.initPromise = null;
        throw e;
      });
    }
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    if (!this.operatorZswapSeed) {
      throw new Error(
        'OPERATOR_ZSWAP_SEED is not set. ' +
          'Provide a 64-char hex seed for the operator\'s unfunded Zswap keypair. ' +
          'This wallet holds NO NIGHT/DUST — it is used only for ZK proof generation.',
      );
    }
    if (!this.relayerUrl) {
      throw new Error(
        'ATTESTATION_RELAYER_URL is not set. ' +
          'Point this at the attestation-relayer service (attestation-relayer.ts). ' +
          'The relayer holds the funded SYSTEM wallet and submits the tx on-chain.',
      );
    }
    if (!this.contractAddress) {
      throw new Error(
        'ZKSPLUNK_CONTRACT_ADDRESS is not set. ' +
          'Run src/deploy-attestation.ts to deploy the contract, ' +
          'then set ZKSPLUNK_CONTRACT_ADDRESS in .env.',
      );
    }

    setNetworkId(this.networkId);

    const walletConfig: DefaultConfiguration = {
      networkId: this.networkId,
      costParameters: { feeBlocksMargin: 5 },
      relayURL: new URL(this.nodeUrl),
      provingServerUrl: new URL(this.proofServerUrl),
      indexerClientConnection: {
        indexerHttpUrl: this.indexerHttpUrl,
        indexerWsUrl: this.indexerWsUrl,
      },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema),
    };

    const zkConfigProvider = new NodeZkConfigProvider<ZkSplunkICK>(MANAGED_CONTRACT_DIR);
    const proofProvider = httpClientProofProvider<ZkSplunkICK>(this.proofServerUrl, zkConfigProvider);
    const publicDataProvider = indexerPublicDataProvider(this.indexerHttpUrl, this.indexerWsUrl);

    // accountId scopes the LevelDB database to this operator.
    // Use the first 32 chars of the seed hex as a stable, non-secret ID.
    const accountId = this.operatorZswapSeed.slice(0, 32);
    const privateStateProvider = levelPrivateStateProvider<PSI, ZkSplunkPrivateState>({
      privateStateStoreName: 'zksplunk-private-state',
      signingKeyStoreName: 'zksplunk-signing-keys',
      privateStoragePasswordProvider: () => this.operatorZswapSeed!,
      accountId,
    });

    const { walletProvider, stop } = await deriveOperatorZswapKeys(
      this.operatorZswapSeed,
      walletConfig,
    );
    this.walletStop = stop;

    // Seed the operator's private state from the Zswap seed bytes (used as secretKey
    // for the ZK Merkle membership proof inside the circuit).
    const operatorSecretKey = hexTo32Bytes(this.operatorZswapSeed);
    const existingState = await privateStateProvider.get(PRIVATE_STATE_ID);
    if (!existingState) {
      await privateStateProvider.set(
        PRIVATE_STATE_ID,
        createZkSplunkPrivateState(operatorSecretKey),
      );
    }

    // Note: midnightProvider is not used on the operator side — the relayer submits.
    // We provide a stub so MidnightProviders type is satisfied.
    const midnightProviderStub = {
      submitTx: (_tx: unknown) => Promise.reject(
        new Error('[MidnightJsAttestationClient] submitTx must not be called on the operator side.'),
      ),
    };

    this.providers = {
      walletProvider,
      midnightProvider: midnightProviderStub as any,
      publicDataProvider,
      privateStateProvider,
      zkConfigProvider,
      proofProvider,
    } as unknown as MidnightProviders<ZkSplunkICK, PSI, ZkSplunkPrivateState>;

    this.compiledContract = buildCompiledContract();
  }

  // -------------------------------------------------------------------------
  // isReady
  // -------------------------------------------------------------------------

  async isReady(): Promise<boolean> {
    if (!this.operatorZswapSeed || !this.contractAddress || !this.relayerUrl) return false;
    if (process.env.ENABLE_ATTESTATION !== 'true') return false;

    // Check proof server reachability.
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3_000);
      const res = await fetch(`${this.proofServerUrl}/health`, {
        signal: controller.signal,
      })
        .catch(() => fetch(`${this.proofServerUrl}/version`, { signal: controller.signal }))
        .catch(() => null)
        .finally(() => clearTimeout(timer));
      if (!res?.ok) return false;
    } catch {
      return false;
    }

    return true;
  }

  // -------------------------------------------------------------------------
  // attestCriticalIncident
  //
  // OPERATOR SIDE FLOW:
  //   1. Build the UnprovenTransaction (createUnprovenCallTx) — this calls
  //      walletProvider.getCoinPublicKey() / getEncryptionPublicKey() but
  //      does NOT call balanceTx.
  //   2. Prove it via proofProvider.proveTx() — sends the circuit to the
  //      proof server, gets back an UnboundTransaction (proven, unbalanced).
  //      The operator secretKey is consumed inside the ZK proof here and is
  //      NOT present in the resulting serialized bytes.
  //   3. Serialize: unboundTx.serialize() → Uint8Array → base64 string.
  //   4. POST to relayer. Relayer returns { txHash, blockHeight }.
  // -------------------------------------------------------------------------

  async attestCriticalIncident(input: CriticalIncident): Promise<AttestationResult> {
    const start = Date.now();
    await this.init();

    const incidentClass = mapIncidentClass(input.incidentClass);
    const severity = mapSeverity(input.severity);
    const epoch = input.epoch ?? currentEpochHour();
    const scopeTag = input.scopeTagHex ? hexTo32Bytes(input.scopeTagHex) : new Uint8Array(32);
    const payloadCommitment = hexTo32Bytes(input.payloadCommitmentHex);

    const providers = this.providers!;
    const compiledContract = this.compiledContract!;

    // Step 1: Build the unproven call transaction (no balancing, no DUST).
    const callTxData = await createUnprovenCallTx(
      {
        zkConfigProvider: providers.zkConfigProvider,
        publicDataProvider: providers.publicDataProvider,
        walletProvider: providers.walletProvider,
        privateStateProvider: providers.privateStateProvider,
      },
      {
        compiledContract: compiledContract as any,
        circuitId: 'attestCriticalIncident',
        contractAddress: this.contractAddress!,
        privateStateId: PRIVATE_STATE_ID,
        args: [incidentClass, severity, epoch, scopeTag, payloadCommitment] as any,
      },
    );

    const unprovenTx = callTxData.private.unprovenTx;

    // Step 2: Prove the transaction via the proof server.
    // The operator's secretKey (used in the ZK witness) is consumed here.
    // The resulting UnboundTransaction contains only the opaque ZK proof —
    // no witness data, no secret key material leaks into the serialized bytes.
    const unboundTx = await providers.proofProvider.proveTx(unprovenTx);

    // Step 3: Serialize the proven-but-unbalanced transaction.
    // Transaction<SignatureEnabled, Proof, PreBinding>.serialize() → Uint8Array
    const serializedBytes = unboundTx.serialize();
    const serializedBase64 = Buffer.from(serializedBytes).toString('base64');

    // Step 4: POST to the relayer. The relayer adds DUST fees and submits.
    const relayerResponse = await fetch(`${this.relayerUrl!}/attest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provenTxBase64: serializedBase64,
        // Include metadata for the relayer's off-chain rate-limit / audit log.
        // IMPORTANT: this metadata is NOT included in the on-chain proof.
        // It is only visible to the relayer (off-chain). The on-chain record
        // is fully anonymous — public sees only the SYSTEM wallet's fee payment.
        meta: {
          incidentClass: input.incidentClass,
          severity: input.severity,
          epoch: epoch.toString(),
        },
      }),
    });

    if (!relayerResponse.ok) {
      const body = await relayerResponse.text().catch(() => '(no body)');
      throw new Error(
        `Attestation relayer rejected request: HTTP ${relayerResponse.status} — ${body}`,
      );
    }

    const result = (await relayerResponse.json()) as {
      txHash: string;
      blockHeight: number | null;
    };

    return {
      commitmentHex: input.payloadCommitmentHex,
      txHash: result.txHash,
      sequence: null,
      blockHeight: result.blockHeight ?? null,
      latencyMs: Date.now() - start,
      wasSubmitted: true,
    };
  }

  /** @deprecated Use attestCriticalIncident instead. */
  async attest(_commitmentHex: string): Promise<AttestationResult> {
    return {
      commitmentHex: _commitmentHex,
      txHash: '0'.repeat(64),
      sequence: null,
      blockHeight: null,
      latencyMs: 0,
      wasSubmitted: false,
      skipReason: 'disabled',
    };
  }

  async shutdown(): Promise<void> {
    if (this.walletStop) {
      await this.walletStop();
      this.walletStop = null;
    }
    this.providers = null;
    this.compiledContract = null;
    this.initPromise = null;
    this.initError = null;
  }
}
