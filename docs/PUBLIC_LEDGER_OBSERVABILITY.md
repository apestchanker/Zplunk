# Public Ledger Observability on Midnight

> **Status:** Reference Specification (v0.1)
> **Date:** 2026-06-09
> **Author:** Penny / EnterpriseZK Labs LLC
> **Context:** Splunk Agentic Ops Hackathon (deadline 2026-06-15)
> **Purpose:** Define exactly what ZKSplunk can glean from Midnight's public ledger,
> and how each public signal maps to Splunk detections for fighting on-chain
> attacks and outages.

---

## 0. TL;DR

Midnight is a privacy chain, so the governing rule is simple:

> **Metadata and volumes are public. Contents are private.**

ZKSplunk's Macro lens is built entirely from that public surface. We can see
*which contract and circuit fired, how often, with what mint/spend amounts, and
whether the transaction failed*, plus block cadence, epoch timing, and fee-resource
health. We cannot see private state, circuit arguments, or the parties/amounts of
shielded transfers. Everything below is scoped to what is **physically observable**,
so the detections are honest.

This document is grounded against three sources of truth:

1. The Midnight ledger spec `Effects` record (verified via `midnight-manual`, see `ZKZAP_SECURITY_PROTOCOL.md`).
2. The official docs (`docs.midnight.network`) via the Midnight MCP: transaction lifecycle and indexer GraphQL surface.
3. Our own `blockfrost-provider` types, which encode what we actually pull from the indexer.

---

## 1. The three public layers

### 1.1 Per-call `Effects` (the richest signal)

Every contract call carries a public `Effects` record
(`midnight-ledger/spec/contracts.md`):

```rust
struct Effects {
    claimed_nullifiers: Set<CoinNullifier>,              // shielded spend activity (timing/count visible)
    claimed_shielded_receives: Set<CoinCommitment>,
    claimed_shielded_spends: Set<CoinCommitment>,
    claimed_contract_calls: Set<(u64, ContractAddress, Hash<Bytes>, Fr)>, // which entry point fired
    shielded_mints: Map<[u8; 32], u64>,                  // mint AMOUNTS visible
    unshielded_mints: Map<[u8; 32], u64>,                // mint AMOUNTS visible
    unshielded_inputs: Map<TokenType, u128>,
    unshielded_outputs: Map<TokenType, u128>,
    claimed_unshielded_spends: Map<(TokenType, PublicAddress), u128>, // addr + amount visible
}
```

What this gives us:

- **`claimed_contract_calls`** , which contract and which entry point (circuit) fired, and how often.
- **`shielded_mints` / `unshielded_mints`** , mint amounts, even though circuit arguments stay private.
- **`claimed_unshielded_spends`** , unshielded transfers expose (address, amount).
- **`claimed_nullifiers`** , shielded spend activity (count and timing) is visible; parties and amounts are not.
- **`unshielded_inputs` / `unshielded_outputs`** , flow totals per token type.

### 1.2 Transaction lifecycle status (a first-class public signal)

From the docs transaction lifecycle (`docs/concepts/network-architecture/transactions.mdx`):
a transaction passes the transaction pool's well-formedness check, gets included in
a block, has its embedded proof fully verified by the runtime, and then commits its
state transition. That produces two publicly observable failure modes:

- **`failure`** , the transaction was submitted, attempted, and **rejected by ledger rules**. It lands in a block as failed.
- **`rejected`** , never included (intermittent or reorg).

The Rust indexer deliberately "skips collapsed update for failed transactions," but
the failure itself is still observable. A burst of failures against one entry point
is exactly the brute-force / griefing tell.

### 1.3 Indexer GraphQL + block data (what we actually pull)

Confirmed against the indexer API (`contractActions` / `contract_action` query and
subscription, `queryContractState` at `blockHeight` / `blockHash`, block
subscriptions over `graphql-transport-ws`) and encoded in
`blockfrost-provider/src/types.ts`:

| Shape | Public fields | Use |
|---|---|---|
| **`Block`** | `hash`, `height`, `timestamp`, `author`, `protocolVersion`, `ledgerParameters` | block cadence + producer + protocol drift |
| **`ContractAction`** | `address`, `state`, `zswapState`, `unshieldedBalances` | public contract state transitions |
| **`EpochInfo`** | `epochNo`, `durationSeconds`, `elapsedSeconds` | consensus timing |
| **`DustGenerationStatus`** | `registered`, `nightBalance`, `generationRate`, `currentCapacity`, `maxCapacity` | fee-resource health |

---

## 2. What stays invisible by design

Do not over-promise. These are impossible to observe on a privacy chain:

- Plaintext of any user's **private state** (lives in the user's local state DB).
- **Arguments** to a circuit (the witness, provably never leaves the prover).
- **Who and how much** for **shielded** transfers (nullifier/commitment activity is visible; identities and amounts are not).

Claiming detection of stealthy attacks on individual private state would be
dishonest, and judges will catch it.

---

## 3. Public signal to Splunk detection map

