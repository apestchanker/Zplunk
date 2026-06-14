# ZKSplunk — Synopsis for Alex P.

> **Welcome!** This is a one-page onboarding so you can get oriented fast and
> start helping us connect **Midnight** to **ZKSplunk**.
> Written by Penny (John's AI pair) on 2026-06-09. Questions → ping John.

---

## 1. What ZKSplunk is (in two sentences)

**ZKSplunk is the first observability bridge between a zero-knowledge blockchain
(Midnight) and Splunk.** It streams telemetry about Midnight's ZK-proof
infrastructure (proof server, indexer, wallet, contracts) into Splunk, where
dashboards and AI analyst tabs turn it into monitoring and operator guidance.
**zkZap** is the security layer on top: it re-reads that telemetry as threat
signals (proof floods, brute-force bursts, mint anomalies, wallet drains) and
can anchor critical demo incidents as anonymous Midnight attestations.

> Tagline: *ZKSplunk observes; zkZap responds.*

It's our entry for the **Splunk Agentic Ops Hackathon** (sponsor: Cisco).
**Hard deadline: June 15, 2026, 12:00 PM EDT.** We're in polish week.

---

## 2. The privacy ground rule (important for the connection work)

Midnight is a privacy chain. The rule that governs everything we collect:

> **Metadata and volumes are public. Contents are private.**

So we CAN see: which contract + circuit fired and how often, mint amounts,
unshielded transfers (address + amount), shielded spend *activity*, block
cadence, tx success/failure. We CANNOT see: private state, circuit arguments, or
the parties/amounts of *shielded* transfers. Full detail:
`docs/PUBLIC_LEDGER_OBSERVABILITY.md`.

We never claim to monitor private state. That honesty is part of the pitch.

---

## 3. The architecture (where Midnight meets Splunk)

```
   Midnight preview/local            ZKSplunk connector            Splunk
   ┌────────────────────┐      ┌──────────────────────┐     ┌──────────────────┐
   │ node / RPC          │      │ vitals-adapter        │     │ HEC ingest        │
   │ indexer GraphQL     │ ───► │ hec-client (batch)    │ ──► │ index=zksplunk    │
   │ proof server :6300  │ poll │ on-chain status read  │ HEC │ SPL + dashboards  │
   └────────────────────┘      │ attestation-client    │     │ AI agent (MCP)    │
                               └──────────┬───────────┘     │ AI Toolkit tab   │
                                          │                 │ MCP fallback tab  │
                                          ▼                 └────────┬─────────┘
                             relayer + zksplunk.compact ────────────┘
```

Three data paths into Splunk:
1. **Vitals** — live HTTP health checks against proof server / indexer / wallet / contracts.
2. **Public chain data** *(planned — the Macro lens)* — block / contract-action / mint / spend events via the Midnight indexer.
3. **On-chain attestation status** — `zksplunk:onchain` events from the read-only status reader, plus `zksplunk:relayer` events from the funded relayer.

---

## 4. What's already built (TypeScript, type-checked)

| Module | Status | What it does |
|---|---|---|
| `connector/src/hec-client.ts` | ✅ | Splunk HEC client: batching, exponential retry, health check |
| `connector/src/splunk-forwarder.ts` | ✅ | Lifecycle (connect / heartbeat / shutdown) |
| `connector/src/vitals-adapter.ts` | ✅ | Transforms vital checks → Splunk HEC events |
| `connector/src/field-extractions.ts` | ✅ | 14 ZK-specific field extractions + 11 SPL saved searches |
| `connector/src/attestation-client.ts` + `telemetry-commitment.ts` | ✅ | Anchor off-chain telemetry commitments on-chain |
| `contract/src/zksplunk.compact` | ✅ | Sealed-ledger Compact contract: Merkle-membership operator registry + nullifier-based anonymous critical-incident attestation |
| `demoLand/` | ✅ | Offline simulated runner + zkZap attack scenarios + an HTML metrics dashboard |
| `zkMonitor/` | ✅ demo runtime | Live vitals → real HEC wiring, deploy/register helper, relayer, and read-only on-chain status reader |
| `splunk-app/zksplunk` | ✅ | Global Map with KPI strip, Overview, MCP Analyst, AI Toolkit Analyst, and zkZap Attestation dashboards |

---

## 5. Where YOU come in — connecting Midnight to ZKSplunk

This is the highest-value remaining work. Pick whatever fits your strengths:

### A. Stand up or refresh the live pipeline
- Stand up Splunk, create/use the `zksplunk` index, and configure a HEC token.
- Point `zkMonitor/.env` at Splunk plus the Midnight preview network endpoints.
- Run `npm run start` for vitals, `npm run relayer` for critical attestation submission, and `npm run onchain-status` for the read-only contract status feed.
- Confirm the Global Map KPI strip and zkZap Attestation dashboard populate from `midnight:vitals`, `zksplunk:connector`, `zksplunk:relayer`, and `zksplunk:onchain`.
- Network note: the node and indexer use Midnight's hosted **preview** network; only the proof server runs locally (`:6300`). See `docs/BLOCKCHAIN_PIPELINE_SETUP.md`.

### B. `connector/src/attack-signals.ts` (the detection brain — not built yet)
- A rolling-window enrichment that turns raw public `Effects` (failed calls, mint rates, unshielded spends) into `attack_signal` fields for SPL.
- Spec + threat→signal mapping: `docs/PUBLIC_LEDGER_OBSERVABILITY.md` and `docs/DEVREL_SPLUNK_HEALTH_AND_ATTACK_DETECTION.md`.

### C. Wire the Midnight indexer feed into HEC events (the "Macro" lens — future)
- Build a subscriber over the Midnight indexer GraphQL (block / contract-action / mint / spend) that emits HEC events for the ecosystem dashboard. Not built yet.

### D. `connector/src/splunk-rest-client.ts` (nice-to-have, scriptable setup)
- Splunk REST (`:8089`): login → create index → create HEC token → run SPL. Endpoint map in `docs/SPLUNK_API_INTEGRATION.md`.

---

## 6. Sources of truth for Midnight (please use these)

- **Idris Midnight MCP** (primary), cross-checked against **midnight-expert** and **midnight-manual**.
- **docs.midnight.network** + the hosted **Compact playground**.
- Compiler: **compactc 0.31.0** (language 0.23). Pragma: `pragma language_version >= 0.23;`.

Don't trust older exploratory code without verifying against the above.

---

## 7. Quick start (5 minutes)

```bash
git clone https://github.com/bytewizard42i/ZKSplunk_Splunking_w_Midnight.git
cd ZKSplunk_Splunking_w_Midnight

# See the whole pipeline run offline, no infra needed:
cd demoLand && npm install && npm run demo:dashboard
#   → open out/dashboard.html (4 tabs: proof latency, zkZap incidents, vital health, attestations)

# Then read, in order:
#   README.md
#   docs/PUBLIC_LEDGER_OBSERVABILITY.md   (what we can see on-chain)
#   docs/SPLUNK_API_INTEGRATION.md        (ports + endpoints + local bring-up)
#   docs/ZKZAP_SECURITY_PROTOCOL.md       (the security layer)
```

---

## 8. Logistics / heads-up

- **Hackathon team cap is 2 people.** Worth a quick chat with John on whether you join as the official 2nd team member or contribute as a collaborator — it affects the Devpost submission.
- Repo is currently **private**; it goes public before the deadline (after a secret scrub). Ask John for access.
- Stack: TypeScript / Node ≥ 22, Compact for the contract, Splunk HEC + SPL on the analytics side.

Thanks for jumping in — the live Midnight↔Splunk wiring (Section 5A) is exactly
the piece that takes us from "great demo" to "great submission." 🎀
