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
//   - Deploys the zksplunk contract with initialState(networkId, schemaVersion)
//   - Registers the deployer/admin as the first operator inside the constructor
//   - Prints the contract address
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstValueFrom, filter } from 'rxjs';

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
import { ShieldedCoinPublicKey, ShieldedEncryptionPublicKey } from '@midnight-ntwrk/wallet-sdk-address-format';
import * as ledger from '@midnight-ntwrk/ledger-v8';

// ---- Contract ----
import { Contract } from '../../contract/managed/zksplunk/contract/index.js';
import {
  witnesses,
  createZkSplunkPrivateState,
} from '../../contract/src/witnesses.js';
import type { ZkSplunkPrivateState } from '../../contract/src/witnesses.js';
import { balanceAndFinalizeUnboundTransactionNormalized } from './normalized-transaction.ts';

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
  // Strip trailing non-hex chars (e.g. zsh "%" no-newline indicator)
  const rawSeed = process.env.MIDNIGHT_WALLET_SEED?.trim().replace(/[^0-9a-fA-F]/g, '');

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

  // Print address using the keystore (already derived above, no network needed)
  const walletAddress = unshieldedKeystore.getBech32Address().toString();
  console.log(`\n  Wallet unshielded address (fund this):\n    ${walletAddress}\n`);

  console.log('Waiting for wallet sync...');
  const syncedState = await wallet.waitForSyncedState();

  // Guard: must have funded NIGHT coins before we can do anything
  const nightCoins = syncedState.unshielded.availableCoins;
  if (nightCoins.length === 0) {
    console.error(
      '\nNo NIGHT coins found. Fund this address first:\n' +
      `  ${walletAddress}\n\n` +
      'Get NIGHT at: https://faucet.preview.midnight.network/\n' +
      'Then wait ~2 minutes and run npm run deploy again.\n',
    );
    await wallet.stop();
    process.exit(1);
  }

  // Register NIGHT UTXOs for DUST generation if not already done.
  // This is required before any ZK transaction — DUST pays the fees.
  // The registration tx itself does NOT need existing DUST to pay for it.
  if (syncedState.dust.availableCoins.length === 0) {
    console.log('\nNo DUST available. Registering NIGHT UTXOs for DUST generation...');
    const { fee } = await wallet.estimateRegistration(nightCoins);
    console.log(`  Estimated registration fee: ${fee} (DUST units)`);

    const regRecipe = await wallet.registerNightUtxosForDustGeneration(
      nightCoins,
      unshieldedKeystore.getPublicKey(),
      (payload) => unshieldedKeystore.signData(payload),
    );
    const regFinalized = await wallet.finalizeRecipe(regRecipe);
    await wallet.submitTransaction(regFinalized);

    console.log('  Registration tx submitted. Waiting for DUST coins to appear...');
    await firstValueFrom(
      wallet.state().pipe(
        filter((s) => s.isSynced && s.dust.availableCoins.length > 0),
      ),
    );
    console.log('  DUST coins received. Proceeding with deployment.\n');
  }

  const shieldedState = await firstValueFrom(wallet.shielded.state);
  // WalletProvider.getCoinPublicKey() must return a bech32 string.
  // The SDK calls parseCoinPublicKeyToHex() on it internally — if given an object
  // bech32.decode crashes with "string expected". Encode via the static codec.
  const coinPublicKeyBech32 = ShieldedCoinPublicKey.codec.encode(networkId as any, shieldedState.coinPublicKey).toString();
  const encPublicKeyBech32  = ShieldedEncryptionPublicKey.codec.encode(networkId as any, shieldedState.encryptionPublicKey).toString();

  // ---- Providers ----
  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => coinPublicKeyBech32 as any,
    getEncryptionPublicKey: () => encPublicKeyBech32 as any,
    balanceTx: async (tx, ttl) => {
      const deadline = ttl ?? new Date(Date.now() + 30 * 60 * 1000);
      // `tx` is UnboundTransaction (proven, PreBinding).
      // Circuit calls need fee first, then contract sections; otherwise the
      // preview node rejects the transaction as Custom(117) / NotNormalized.
      return balanceAndFinalizeUnboundTransactionNormalized(
        wallet,
        tx,
        { shieldedSecretKeys, dustSecretKey },
        { ttl: deadline },
      );
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
    privateStoragePasswordProvider: () => 'Zk!' + rawSeed,
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
  // The admin secret key is provided via the localSecretKey() witness — the
  // constructor computes adminPublicKeyHash = persistentHash("zksplunk:admin:pk:", sk)
  // inside the ZK circuit. TypeScript does NOT need to compute this hash.
  const operatorSecretKey = hexTo32Bytes(rawSeed);
  const networkIdBytes = new Uint8Array(32);
  const encoded = Buffer.from(networkId, 'utf8');
  networkIdBytes.set(encoded.slice(0, 32));
  const schemaVersion = 1n;

  console.log(`  networkId bytes : ${bytesToHex(networkIdBytes)}`);
  console.log(`  schemaVersion   : ${schemaVersion}`);

  // ---- Deploy ----
  console.log('\nDeploying zksplunk contract...');
  const compiled = CompactContract.CompiledContract.make('zksplunk', Contract)
    .pipe(
      CompactContract.CompiledContract.withWitnesses(witnesses as any),
      CompactContract.CompiledContract.withCompiledFileAssets(MANAGED_CONTRACT_DIR),
    );

  const initialPrivateState = createZkSplunkPrivateState(operatorSecretKey);

  const deployed = await deployContract(providers as any, {
    compiledContract: compiled as any,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState,
    args: [networkIdBytes, schemaVersion],
  });

  const contractAddress = deployed.deployTxData.public.contractAddress;
  console.log(`\n  Contract deployed!`);
  console.log(`  Address   : ${contractAddress}`);
  console.log(`  Block     : ${deployed.deployTxData.public.blockHeight}`);
  console.log(`  TxHash    : ${deployed.deployTxData.public.txHash}`);

  console.log('  Initial operator registered in constructor.\n');

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