| Threat / outage | Public signal we glean | Source field | Lens |
|---|---|---|---|
| **Failed-auth / brute force** | spike of `failure`/`rejected` calls to one entry point | `claimed_contract_calls` + tx status | Me + Macro |
| **Contract griefing / spam** | abnormal call-rate to one circuit, rising failed-call ratio | `claimed_contract_calls` | Macro |
| **Mint anomaly / compromised authority** | mint-rate or amount spike | `shielded_mints` / `unshielded_mints` | Macro |
| **Wallet drain (unshielded)** | rapid drawdown, address + amount visible | `claimed_unshielded_spends` | Me + Macro |
| **Wallet drain (shielded)** | burst of nullifiers from one operator wallet (amounts hidden) | `claimed_nullifiers` | Me |
| **Indexer / network outage** | block height stalls, ws reconnect storm, sync lag | `Block.height` / `timestamp`, subscriber reconnect | Me + Macro |
| **Consensus / liveness anomaly** | block cadence irregularity, epoch elapsed drift | `Block`, `EpochInfo` | Macro |
| **Fee-resource starvation** | DUST generation stalls vs NIGHT registered | `DustGenerationStatus` | Me + Macro |
| **Proof-server flood (DDoS)** | latency spike + queue depth (operator-side, not ledger) | MidnightVitals local | Me |

> Note on NIGHT + DUST: NIGHT is the token; DUST is the shielded, non-transferable
> fee resource that NIGHT generates over time. A `DustGenerationStatus` stall is a
> fee-availability signal, not a token-balance leak.

---

## 4. Example SPL detections

These assume events shaped by the connector's `vitals-adapter` and the planned
`attack-signals.ts` enrichment.

**Failed-auth burst against one entry point**

```spl
sourcetype="midnight:effects" event.type="contract.call"
| stats count as calls, count(eval(tx_status="failure")) as failures by entry_point, _time span=2m
| eval failure_rate = failures / calls * 100
| where failures > 50 AND failure_rate > 40
| eval attack_signal="failed-auth-bruteforce"
```

**Mint-rate anomaly**

```spl
sourcetype="midnight:effects" (mint_type="shielded" OR mint_type="unshielded")
| timechart span=1m sum(mint_amount) as minted, count as mint_events
| where mint_events > 100
| eval attack_signal="mint-anomaly"
```

**Unshielded wallet drain**

```spl
sourcetype="midnight:effects" event.type="unshielded.spend"
| stats sum(amount) as outflow, count as spends by public_address, _time span=90s
| where spends > 5 AND outflow > drain_threshold
| eval attack_signal="wallet-drain"
```

**Indexer / network outage (block height stalled)**

```spl
sourcetype="midnight:chain" event.type="block"
| stats max(block_height) as h, max(_time) as last_block by network
| eval seconds_since_block = now() - last_block
| where seconds_since_block > 60
| eval attack_signal="indexer-outage"
```

---

## 5. The two lenses (recap)

| | **ZKSplunk Me** | **ZKSplunk Macro** |
|---|---|---|
| Who | An individual DApp / operator | Ecosystem watchers |
| Sees | Its own stack (consented self-monitoring) | Public chain `Effects` + infra health |
| Catches | Local brute-force, wallet drain, proof abuse | Systemic floods, mint storms, outages |
| Privacy | Never reads private state | Built from public data, nobody shares secrets |

Individuals can emit anonymized incident commitments (on-chain, contents-free) that
aggregate into the Macro view: ecosystem awareness from distress signals, not
surveillance.

---

## 6. The honest framing (the Jay Albert test)

- **Futile version (do not pitch):** a centralized chain-wide SOC that catches hackers attacking users' private state. Impossible on a privacy chain.
- **Valuable version (what we build):**
  1. **Me** , operator self-monitoring as a paid product (clear customer, clear value).
  2. **Macro from public data** , a DevRel trust signal + incident forensics + systemic-anomaly detector. A public good Midnight currently lacks.

Scoped to what is physically observable, this is not futile.

---

## 7. Implementation gap

The signals above are documented; the module that turns raw `Effects` into
`attack_signal` fields for SPL is still to build:

- **`connector/src/attack-signals.ts`** , rolling-window enrichment (see `DEVREL_SPLUNK_HEALTH_AND_ATTACK_DETECTION.md`).
- **`blockfrost-provider`** , wire the subscriber to emit block / contract-action / mint / spend events as HEC events for the Macro panel.

These two are the highest-leverage builds before the deadline.

---

## 8. Related docs

| Doc | Role |
|---|---|
| `ZKZAP_SECURITY_PROTOCOL.md` | The detect → decide → act security layer + threat taxonomy |
| `DEVREL_SPLUNK_HEALTH_AND_ATTACK_DETECTION.md` | Health pulse, attack-signal taxonomy, SPL queries, AI agent wiring |
| `MIDNIGHT_BASE_LAYER_RESEARCH.md` | Base-layer / dogfood DApp decision for the demo |

---

*Reference doc by Penny for ZKSplunk. Grounded against the Midnight ledger spec,
the official docs via the Midnight MCP, and our `blockfrost-provider` types.*
