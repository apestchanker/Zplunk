# ZKSplunk — Blockchain Pipeline Setup Guide

End-to-end walkthrough: generate seeds → get wallet addresses → fund from faucet
→ deploy contract → configure env → start services → verify in Splunk. The
same `zksplunk:onchain` events power both the **zkZap Attestation** dashboard
and the blockchain KPIs under the **Global Map**.

**Time to complete:** ~20 minutes (most of it waiting for the faucet and wallet sync).

---

## How it works

```
[Collector / zkMonitor]           [Attestation Relayer]           [Midnight chain]
  - Monitors vitals                 - Holds funded SYSTEM wallet
  - On CRITICAL alarm:              - Receives proven tx via HTTP
      1. Proves ZK circuit          - Pays DUST fee
      2. Serializes proven tx  -->  - Merges + submits         -->  incidentLog
      3. POSTs to relayer           - Emits HEC telemetry
  - Uses UNFUNDED keypair
  - Identity: cryptographically hidden
```

Three roles, three seeds (can share a machine for dev):

| Role | Needs NIGHT? | Env var | Used by |
|---|---|---|---|
| **Admin** | ✅ yes | `MIDNIGHT_WALLET_SEED` | One-time deploy; constructor registers the deployer as operator 0 |
| **System relayer** | ✅ yes | `RELAYER_WALLET_SEED` | Running relayer — pays DUST fee per attestation |
| **Operator** (collector) | ❌ never | `OPERATOR_ZSWAP_SEED` | ZK proof generation only, zero balance |

> For a dev/demo setup you can reuse the same seed for admin and relayer.

---

## Prerequisites

```bash
node --version   # 20+ required
npm --version    # 9+ required

# From the repo root:
npm install
```

### Network: no local node needed

| Component | Where it runs | Default URL |
|---|---|---|
| Node / RPC | Public preview network | `https://rpc.preview.midnight.network` |
| Indexer | Public preview network | `https://indexer.preview.midnight.network/api/v4/graphql` |
| **Proof server** | **Your machine** | `http://localhost:6300` |

The indexer and node use Midnight's hosted preview network — no local blockchain
needed. Only the **proof server** runs locally (generates ZK/PLONK proofs).
Install it via the Midnight developer tooling:
`https://docs.midnight.network/develop/tutorial/building/`

If your proof server runs on a different host (e.g. your Splunk box), set
`MIDNIGHT_PROOF_SERVER_URL=http://<host>:6300` in `zkMonitor/.env`.

---

## Step 1 — Generate seeds

```bash
cd zkMonitor

npm run gen-seed   # copy output → ADMIN_SEED
npm run gen-seed   # copy output → RELAYER_SEED
npm run gen-seed   # copy output → OPERATOR_SEED
```

Each call prints one 64-char hex string. Save all three somewhere safe.
Never commit them — `.env` is git-ignored.

---

## Step 2 — Get the wallet addresses

Add the admin and relayer seeds to `.env`. The admin address helper prints the
bech32 address immediately — no network, no sync, exits cleanly.

```bash
echo "MIDNIGHT_WALLET_SEED=<ADMIN_SEED>" >> .env
echo "RELAYER_WALLET_SEED=<RELAYER_SEED>" >> .env

npm run get-address
```

Expected output:

```
=== ZKSplunk Wallet Address ===

Network        : preview
Seed (first 8) : 465e2b2e…  (full seed kept private)

Unshielded address — fund this with NIGHT from the Midnight faucet:

  mn_addr_preview1xxxx…

Next steps:
  1. Request NIGHT in the Midnight Discord #faucet channel:
       /faucet mn_addr_preview1xxxx…
  2. Wait ~2 minutes for confirmation
  3. Run: npm run deploy
```

To get the **relayer** address, run the relayer funding helper:

```bash
npm run relayer:fund
```

On the first run it prints the relayer SYSTEM wallet address and asks you to
fund it. If NIGHT is already visible, it registers those NIGHT UTXOs for DUST
generation. If DUST is already available, it exits successfully.
If the public preview network is slow to sync, rerun it or raise the timeout:

```bash
RELAYER_FUND_SYNC_TIMEOUT_MS=300000 npm run relayer:fund
```

---

## Step 3 — Fund both wallets and register DUST

1. Open https://faucet.preview.midnight.network/
2. Paste the **admin address** (`mn_addr_preview1…`) and request NIGHT.
3. Repeat with the **relayer address**.

Wait ~2 minutes for the transactions to confirm before continuing.

