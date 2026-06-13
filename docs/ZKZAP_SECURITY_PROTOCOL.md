# zkZap — Security & Response Protocol for ZKSplunk

> **Status:** Design Specification (v0.1, draft for John's review)
> **Date:** 2026-06-06
> **Author:** Penny 🎀 / EnterpriseZK Labs LLC
> **Context:** Splunk Agentic Ops Hackathon (deadline 2026-06-15, ~9 days out)
> **Relationship:** zkZap is the **active security/response layer** built on top of
> ZKSplunk's existing observability pipeline. *ZKSplunk observes; zkZap responds.*

---

## 0. TL;DR

- **zkZap is not a new product.** It's the **detect → decide → act** layer that
  re-interprets ZKSplunk's existing telemetry as **threat signals** and responds
  (alert / throttle / quarantine / **anonymous on-chain critical-incident
  attestation**). On-chain reporting is reserved for **critical** incidents and
  is **anonymous + unlinkable**: only the anonymized incident *class* is public
  (for network-wide awareness) — never the operator or node. See §3.3.
- **It is a behavioral / metadata anomaly detector + a consented local
  self-monitor — never a privacy-breaker.** Plaintext private state, circuit
  arguments, and shielded transfer parties/amounts remain invisible by design.
- **Two lenses over one pipeline:**
  - **ZKSplunk Me** — individual / per-DApp self-monitoring (the paid-service,
    live-demo hero).
  - **ZKSplunk Macro** — ecosystem watchtower, built primarily from
    **public chain data** (no telemetry-sharing required), with an optional
    opt-in consortium enrichment layer.
- **Recommended framing for the hackathon:** zkZap is a *capability inside* the
  ZKSplunk **Observability** submission, not a separate Security entry.

> **Open decisions (revisable):** hero lens = **Me** (Macro as payoff panel);
> zkZap framing = **capability inside ZKSplunk**. Recorded here so we can change
> them deliberately.

---

## 1. What's actually observable on Midnight (privacy ground truth)

Verified against the Midnight corpus via `midnight-manual` (`mnm`).

### 1.1 Public per-call `Effects` (`midnight-ledger/spec/contracts.md`)

Every contract call carries a **public** `Effects` record:

```rust
struct Effects {
    claimed_nullifiers: Set<CoinNullifier>,              // shielded spends (activity visible)
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

**Implication:** you can see *which contract + which entry point (circuit) fired,
how often*, *mint amounts*, and *unshielded transfers (address + amount)* — even
though **circuit arguments stay private**.

### 1.2 Transaction failure is a public, first-class signal

From the Wallet spec: a `failure` status = the tx was **submitted, attempted, and
rejected by ledger rules** (lands in a block as failed). `rejected` = never
included (intermittent / reorg). Both are network-observable.

### 1.3 What stays invisible by design

- Plaintext of any user's **private state** (lives in the user's local state DB).
- **Arguments** to a circuit (the witness — provably never leaves the prover;
  cf. `bboard_private_witness_not_leaked`).
- **Who / how much** for *shielded* transfers (nullifier/commitment activity is
  visible; identities and amounts are not).

---

## 2. Threat taxonomy — what zkZap can detect

| Threat | Detectable? | Signal | Lens |
|---|---|---|---|
| Brute-forcing a user's private state | Indirectly | Spike of **failed/rejected calls** to one entry point | Me (local) + Macro (aggregate) |
| Nefarious chain activity | Yes (metadata) | Abnormal call-rate, tx-rejection spikes, block-cadence anomalies | Macro |
| Unusual minting | Yes | `shielded_mints` / `unshielded_mints` rate anomaly (amounts public) | Macro |
| Wallet draining (unshielded) | Yes | Rapid `claimed_unshielded_spends` (address + amount public) | Me + Macro |
| Wallet draining (shielded) | Partial | Burst of `claimed_nullifiers` from one operator wallet (amounts hidden) | Me |
| Proof-server abuse / flood (DDoS) | Yes (operator-side) | Latency spike + queue depth on the operator's own proof server | Me |
| Indexer / node outage | Yes | Health-check failures, sync lag | Me + Macro |

**Do NOT over-promise:** zkZap catches **infrastructure + public-metadata +
volume anomalies** and aggregates **voluntary, privacy-preserving incident tags**.
It does **not** catch stealthy attacks on individual private state from the
outside — that is impossible by design, and saying otherwise would be dishonest.

---

## 3. The two lenses (one pipeline, two cameras)

```
                 ┌──────────────────────────────────────────────┐
                 │            ZKSplunk shared pipeline           │
   MidnightVitals│  Vitals → connector → HEC → Splunk index      │  Blockfrost
   (per operator)│  → SPL detections → zkZap agent → reportIncident│ (public chain)
                 └───────────────┬──────────────────┬────────────┘
                                 │                  │
                      ┌──────────▼─────────┐  ┌─────▼───────────────────┐
                      │  ZKSplunk Me       │  │  ZKSplunk Macro          │
                      │  (individual)      │  │  (ecosystem watchtower)  │
                      │  local self-monitor│  │  public-data observatory │
                      │  + zkZap response  │  │  + opt-in enrichment     │
                      └────────────────────┘  └─────────────────────────┘
```

### 3.1 ZKSplunk Me (individual / paid service) — the demo hero

- Runs MidnightVitals on the operator's **own stack** (consented self-monitoring).
- Sees local signals: failed-auth bursts, abnormal wallet coin-selection,
  proof-server abuse, local state-DB access anomalies.
- zkZap response: alert + optional SOAR action + **on-chain `reportIncident`**
  (tamper-evident "a defense fired at this block height").
- Clear customer (the DApp operator), clear value (uptime + local early-warning),
  sellable.

### 3.2 ZKSplunk Macro (ecosystem) — built primarily from PUBLIC data

Two data strategies were considered:

| Strategy | Feasibility (9 days) | Privacy friction | Verdict |
|---|---|---|---|
| **B — Public-only gleaning** (chain `Effects`, tx-failure, mint/spend metadata via Blockfrost/indexer) | **High — solo-buildable** | **None** (reads only public data; nobody shares anything) | **Hackathon floor** |
| **A — Consortium opt-in telemetry** (members share non-proprietary ops telemetry + anonymized incident tags) | Low for real members; simulatable | Requires trust + governance | **Post-hackathon ceiling** |

**Decision:** build **B as the baseline** (always-on, opt-in-free), with **A as an
optional opt-in enrichment** layer. Privacy-jealous users get value from B without
sharing; companies wanting SLA-grade coverage opt into A. The privacy-preserving
bridge for A is the existing `reportIncident` commitment: a member reports *that*
an anomaly occurred without revealing *what*.

### 3.3 How Me feeds Macro — anonymous critical-incident attestation (the novel, privacy-native part)

**Scope (redefined 2026-06-12).** Only **CRITICAL** incidents are anchored
on-chain, as **anonymous, unlinkable attestations**. Each attestation makes
exactly one thing public and hides everything else:

- **Public (network-wide awareness):** the **anonymized incident class** — the
  category of issue/attack (e.g. `proof-server-outage`, `auth-bruteforce-burst`,
  `mint-anomaly`, `block-stall`), its severity, and the block height. This is
  what lets Macro surface *"31 operators reporting `auth-bruteforce-burst` this
  hour = coordinated campaign."*
- **Hidden (never on-chain):** the operator's identity, the node / endpoint /
  DApp, addresses, latencies, and the incident payload — all of that stays in
  the operator's own Splunk. The on-chain record carries only the class + a
  commitment to the off-chain detail.

**Privacy invariant.** An on-chain observer learns *"some registered-but-
unidentified operator saw a class-X critical incident at block H"* — never
**who**, never **where**, and never in a way that **links** one report to
another or to a specific operator.

**Membership without identity.** Operators join a registered set and prove
membership in zero-knowledge: a **Merkle set-membership proof** over the
registered-operator commitment tree demonstrates *"I am an authorized monitor"*
without revealing **which** leaf. Registration publishes no per-operator public
identity. (This replaces the earlier design's public `monitors: Map<keyHash → …>`,
which only achieved *pseudonymity*.)

**Unlinkability + anti-replay.** Each critical attestation carries a one-time
**nullifier** derived from the operator's secret and the incident/epoch. The
nullifier (a) stops the same operator's reports from being linked across time and
(b) prevents replay / duplicate spam — all without revealing who reported.

**Why ZK is load-bearing here (and only here).** Tamper-evidence alone needs only
a signed hash. ZK earns its place specifically for the *anonymous, unlinkable*
property: prove set-membership and emit a class-tagged distress signal while
disclosing nothing that identifies or links the operator. That is the "awareness
without surveillance" guarantee, and the answer to the DevRel "isn't this
surveillance?" objection.

> **Implementation status.** This is the **target scope**. The current
> `contract/src/zksplunk.compact` still implements the older *pseudonymous*
> design (public `monitors` map + disclosed caller key-hash) and must be reworked
> to: (1) Merkle-membership registration, (2) a nullifier-based unlinkable
> `attestCriticalIncident(incidentClass, severity, payloadCommitment, nullifier,
> membershipProof)`, (3) a public append-only incident-class log. The specific
> Compact primitives (MerkleTree/HistoricMerkleTree ADT, nullifier via
> `persistentHash`, disclosure rules) **must be verified with `/verify`** before
> coding — treat the mechanism here as design intent, not validated Compact.

---

## 4. Is this futile? (the Jay Albert question)

- **Futile version (correctly flagged):** "centralized chain-wide SOC that catches
  hackers attacking users' private state." Impossible on a privacy chain; no
  customer owns "the chain"; nobody wants to share. **Don't pitch this.**
- **Valuable version (what we build):**
  1. **Me** — individual self-monitoring as a paid product (clear customer/value).
  2. **Macro from public data** — DevRel trust signal + incident forensics +
     systemic-anomaly detector. A public good Midnight currently lacks.

Scoped to what's physically observable, this is **not** futile.

---

## 5. zkZap response actions (detect → decide → act)

| Tier | Action | Mechanism |
|---|---|---|
| Notify | Alert operator / watcher | Splunk alert → Slack / PagerDuty |
| Record (critical only) | Anonymous, unlinkable on-chain attestation — public incident *class* only, no operator/node | `attestCriticalIncident` (Merkle membership + nullifier; *redesign — see §3.3*) |
| Throttle | Rate-limit offending caller | operator-side middleware hook (Me) |
| Quarantine | Pause a contract entry point / circuit | operator policy (Me) |
| Escalate | Status transitions open→ack→mitigated→resolved | `updateIncidentStatus` (existing) |

The contract already supports the record + escalate tiers
(`reportIncident`, `updateIncidentStatus`, `Severity`, `IncidentStatus`).

---

## 6. 9-day build plan

| Day | Focus | Output |
|---|---|---|
| 1 | Splunk Cloud trial + HEC live; pick dogfood DApp (BlindOracle) | Real index receiving events |
| 1–2 | End-to-end: Vitals → HEC → Splunk index | Live spine (#1 unbuilt item) |
| 2–3 | **Me** attack-signal detectors in adapter (failed-call counter, mint-rate, wallet-drain heuristic) | New detectors + personal alert |
| 3–4 | zkZap agent loop: Splunk MCP ↔ Midnight MCP; detect → `mnm` diagnosis → `reportIncident` | Agentic response (the winning piece) |
| 4–5 | **Macro (B)**: Blockfrost public feed → metadata → SPL aggregation dashboard | Ecosystem payoff panel |
| 5–6 | Polish: dashboards, "commitment column", zkZap panel; (stretch) Cisco Deep Time Series forecast | Product look |
| 7 | Demo video + `architecture_diagram` at repo ROOT | Submission materials |
| 8–9 | Buffer: security scrub (HEC tokens/.env), flip repo public, MVF feedback ($200), Devpost submit | Submitted |

**Effort split (shared spine already ~80% built):**
Macro POC ≈ 1.5 days · Me POC ≈ 2.5–3 days · agent loop shared.

---

## 7. Tooling

- **`midnight-manual` (`mnm`)** — ground the agent's diagnoses in *real* Midnight
  source (e.g. `ProofServerClient` health semantics, ledger `Effects`), not
  hallucinations. Already verified working.
- **`midnight-expert`** — Compact review/verify skills for any contract changes
  (validate compile on compactc 0.31 / language 0.23).
- **Splunk:** HEC (built), SPL saved searches (built), Splunk MCP Server (bonus
  hook), SOAR (response tier), AI Assistant / Cisco Deep Time Series (stretch).

---

## 8. Open decisions (need John's confirmation)

1. **Hero lens:** Me (default) vs. Macro vs. both-equal.
2. **zkZap framing:** capability inside ZKSplunk (default) vs. separate Security
   entry vs. explore-only.
3. **Macro data strategy:** public-only B (default) vs. simulate a consortium A
   for the demo.

---

*Draft by Penny 🎀 for John's review. Companion chat log:
`docs/ai-chat/2026-06-06_zkZap_security_protocol_deep_dive.md`.*
