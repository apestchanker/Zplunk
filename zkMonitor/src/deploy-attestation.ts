// =============================================================================
// ZKSplunk zkMonitor — One-Shot Deploy + RegisterOperator Script
// =============================================================================
// Run this ONCE to deploy the zksplunk contract and register this monitor's
// operator commitment.
//
// Usage:
//   npm install && npm run deploy   (or: npx tsx src/deploy-attestation.ts)
//
// Prerequisites:
//   1. Generate a wallet seed and add to .env:
//      node -e "const c=require('node:crypto'); console.log(c.randomBytes(32).toString('hex'))"
//      Then set MIDNIGHT_WALLET_SEED=<hex> in zkMonitor/.env
//   2. Run this script once WITHOUT a funded wallet — it prints the unshielded
//      address. Fund that address on the Midnight preview network.
//   3. Re-run after funding to complete deployment.
//   4. Copy ZKSPLUNK_CONTRACT_ADDRESS from the output into .env
//   5. Set ENABLE_ATTESTATION=true and restart the collector.
//
// What this does:
//   - Deploys the zksplunk contract with initialState(networkId, adminKeyHash, 1n)
//   - Registers this monitor's operator commitment via registerOperator()
//   - Prints the contract address
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { firstValueFrom } from 'rxjs';

import WebSocket from 'ws';
(globalThis as any).WebSocket = WebSocket;

// ---- Midnight SDK ----
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders, WalletProvider, MidnightProvider } from '@midnight-ntwrk/midnight-js-types';

// ---- compact-js ----
import * as CompactContract from '@midnight-ntwrk/compact-js';

// ---- Wallet SDK ----
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { WalletFacade, WalletEntrySchema } from '@midnight-ntwrk/wallet-sdk-facade';
import type { DefaultConfiguration } from '@midnight-ntwrk/wallet-sdk-facade';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  UnshieldedWallet,
  createKeystore,
  PublicKey as UnshieldedPublicKey,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as ledger from '@midnight-ntwrk/ledger-v8';

// ---- Contract ----
import { Contract } from '../../contract/managed/zksplunk/contract/index.js';
import {
  witnesses,
  createZkSplunkPrivateState,
} from '../../contract/src/witnesses.js';
import type { ZkSplunkPrivateState } from '../../contract/src/witnesses.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANAGED_CONTRACT_DIR = resolve(HERE, '../../contract/managed/zksplunk');

type ZkSplunkICK =
  | 'registerOperator'
  | 'attestCriticalIncident'
  | 'getAttestationCount'
  | 'isNullifierSpent';

const PRIVATE_STATE_ID = 'zksplunk-operator-deploy' as const;
type PSI = typeof PRIVATE_STATE_ID;

// ---------------------------------------------------------------------------
// Env loader
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
    } catch { /* file missing is fine */ }
  }
}
hydrateEnv();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^https/, 'wss').replace(/^http/, 'ws').replace(/\/+$/, '') + '/ws';
}

function hexTo32Bytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '').padEnd(64, '0').slice(0, 64);
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute the operator leaf commitment.
 * The Compact circuit computes: persistentHash("zksplunk:op:commit:", secretKey).
 * We approximate with SHA-256 here so the admin can register the correct leaf.
 * Note: if the contract's persistentHash differs, update this accordingly.
 */