Register DUST for the relayer:

```bash
npm run relayer:fund
```

Expected outcomes:

| Output | Meaning |
|---|---|
| `No NIGHT detected yet` | Faucet tx is not visible yet; wait and rerun |
| `Registering NIGHT UTXOs for DUST generation` | The helper found NIGHT and is submitting the DUST registration tx |
| `Relayer wallet is ready` | The relayer has DUST and can pay attestation fees |

> **Admin DUST generation happens during deploy.** `npm run deploy` detects if
> the admin wallet has NIGHT but no DUST and registers its UTXOs before deploying
> the contract. The relayer is a separate fee-payer, so use
> `npm run relayer:fund` for it.

---

## Step 4 — Deploy the contract

```bash
cd zkMonitor
npm run deploy
```

This connects to the proof server and the public preview network, generates ZK
keys, and deploys the contract. The constructor registers this machine as the
first operator, so no separate post-deploy `registerOperator` transaction is
needed. It takes **1–5 minutes** depending on proof server speed.

Expected output:

```
=== ZKSplunk Deploy + RegisterOperator ===
  networkId   : preview
  proofServer : http://10.0.0.10:6300
  indexer     : https://indexer.preview.midnight.network/api/v4/graphql
  relay (ws)  : wss://rpc.preview.midnight.network

  Wallet unshielded address (fund this):
    mn_addr_preview1xxxx…

Waiting for wallet sync...
Deploying zksplunk contract...
  Contract deployed!
  Address   : 0102030405…   <-- copy this
  Block     : 123456
  TxHash    : abcdef…

  Initial operator registered in constructor.

=== Done — add to zkMonitor/.env ===

  ZKSPLUNK_CONTRACT_ADDRESS=0102030405…
  ENABLE_ATTESTATION=true
```

**Troubleshooting deploy failures:**

| Error | Fix |
|---|---|
| `insufficient funds` / `could not balance dust` | Faucet tx not confirmed yet — wait 1 more minute and retry; or NIGHT coins haven't been picked up by the indexer yet |
| `proof server unavailable` | Check `MIDNIGHT_PROOF_SERVER_URL` in `.env`; confirm the proof server process is running |
| `wallet sync timeout` | The public RPC WebSocket may throttle — retry, or check network access to `rpc.preview.midnight.network` |

---

## Step 5 — Configure `.env`

Add these lines to `zkMonitor/.env` (most are printed at the end of `npm run deploy`):

```env
# From deploy output:
ZKSPLUNK_CONTRACT_ADDRESS=<address from Step 4>
ENABLE_ATTESTATION=true

# Operator keypair — UNFUNDED, ZK proof generation only
OPERATOR_ZSWAP_SEED=<OPERATOR_SEED from Step 1>

# Relayer URL — where the collector POSTs proven txs
# Same machine: use localhost. Separate host: use its IP/hostname.
ATTESTATION_RELAYER_URL=http://localhost:7300

# Relayer funded wallet — pays DUST fees
RELAYER_WALLET_SEED=<RELAYER_SEED from Step 1>
```

> `OPERATOR_ZSWAP_SEED` holds no funds and is safe to store on the collector host.
> `RELAYER_WALLET_SEED` controls real NIGHT — restrict with `chmod 600 .env`.
> For a single-machine demo, `RELAYER_WALLET_SEED` may equal
> `MIDNIGHT_WALLET_SEED`, but production should separate admin and relayer keys.

---

## Step 6 — Start the services

Open three terminals (or use `pm2` — see the end of this doc).

**Terminal 1 — Relayer** (funded system wallet, pays DUST per attestation):

```bash
cd zkMonitor
npm run relayer:fund   # rerun if DUST was exhausted
npm run relayer
```

The relayer waits for wallet sync before listening on `7300` so it can see
fresh NIGHT/DUST state. Default sync timeout is 5 minutes. If Preview is slow:

```bash
RELAYER_WALLET_SYNC_TIMEOUT_MS=600000 npm run relayer
```

```
[relayer] ZKSplunk attestation relayer starting
  network : preview
  port    : 7300
  wallet  : mn_addr_preview1xxxx…
[relayer] heartbeat {"uptime_s":0,"received":0,"submitted":0,"failed":0}
```

**Terminal 2 — On-chain status reader** (polls the chain, fills the Splunk dashboard):

```bash
cd zkMonitor
npm run onchain-status
```

