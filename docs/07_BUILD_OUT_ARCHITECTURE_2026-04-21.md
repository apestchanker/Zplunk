# ZKSplunk Build-Out Architecture

**Originally drafted**: April 21, 2026 (Cassie)
**Updated**: reflects the shipped implementation — the live vitals path runs
against Midnight's hosted **preview** network (the indexer and node are used
directly; no third-party chain-data vendor), and the contract is the anonymous,
unlinkable critical-incident attestation design described below.

---

## 1. The Core Insight

The headline feature is "Midnight telemetry → Splunk HEC." But it leaves one
question unanswered:

> **Can we trust the telemetry itself?**

If a monitor says "proof server up" but is lying or compromised, Splunk
dashboards are a fiction. In a privacy-preserving ecosystem, operators care
about *verifiable* observability — and about reporting incidents **without**
revealing who or where they are.

ZKSplunk answers this with a **three-layer architecture**:

```
┌────────────────────────────────────────────────────────────────────┐
│ LAYER 3 — Analytics                                                │
│   Splunk app: dashboards, saved searches, alerts; AI analyst tabs   │
│   (driven by HEC events from Layer 2)                              │
└────────────────────────────────────────────────────────────────────┘
                ▲
                │ HEC events (connector/)
                │
┌────────────────────────────────────────────────────────────────────┐
│ LAYER 2 — Off-chain telemetry                                      │
│   • zkMonitor/http-vitals-provider — live HTTP checks vs the        │
│     Midnight PREVIEW network (proof server, indexer, node, wallet)  │
│   • connector — vitals-adapter, hec-client, field extractions       │
│   • telemetry-commitment — canonical snapshots + SHA-256 commitments │
└────────────────────────────────────────────────────────────────────┘
                ▲
                │ critical-incident attestations (commitments)
                │
┌────────────────────────────────────────────────────────────────────┐
│ LAYER 1 — On-chain attestation                                     │
│   zksplunk.compact — anonymous, unlinkable critical-incident anchor │
│   Merkle-membership operator registry + nullifiers + public log     │
└────────────────────────────────────────────────────────────────────┘
```

Critical incidents are, at the operator's option, anchored on-chain as
**anonymous** attestations. Auditors can re-hash the off-chain blob and verify
the `payloadCommitment` matches the on-chain record — without learning which
operator reported it.

---

## 2. Folder Layout

```
ZKSplunk_Splunking_w_Midnight/
├── contract/                  on-chain attestation contract
│   └── src/
│       ├── zksplunk.compact   Compact contract
│       └── witnesses.ts       Off-chain witnesses (localSecretKey, operatorPath)
│
├── connector/                 Splunk HEC forwarder (shared)
│   └── src/  (hec-client, splunk-forwarder, vitals-adapter,
│              field-extractions, telemetry-commitment, attestation-client)
│
├── vitals/                    MidnightVitals UI module + mock provider (shared)
│
├── zkMonitor/                 live wiring
│   └── src/  (http-vitals-provider, deploy-attestation, attestation-relayer,
│              onchain-status-reader, fund-relayer, midnight-attestation-client)
│
├── demoLand/                  offline simulated runner + zkZap scenarios
├── splunk-app/zksplunk/       installable Splunk app (dashboards, searches, .spl)
├── ai-agent/                  local analyst over Splunk MCP/REST evidence
└── docs/
```

> The node and indexer use Midnight's hosted **preview** network
> (`rpc.preview.midnight.network`, `indexer.preview.midnight.network/api/v4/graphql`).
> Only the **proof server** runs locally (`:6300`). There is no separate
> chain-data provider package.

---

## 3. The Compact Contract — `contract/src/zksplunk.compact`

`pragma language_version >= 0.23;`

### Ledger state

| Field | Type | Purpose |
|---|---|---|
| `networkId` (sealed) | `Bytes<32>` | Which Midnight network this contract binds to. Prevents cross-network replay. |
| `adminPublicKeyHash` (sealed) | `Bytes<32>` | Immutable admin identity (manages the operator set). |
| `observabilitySchemaVersion` (sealed) | `Field` | Off-chain schema version lock. |
| `operators` | `HistoricMerkleTree<16, Bytes<32>>` | Registered operators as anonymous commitments; depth 16 ⇒ up to 65,536 operators. |
| `spentNullifiers` | `Set<Bytes<32>>` | Spent unlinkability nullifiers (anti-replay). |
| `attestationCount` | `Counter` | Total anonymous critical attestations (also the next log index). |
| `incidentLog` | `Map<Field, IncidentRecord>` | Public append-only log for the off-chain Macro aggregation surface. |

