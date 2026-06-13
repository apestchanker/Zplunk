# ZKSplunk Build-Out Architecture — April 2026

**Date**: April 21, 2026
**Author**: Cassie
**Status**: Active scaffold laid down this session — ready for implementation sprints.

---

## 1. The Core Insight

The original ZKSplunk was "Midnight telemetry → Splunk HEC." That's still the headline
feature, but it leaves one question unanswered:

> **Can we trust the telemetry itself?**

If a monitor says "proof server up" but is lying or compromised, Splunk dashboards
are a fiction. In a privacy-preserving ecosystem, operators care deeply about
*verifiable* observability.

The build-out answers this with a **three-layer architecture**:

```
┌────────────────────────────────────────────────────────────────────┐
│ LAYER 3 — Analytics                                                │
│   Splunk Cloud / ClickHouse dashboards, AI agents, SOAR alerts     │
│   (existing — driven by HEC events from Layer 2)                   │
└────────────────────────────────────────────────────────────────────┘
                ▲
                │ HEC events (already implemented in connector/)
                │
┌────────────────────────────────────────────────────────────────────┐
│ LAYER 2 — Off-chain telemetry (this session added live chain data) │
│   • BlockfrostClient — GraphQL queries (blocks, contracts, DUST)   │
│   • BlockfrostSubscriber — WebSocket subscriptions                 │
│   • BlockfrostVitalsProvider — MidnightVitals-compatible provider  │
│   • canonical telemetry snapshots + SHA-256 commitments            │
└────────────────────────────────────────────────────────────────────┘
                ▲
                │ telemetry commitments
                │
┌────────────────────────────────────────────────────────────────────┐
│ LAYER 1 — On-chain attestation (this session added)                │
│   zksplunk.compact — monitor registry + attestation + incidents    │
│   Sealed ledger anchors, HistoricMerkleTree-style membership,      │
│   Counter-indexed audit trail.                                     │
└────────────────────────────────────────────────────────────────────┘
```

Every piece of Splunk data is, at the user's option, tied back to an on-chain
commitment. Auditors can re-hash the off-chain blob and verify the monitor
actually observed what it claimed, at the block height it claimed.

---

## 2. Folder Layout After This Sprint

```
ZKSplunk_Splunking_w_Midnight/
├── contract/                     NEW — on-chain attestation contract
│   ├── package.json
│   └── src/
│       ├── zksplunk.compact      Compact contract (verified structure)
│       └── witnesses.ts          Off-chain witness (localSecretKey)
│
├── blockfrost-provider/          NEW — chain data layer
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts              Public API barrel
│       ├── types.ts              GraphQL shapes + ws protocol types
│       ├── urls.ts               Endpoint resolver + auth helpers
│       ├── blockfrost-client.ts  GraphQL HTTP client
│       ├── blockfrost-subscriber.ts  WebSocket subscription manager
│       ├── chain-vitals-provider.ts  Real VitalsProviderInterface impl
│       └── telemetry-commitment.ts   Canonical snapshots + SHA-256 commit
│
├── connector/                    EXISTING — Splunk HEC forwarder
│   └── src/  (hec-client, splunk-forwarder, vitals-adapter, ...)
│
├── vitals/                       EXISTING — MidnightVitals UI module
│   └── (context, components, types, mock-vitals-provider, ...)
│
└── docs/
    ├── BLOCKFROST_INGESTION_GUIDE.md  Existing ingestion guide
    ├── BUILD_OUT_ARCHITECTURE_2026-04-21.md  This doc
    ├── FUTURE_DIRECTIONS.md
    └── HACKATHON_RULES_AND_DEADLINES.md
```

---

## 3. The Compact Contract — `contract/src/zksplunk.compact`

### Ledger state