```
[onchain] ZKSplunk on-chain status reader starting
  contract     : 0102030405…
  poll interval: 60000ms
[onchain] zksplunk.onchain.status {"deployed":true,"operators_registered":1,...}
```

**Terminal 3 — Collector** (monitors vitals, proves ZK on critical alarms):

```bash
cd zkMonitor
npm run start
```

With `ENABLE_ATTESTATION=true` set, the collector uses the real attestation client
instead of the mock — critical alarms are proven and sent to the relayer.

---

## Step 7 — Verify in Splunk

Open **ZKSplunk app** → **zkZap Attestation** tab.

Within 2 minutes of starting all three services:

| Panel | Expected |
|---|---|
| Contract | **DEPLOYED** |
| Operators registered | **1** |
| On-chain reader (s since read) | **< 120** (green) |
| Relayer liveness (s since heartbeat) | **< 90** (green) |

Then open **ZKSplunk Global Map**. The KPI strip below the map should still show
the operational metrics, plus:

| KPI | Source |
|---|---|
| Contrato Midnight | latest `zksplunk:onchain` deployment state |
| Attestations on-chain | latest `zksplunk:onchain` attestation count |

When the first CRITICAL vital event fires:

| Panel | What happens |
|---|---|
| Critical incidents detected | +1 |
| Attestations submitted on-chain | +1 (30–60s later) |
| Recent on-chain incidents | new row: incident_class, severity, epoch |
| Recent attestations | new row: tx_hash, block_height |

**SPL sanity checks** (run in Splunk Search if panels are empty):

```spl
index=zksplunk sourcetype="zksplunk:onchain" | head 5
index=zksplunk sourcetype="zksplunk:relayer" type="zksplunk.relayer.heartbeat" | head 5
index=zksplunk sourcetype="zksplunk:relayer" type="zksplunk.relayer.submitted"
  | table _time incident_class severity tx_hash
```

---

## Troubleshooting

**"Contract: NOT DEPLOYED" in Splunk after a successful deploy**
- Is `npm run onchain-status` running? It's the service that reads the chain and sends events to Splunk.
- Does `ZKSPLUNK_CONTRACT_ADDRESS` in `.env` match the address printed during `npm run deploy`?
- The indexer may lag 2–3 minutes — reload the dashboard and wait.

**"ZKSPLUNK_CONTRACT_ADDRESS is not set" in relayer logs**
The relayer needs the contract address to validate incoming proofs:
```env
ZKSPLUNK_CONTRACT_ADDRESS=<same address as in collector .env>
```

**"On-chain attestations" stays 0 after a submission**
The counter comes from the on-chain reader (polls every 60s by default).
For faster updates during testing:
```env
ONCHAIN_POLL_INTERVAL_MS=15000
```

**Relayer returns HTTP 429**
Default rate limit is 6 requests/minute per source. Increase if needed:
```env
RELAYER_MAX_REQUESTS_PER_MIN=30
```

**`npm run relayer:fund` ends with `Wallet sync timed out`**
The helper already printed the relayer address. Fund that address, wait for the
preview network/indexer to catch up, then rerun. If preview is slow, increase:
```bash
RELAYER_FUND_SYNC_TIMEOUT_MS=300000 npm run relayer:fund
```

**`npm run relayer` ends with `Relayer wallet sync timed out`**
The wallet has not synced through the public preview RPC/indexer before the
runtime safety timeout. Rerun, or increase the timeout:
```bash
RELAYER_WALLET_SYNC_TIMEOUT_MS=600000 npm run relayer
```

---

## Running persistently with pm2

```bash
npm install -g pm2

cd zkMonitor
pm2 start "npm run relayer"        --name zksplunk-relayer
pm2 start "npm run onchain-status" --name zksplunk-onchain
pm2 start "npm run start"          --name zksplunk-collector
pm2 save
pm2 startup   # prints a command to run so services survive reboots
```

---

## What is public on-chain vs. what stays hidden

| Data | Public on-chain | Hidden |
|---|---|---|
| Incident class (`block-stall`, `proof-server-outage`, …) | ✅ | — |
| Severity | ✅ | — |
| Epoch (coarse Unix timestamp) | ✅ | — |
| Payload commitment (hash of the raw payload) | ✅ | — |
| Nullifier (anti-replay proof) | ✅ | — |
| Operator identity | — | ✅ Merkle membership — unlinkable |
| Node hostname / IP | — | ✅ never included |
| Raw metric values / thresholds | — | ✅ only the commitment hash |
| Relayer wallet address | ✅ (paid fees) | — shared system account, not linked to any operator |
