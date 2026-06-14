// =============================================================================
// ZKSplunk — Relayer Wallet Funding / DUST Registration Helper
// =============================================================================
// Prints the relayer SYSTEM wallet address, asks the operator to fund it with
// NIGHT, and registers any available NIGHT UTXOs for DUST generation.
//
// Safe to rerun:
//   - no NIGHT: prints address + faucet instructions and exits
//   - NIGHT but no DUST: registers for DUST generation and waits
//   - DUST present: exits successfully
// =============================================================================

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstValueFrom, filter, timeout } from 'rxjs';

import WebSocket from 'ws';
(globalThis as any).WebSocket = WebSocket;

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { WalletFacade, WalletEntrySchema } from '@midnight-ntwrk/wallet-sdk-facade';
import type { DefaultConfiguration } from '@midnight-ntwrk/wallet-sdk-facade';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  UnshieldedWallet,
  createKeystore,
  PublicKey as UnshieldedPublicKey,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as ledger from '@midnight-ntwrk/ledger-v8';

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

function deriveWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^https/, 'wss').replace(/^http/, 'ws').replace(/\/+$/, '') + '/ws';
}

function cleanSeed(value: string | undefined): string {
  return value?.trim().replace(/[^0-9a-fA-F]/g, '') || '';
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  hydrateEnv();

  const relayerSeed = cleanSeed(
    process.env.ZKSPLUNK_RELAYER_USE_DEPLOYER_WALLET === 'true'
      ? process.env.MIDNIGHT_WALLET_SEED
      : process.env.RELAYER_WALLET_SEED,
  );
  const networkId = process.env.MIDNIGHT_NETWORK_ID ?? 'preview';
  const proofServerUrl = process.env.MIDNIGHT_PROOF_SERVER_URL ?? 'http://localhost:6300';
  const indexerHttpUrl = process.env.MIDNIGHT_INDEXER_URL ?? 'http://localhost:8088/api/v4/graphql';
  const indexerWsUrl = deriveWsUrl(indexerHttpUrl);
  const syncTimeoutMs = parseInt(process.env.RELAYER_FUND_SYNC_TIMEOUT_MS ?? '', 10) || 300_000;
  const nodeUrl = (process.env.MIDNIGHT_NODE_URL ?? 'ws://localhost:9944')
    .replace(/^http:\/\//, 'ws://')
    .replace(/^https:\/\//, 'wss://')
    .replace(/\/health$/, '');

  console.log('=== ZKSplunk Relayer Wallet Funding ===');
  console.log(`  networkId   : ${networkId}`);
  console.log(`  indexer     : ${indexerHttpUrl}`);
  console.log(`  relay (ws)  : ${nodeUrl}`);

  if (!relayerSeed) {
    console.error(
      '\nRELAYER_WALLET_SEED is not set.\n\n' +
        'Generate one:\n' +
        '  npm run gen-seed\n\n' +
        'Then add it to zkMonitor/.env:\n' +
        '  RELAYER_WALLET_SEED=<64-char hex>\n',
    );
    process.exit(1);
  }
  if (relayerSeed.length !== 64) {
    throw new Error(`RELAYER_WALLET_SEED must be 64 hex chars after cleanup; got ${relayerSeed.length}`);
  }

  setNetworkId(networkId);

  const walletResult = HDWallet.fromSeed(Buffer.from(relayerSeed, 'hex'));
  if (walletResult.type !== 'seedOk') {
    throw new Error(`Invalid RELAYER_WALLET_SEED: ${String(walletResult)}`);
  }

  const derivationResult = walletResult.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust] as const)
    .deriveKeysAt(0);
  walletResult.hdWallet.clear();

  if (derivationResult.type !== 'keysDerived') {
    throw new Error('HD key derivation failed for RELAYER_WALLET_SEED');
  }

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derivationResult.keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(derivationResult.keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(derivationResult.keys[Roles.NightExternal], networkId);
  const relayerAddress = unshieldedKeystore.getBech32Address().toString();

  console.log('\nRelayer SYSTEM wallet address — fund this with NIGHT:');
  console.log(`  ${relayerAddress}`);
  console.log('\nFaucet:');
  console.log('  https://faucet.preview.midnight.network/');

  const walletConfig: DefaultConfiguration = {
    networkId,
    costParameters: { feeBlocksMargin: 5 },
    relayURL: new URL(nodeUrl),
    provingServerUrl: new URL(proofServerUrl),
    indexerClientConnection: { indexerHttpUrl, indexerWsUrl },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema),
  };

  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded: (c) => ShieldedWallet(c).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (c) =>
      UnshieldedWallet(c).startWithPublicKey(UnshieldedPublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (c) =>
      DustWallet(c).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });

  try {
    await wallet.start(shieldedSecretKeys, dustSecretKey);
    console.log('\nWaiting for wallet sync...');
    const syncedState = await withTimeout(wallet.waitForSyncedState(), syncTimeoutMs, 'Wallet sync');

    const nightCoins = syncedState.unshielded.availableCoins;
    const dustCoins = syncedState.dust.availableCoins;
    console.log(`  NIGHT UTXOs available: ${nightCoins.length}`);
    console.log(`  DUST coins available : ${dustCoins.length}`);

    if (dustCoins.length > 0) {
      console.log('\nRelayer wallet is ready: DUST is available for attestation fees.');
      return;
    }

    if (nightCoins.length === 0) {
      console.log(
        '\nNo NIGHT detected yet. Fund the relayer address above, wait ~2 minutes, then rerun:\n' +
          '  npm run relayer:fund\n',
      );
      return;
    }

    console.log('\nNIGHT detected, but no DUST is available. Registering NIGHT UTXOs for DUST generation...');
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
        timeout({ first: 180_000 }),
      ),
    );
    console.log('\nRelayer wallet is ready: DUST is available for attestation fees.');
  } finally {
    await wallet.stop().catch(() => {
      /* best-effort */
    });
  }
}

main().catch((err) => {
  console.error('Relayer funding failed:', err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