| Field | Type | Purpose |
|---|---|---|
| `networkId` (sealed) | `Bytes<32>` | Which Midnight network this contract binds to. Prevents cross-network replay. |
| `adminPublicKeyHash` (sealed) | `Bytes<32>` | Immutable admin identity. |
| `observabilitySchemaVersion` (sealed) | `Field` | Off-chain schema version lock. |
| `monitors` | `Map<Bytes<32>, Bytes<32>>` | Registered monitors: pkHash → metadata commitment. |
| `attestationCount` | `Counter` | Total attestations (sequence number). |
| `attestations` | `Map<Field, Bytes<32>>` | seq → telemetry commitment. |
| `incidents` | `Map<Bytes<32>, Bytes<32>>` | incidentId → details commitment. |
| `incidentStatuses` | `Map<Bytes<32>, Field>` | incidentId → IncidentStatus (open/ack/mitigated/resolved). |
| `incidentSeverities` | `Map<Bytes<32>, Field>` | incidentId → Severity (info/warn/degraded/critical/outage). |
| `incidentCount` | `Counter` | Total incidents. |

### Exported circuits

| Circuit | Who can call | What it does |
|---|---|---|
| `registerMonitor(pkHash, metaHash)` | Admin only | Registers a monitor. |
| `revokeMonitor(pkHash)` | Admin only | Removes a monitor. |
| `attestObservation(commitment)` | Any registered monitor | Anchors a telemetry commitment on-chain with a sequence number. |
| `reportIncident(id, severity, commitment)` | Any registered monitor | Opens an incident. |
| `updateIncidentStatus(id, newStatus)` | Admin only | Transitions incident lifecycle. |
| `isMonitorRegistered(pkHash)` | Anyone | Read-only helper. |
| `getAttestationCount()` | Anyone | Read-only helper. |
| `getIncidentCount()` | Anyone | Read-only helper. |

### Patterns borrowed from our Brick Towers / Edda Labs deep dive

1. **`sealed ledger`** for trust anchors that must never change post-deployment.
2. **`persistentHash`-derived public keys** — Compact has no builtin `public_key()`.
   Pattern: `persistentHash([pad(32, "zksplunk:monitor:pk:"), sk])`.
3. **Explicit `disclose()`** on every witness-derived comparison and ledger write.
4. **`Counter`** as a cheap, auditable sequence number for attestations/incidents.
5. **Admin + monitor roles** via comparison against sealed key hashes — no
   complex ACL tree needed for the v0 contract (can upgrade to HistoricMerkleTree
   later if we need many admins).

### Structure validation

Run through `midnight-extract-contract-structure`:
- ✅ 6 circuits (3 exported), 10 ledger items (7 exported), 2 enums
- ✅ No deprecated `Cell<T>` wrappers
- ✅ Proper pragma range `>= 0.16 && <= 0.21`
- ✅ Module-scoped witness declaration

---

## 4. The Blockfrost Provider — `blockfrost-provider/`

### What it provides

**Client layer (`BlockfrostClient`)**

- `getBlock(offset?)` — latest or specific block
- `getCurrentEpochInfo()` — epoch number, duration, elapsed
- `getContractState(address)` — contract state bytes + token balances
- `getDustGenerationStatus(cardanoRewardAddresses)` — DUST status for
  one or more reward addresses
- `connectViewingKey(vk)` → `disconnectSession(sid)` — shielded scanning session
- Plus a raw `query<T>()` escape hatch for arbitrary GraphQL

**Subscription layer (`BlockfrostSubscriber`)**

- graphql-transport-ws handshake (connection_init / connection_ack)
- Auto-reconnect with exponential backoff (max 30s)
- Re-subscription of all registered subscriptions on reconnect
- Per-subscription `onNext` / `onError` / `onComplete` handlers

**Vitals layer (`BlockfrostVitalsProvider`)**

Implements the MidnightVitals `VitalsProviderInterface` so our existing
UI code, SplunkForwarder, and HEC event pipeline all work with **live chain
data** instead of the mock provider. Health logic:

- **`checkProofServer`** — HTTP `GET /version`, latency classifies healthy / warning / critical
- **`checkNetwork`** — fetches latest block; compares `block.timestamp` to
  wall clock; `< 60s` = healthy, `< 120s` = warning, else critical
- **`checkWallet`** — if a Cardano reward address is configured, queries
  `dustGenerationStatus` and reports registration + generation rate
- **`checkContracts`** — `Promise.allSettled` of `getContractState` for each
  contract, reports counts of ✓ / missing / error

**Commitment layer (`telemetry-commitment.ts`)**

- `TelemetrySnapshot` — canonical shape (timestamp, network, blockHeight,
  component, payload)