function computeOperatorCommitment(secretKey: Uint8Array): Uint8Array {
  const prefix = Buffer.from('zksplunk:op:commit:', 'utf8');
  return new Uint8Array(createHash('sha256').update(prefix).update(secretKey).digest());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const proofServerUrl = process.env.MIDNIGHT_PROOF_SERVER_URL ?? 'http://localhost:6300';
  const indexerHttpUrl = process.env.MIDNIGHT_INDEXER_URL ?? 'http://localhost:8088/api/v4/graphql';
  const indexerWsUrl = deriveWsUrl(indexerHttpUrl);
  const nodeUrl = (process.env.MIDNIGHT_NODE_URL ?? 'ws://localhost:9944')
    .replace(/^http:\/\//, 'ws://')
    .replace(/^https:\/\//, 'wss://')
    .replace(/\/health$/, '');
  const networkId = process.env.MIDNIGHT_NETWORK_ID ?? 'preview';
  const rawSeed = process.env.MIDNIGHT_WALLET_SEED?.trim();

  console.log('=== ZKSplunk Deploy + RegisterOperator ===');
  console.log(`  networkId   : ${networkId}`);
  console.log(`  proofServer : ${proofServerUrl}`);
  console.log(`  indexer     : ${indexerHttpUrl}`);
  console.log(`  relay (ws)  : ${nodeUrl}`);

  if (!rawSeed) {
    console.error(
      '\nMIDNIGHT_WALLET_SEED is not set.\n' +
        'Generate one:\n' +
        "  node -e \"const c=require('node:crypto'); console.log(c.randomBytes(32).toString('hex'))\"\n" +
        'Then set MIDNIGHT_WALLET_SEED=<hex> in .env and fund the printed wallet address.',
    );
    process.exit(1);
  }

  setNetworkId(networkId);

  // ---- Derive keys ----
  const seedBytes = Buffer.from(rawSeed.replace(/^0x/, ''), 'hex');
  const walletResult = HDWallet.fromSeed(seedBytes);
  if (walletResult.type !== 'seedOk') {
    throw new Error(`Invalid MIDNIGHT_WALLET_SEED: ${String(walletResult)}`);
  }

  const derivationResult = walletResult.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust] as const)
    .deriveKeysAt(0);

  walletResult.hdWallet.clear();

  if (derivationResult.type !== 'keysDerived') {
    throw new Error('HD key derivation failed');
  }

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derivationResult.keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(derivationResult.keys[Roles.Dust]);

  const walletConfig: DefaultConfiguration = {
    networkId,
    costParameters: { feeBlocksMargin: 5 },
    relayURL: new URL(nodeUrl),
    provingServerUrl: new URL(proofServerUrl),
    indexerClientConnection: { indexerHttpUrl, indexerWsUrl },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema),
  };

  const unshieldedKeystore = createKeystore(
    derivationResult.keys[Roles.NightExternal],
    walletConfig.networkId,
  );

  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded: (c) => ShieldedWallet(c).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (c) =>
      UnshieldedWallet(c).startWithPublicKey(UnshieldedPublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (c) =>
      DustWallet(c).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });

  await wallet.start(shieldedSecretKeys, dustSecretKey);

  // Read unshielded address for funding instructions
  const unshieldedState = await firstValueFrom(wallet.unshielded.state);
  console.log(`\n  Wallet unshielded address (fund this):\n    ${unshieldedState.address}\n`);

  console.log('Waiting for wallet sync...');
  await wallet.waitForSyncedState();

  const shieldedState = await firstValueFrom(wallet.shielded.state);
  const coinPublicKey = shieldedState.coinPublicKey;
  const encryptionPublicKey = shieldedState.encryptionPublicKey;

  // ---- Providers ----
  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => coinPublicKey as any,
    getEncryptionPublicKey: () => encryptionPublicKey as any,
    balanceTx: async (tx, ttl) => {
      const deadline = ttl ?? new Date(Date.now() + 30 * 60 * 1000);
      const recipe = await wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys, dustSecretKey },
        { ttl: deadline },
      );
      return wallet.finalizeRecipe(recipe);
    },
  };
  const midnightProvider: MidnightProvider = {
    submitTx: (tx) => wallet.submitTransaction(tx) as Promise<any>,
  };
  const zkConfigProvider = new NodeZkConfigProvider<ZkSplunkICK>(MANAGED_CONTRACT_DIR);
  const proofProvider = httpClientProofProvider<ZkSplunkICK>(proofServerUrl, zkConfigProvider);
  const publicDataProvider = indexerPublicDataProvider(indexerHttpUrl, indexerWsUrl);
  const accountId = rawSeed.slice(0, 32);
  const privateStateProvider = levelPrivateStateProvider<PSI, ZkSplunkPrivateState>({
    privateStateStoreName: 'zksplunk-private-state-deploy',
    signingKeyStoreName: 'zksplunk-signing-keys-deploy',
    privateStoragePasswordProvider: () => rawSeed,
    accountId,
  });

  const providers: MidnightProviders<ZkSplunkICK, PSI, ZkSplunkPrivateState> = {
    walletProvider,
    midnightProvider,
    publicDataProvider,
    privateStateProvider,
    zkConfigProvider,
    proofProvider,
  } as unknown as MidnightProviders<ZkSplunkICK, PSI, ZkSplunkPrivateState>;

  // ---- Contract arguments ----
  const operatorSecretKey = hexTo32Bytes(rawSeed);
  const networkIdBytes = new Uint8Array(32);
  const encoded = Buffer.from(networkId, 'utf8');
  networkIdBytes.set(encoded.slice(0, 32));

  const adminKeyHash = computeOperatorCommitment(operatorSecretKey);
  const schemaVersion = 1n;

  console.log(`  networkId bytes : ${bytesToHex(networkIdBytes)}`);
  console.log(`  adminKeyHash    : ${bytesToHex(adminKeyHash)}`);
  console.log(`  schemaVersion   : ${schemaVersion}`);

  // ---- Deploy ----
  console.log('\nDeploying zksplunk contract...');
  const compiled = CompactContract.CompiledContract.make('zksplunk', Contract)
    .pipe(
      CompactContract.CompiledContract.withWitnesses(witnesses as any),
      CompactContract.CompiledContract.withCompiledFileAssets(MANAGED_CONTRACT_DIR),
    );

  const initialPrivateState = createZkSplunkPrivateState(operatorSecretKey);
  await providers.privateStateProvider.set(PRIVATE_STATE_ID, initialPrivateState);

  const deployed = await deployContract(providers as any, {
    compiledContract: compiled as any,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState,
    args: [networkIdBytes, adminKeyHash, schemaVersion],
  });

  const contractAddress = deployed.deployTxData.public.contractAddress;
  console.log(`\n  Contract deployed!`);
  console.log(`  Address   : ${contractAddress}`);
  console.log(`  Block     : ${deployed.deployTxData.public.blockHeight}`);
  console.log(`  TxHash    : ${deployed.deployTxData.public.txHash}`);

  // ---- Register this monitor as an operator ----
  const operatorCommitment = computeOperatorCommitment(operatorSecretKey);
  console.log(`\nRegistering operator: ${bytesToHex(operatorCommitment)}`);
  await deployed.callTx.registerOperator(operatorCommitment);
  console.log('  Operator registered.\n');

  // ---- Output ----
  console.log('=== Done — add to zkMonitor/.env ===\n');
  console.log(`  ZKSPLUNK_CONTRACT_ADDRESS=${contractAddress}`);
  console.log('  ENABLE_ATTESTATION=true\n');
  console.log('Then restart: npm run start\n');

  await wallet.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error('Deploy failed:', err);
  process.exit(1);
});
