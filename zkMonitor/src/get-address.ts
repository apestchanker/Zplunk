// =============================================================================
// ZKSplunk — Print wallet addresses from a seed (no network, no sync)
// =============================================================================
// Run this FIRST to get the wallet addresses to fund before deploying.
//
// Usage:
//   npm run get-address
//
// Requires in .env:
//   MIDNIGHT_WALLET_SEED=<64-char hex>   (generate: npm run gen-seed)
//   MIDNIGHT_NETWORK_ID=preview          (default)
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import type { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';

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

const rawSeed = process.env.MIDNIGHT_WALLET_SEED?.trim().replace(/%$/, '');
const networkId = (process.env.MIDNIGHT_NETWORK_ID?.trim() ?? 'preview') as NetworkId.NetworkId;

if (!rawSeed) {
  console.error(
    'MIDNIGHT_WALLET_SEED is not set in .env\n\n' +
    'Generate one with:\n' +
    '  npm run gen-seed\n\n' +
    'Then add it to .env:\n' +
    '  MIDNIGHT_WALLET_SEED=<64-char hex>',
  );
  process.exit(1);
}

// Strip trailing non-hex characters (e.g. zsh "%" no-newline indicator)
const cleanSeed = rawSeed.replace(/[^0-9a-fA-F]/g, '');
if (cleanSeed.length !== 64) {
  console.error(
    `MIDNIGHT_WALLET_SEED must be exactly 64 hex characters (got ${cleanSeed.length} after stripping non-hex).\n` +
    'Regenerate with: npm run gen-seed',
  );
  process.exit(1);
}

const seedBytes = Buffer.from(cleanSeed, 'hex');
const walletResult = HDWallet.fromSeed(seedBytes);
if (walletResult.type !== 'seedOk') {
  console.error('Invalid MIDNIGHT_WALLET_SEED:', walletResult);
  process.exit(1);
}

const derivation = walletResult.hdWallet
  .selectAccount(0)
  .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust] as const)
  .deriveKeysAt(0);

walletResult.hdWallet.clear();

if (derivation.type !== 'keysDerived') {
  console.error('HD key derivation failed:', derivation);
  process.exit(1);
}

// Unshielded (NIGHT) address — this is what you fund from the faucet
const keystore = createKeystore(derivation.keys[Roles.NightExternal], networkId);
const unshieldedAddress = keystore.getBech32Address().toString();

console.log('\n=== ZKSplunk Wallet Address ===\n');
console.log('Network        :', networkId);
console.log('Seed (first 8) :', cleanSeed.slice(0, 8) + '…  (full seed kept private)');
console.log('');
console.log('Unshielded address — fund this with NIGHT from the Midnight faucet:');
console.log('');
console.log(' ', unshieldedAddress);
console.log('');
console.log('Next steps:');
console.log('  1. Go to https://faucet.preview.midnight.network/');
console.log('     Paste this address and request NIGHT:');
console.log(`       ${unshieldedAddress}`);
console.log('  2. Wait ~2 minutes for confirmation');
console.log('  3. Run: npm run deploy');
console.log('');