- `canonicalStringify()` — sorted-key JSON for deterministic hashing
- `commitSnapshot()` → 32-byte hex hash, ready to pass to
  `zksplunk.attestObservation(commitment)`
- `buildSnapshot()` — convenience constructor

---

## 5. End-to-End Flow

```
       [Monitor agent]                   [Blockfrost]              [Midnight chain]
            │                                │                          │
            │ BlockfrostVitalsProvider       │                          │
            │    .checkProofServer()         │                          │
            │    .checkNetwork()  ───────────►  GraphQL query           │
            │    .checkWallet()              │  block / contract / dust │
            │    .checkContracts() ──────────►                          │
            │ ◄────────────── vitals data ───┤                          │
            │                                │                          │
            │ build canonical snapshot       │                          │
            │ commit = SHA-256(snapshot)     │                          │
            │                                │                          │
            │ ─── attestObservation(commit) ──────────────────────────► │
            │                                │     zksplunk contract    │
            │                                │                          │
            │ SplunkForwarder.handleVitalCheck()                        │
            │ ─── HEC event { fields, commit, blockHeight } ─►  Splunk  │
            │                                                           │
            │                                                           │
            ▼                                                           ▼
      Splunk dashboards                                    Blockfrost GraphQL:
      show the event with                                  `attestations` map
      on-chain commit ref.                                 contains the same hash.
      Auditor can re-hash                                  ✅ tamper-evident.
      the blob to verify.
```

---

## 6. Should We Use Blockfrost? — Decision

### Short answer: **Yes, for v0–v1.**

### Pros
- **Zero infrastructure** — no Midnight node, no indexer to maintain
- **Production-ready GraphQL + WebSocket** — both are what we need, in one place
- **Three networks** from the same API key
- **Node RPC included** — compatible with midnight.js SDK out of the box
- **Free tier** likely sufficient for hackathon + demo scale

### Cons / trade-offs
- **Shielded tx scanning sends viewing keys to Blockfrost** — fine for demos,
  a red flag for enterprise deployments
- **Dependency on a third-party service** — if Blockfrost goes down, ZKSplunk
  is blind (but the whole point of ZKSplunk is observability, so we'd detect
  that instantly and failover)

### Mitigation
The `BlockfrostConfig` type supports `indexerUrlOverride`, `indexerWsUrlOverride`,
and `nodeRpcUrlOverride`. A self-hosted Midnight indexer that implements the
same GraphQL schema is a drop-in replacement — we just change the URLs. That
means "use Blockfrost now, migrate to self-hosted later" is a one-line config
change, not a rewrite.

---

## 7. What's Still Needed

### Contract / ledger side
- [ ] `compactc` the contract and commit `managed/zksplunk/` artifacts
- [ ] Write `midnight-rwa-simulator.ts`-style test harness for local circuit tests
- [ ] Write DApp provider setup (wallet + midnight.js) that loads `zksplunk` contract
- [ ] Deploy to preprod and record the contract address

### Integration side
- [ ] `npm install` in `blockfrost-provider/` (resolves `ws` / `@types/node` lints)
- [ ] `connector/` helper: wrap `handleVitalCheck` so it also calls
      `attestObservation` via midnight.js when enabled
- [ ] End-to-end demo script: spin up MidnightVitals with Blockfrost provider,
      attest each vital check on-chain, forward to Splunk, render the
      "commitment column" in the dashboard

### Docs
- [ ] Update `README.md` with the new three-layer architecture diagram
      (done conceptually in this doc, next step: edit README)
- [ ] Shared "observability attestation" blog post for the hackathon pitch

---

## 8. Contract vs. connector split — why three packages

| Package | Role |
|---|---|
| `@zksplunk/contract` | The Compact contract + witnesses; deployed once per network |
| `@zksplunk/blockfrost-provider` | Runtime chain reader + vitals provider (browser + node safe) |
| `@zksplunk/connector` | Splunk HEC ingest + MidnightVitals bridge (already existed) |

All three are installable independently. A consumer who only wants "Splunk for
Midnight with Blockfrost backing" needs just `blockfrost-provider` + `connector`.
A consumer who also wants on-chain attestations adds `contract`.

---

*Prepared by Cassie — April 21, 2026*