`IncidentRecord = { incidentClass, severity, epoch, payloadCommitment, nullifier }`.

### Exported circuits

| Circuit | Who can call | What it does |
|---|---|---|
| `selfRegisterAsOperator()` | Admin only | Registers the deployer/admin as operator 0 (also seeded in the constructor). |
| `registerOperator(operatorCommitment)` | Admin only | Inserts an external operator's pre-computed commitment leaf. |
| `attestCriticalIncident(incidentClass, severity, epoch, scopeTag, payloadCommitment)` | Any registered operator | Proves Merkle set-membership in ZK, spends a one-time scoped nullifier, and appends an anonymized record. |
| `getAttestationCount()` | Anyone | Read-only count. |
| `isNullifierSpent(nul)` | Anyone | Read-only spent-nullifier check. |

### Enums

- `Severity { info, warning, degraded, critical, outage }`
- `IncidentClass { proofServerOutage, authBruteforceBurst, mintAnomaly, blockStall, walletDrain }`

### Patterns

1. **`sealed ledger`** for trust anchors that must never change post-deployment.
2. **`persistentHash`-derived keys** — Compact has no builtin `public_key()`.
   Operator leaf: `persistentHash([pad(32, "zksplunk:op:commit:"), sk])`;
   nullifier and admin key use distinct domains so they cannot be correlated.
3. **`HistoricMerkleTree`** so membership proofs minted before later
   registrations stay valid against historic roots.
4. **Explicit `disclose()`** on every witness-derived comparison and ledger write.
5. **One-time scoped nullifier** (`persistentHash(domain, sk, scope)`) for
   unlinkability + replay protection, where `scope = hash(epoch, scopeTag)`.

---

## 4. The Live Vitals Path — `zkMonitor/src/http-vitals-provider.ts`

Implements the MidnightVitals `VitalsProviderInterface` with real HTTP health
checks so the existing SplunkForwarder + HEC pipeline run on **live** data:

- **`checkProofServer`** — `GET /version` + `/health` against the local proof
  server; latency classifies healthy / warning / critical.
- **`checkIndexer` / `checkNode`** — reachability + block freshness vs wall clock
  against the preview-network indexer (GraphQL) and node RPC.
- **`checkWallet`** — wallet-boundary health (public metadata only).
- **`checkContracts`** — per-contract monitorability against the deployed address.

Commitments (`connector/src/telemetry-commitment.ts`): canonical, sorted-key
serialization → SHA-256 `payloadCommitment`, ready to feed
`attestCriticalIncident(...)`.

---

## 5. End-to-End Flow (on-chain attestation)

```
   [Collector / zkMonitor]        [Attestation relayer]        [Midnight preview]
        │                            (funded system wallet)          │
        │ http-vitals-provider checks                                │
        │ on CRITICAL alarm:                                         │
        │   1. prove attestCriticalIncident (ZK, via proof server)   │
        │   2. serialize proven tx ───► receive over HTTP            │
        │   3. POST to relayer        pay DUST fee, merge + submit ─► incidentLog
        │ (operator key is UNFUNDED, identity hidden)                │
        │                                                            │
        │ SplunkForwarder.handleVitalCheck() ─── HEC event ─► Splunk │
        │ onchain-status-reader polls chain ─── zksplunk:onchain ──► Splunk
        ▼
  Splunk dashboards show deployment state, operator count,
  attestation count, and anonymized incident classes.
```

The operator proves membership and emits a class-tagged distress signal while
disclosing nothing that identifies or links them — "awareness without
surveillance."

---

## 6. Package split — why separate packages

| Package | Role |
|---|---|
| `@zksplunk/contract` | The Compact contract + witnesses; deployed once per network |
| `@zksplunk/connector` | Splunk HEC ingest + MidnightVitals bridge + commitment/attestation helpers |
| `@zksplunk/zkmonitor` | Live wiring: HTTP vitals, deploy/register, relayer, on-chain status reader |

`vitals/` (UI + mock provider), `demoLand/` (offline runner), `splunk-app/`
(dashboards), and `ai-agent/` (analyst) round out the workspace. A consumer who
only wants "Splunk for Midnight" needs `connector` + `vitals`; on-chain
attestation adds `contract` + the zkMonitor tooling.

---

*Originally prepared by Cassie (April 21, 2026); updated to match the shipped
implementation. See [`09_SETUP_BLOCKCHAIN_PIPELINE.md`](09_SETUP_BLOCKCHAIN_PIPELINE.md)
for the deploy/relayer walkthrough and the repo-root `architecture_diagram.md`
for the full hackathon diagram.*
