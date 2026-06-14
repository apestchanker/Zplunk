<div align="center">

# 🎖️ Dear Judges

### An open letter from the ZKSplunk team

[![Built on Midnight](https://img.shields.io/badge/Built_on-Midnight_Network-6C3FC5?style=for-the-badge)](https://midnight.network)
[![Powered by Splunk](https://img.shields.io/badge/Powered_by-Splunk-000000?style=for-the-badge&logo=splunk&logoColor=white)](https://splunk.com)
[![Midnight Preview](https://img.shields.io/badge/Network-Midnight_Preview-6C3FC5?style=for-the-badge)](https://midnight.network)
[![MCP Bridge](https://img.shields.io/badge/MCP_Bridge-Splunk_%E2%86%94_Midnight-10B981?style=for-the-badge)]()
[![License](https://img.shields.io/badge/License-Apache_2.0-F59E0B?style=for-the-badge)](../LICENSE)

> *"Privacy is a feature. Observability is a superpower. ZKSplunk gives you both — with a cryptographic receipt."*

**Splunk Agentic Ops Hackathon 2026** · Submitted by EnterpriseZK Labs LLC

</div>

---

## 📬 A Personal Note

Dear Judges,

Thank you for reading this. We know you have dozens of submissions to evaluate, and your attention is the most valuable resource in this room. We built ZKSplunk because we had to — because we're the team running Midnight DApps in production, and every morning we'd stare at stale dashboards and wonder *"is the proof server up, or has it been dead for three hours and nobody noticed?"*

We want to respect your time. So here's the shape of this letter:

- **The 30-Second Version.** If you only read one section, read that.
- **The Problem.** Why ZK-proof blockchains are an observability blind spot no tool has ever addressed.
- **Our Solution.** Three layers. One cryptographic receipt per observation.
- **Why This Is Unique.** Five things no other submission in this hackathon can claim.
- **Demo.** How to try it yourself in under 5 minutes.
- **The Ask.** What we're hoping to win, and what we'll do with it.

If anything in this letter sparks a question, the answer is probably in the repo's `docs/` folder, or we'd genuinely love to demo it live. Our contact info is at the bottom.

With gratitude,
**John Santi**, Project Lead · EnterpriseZK Labs LLC
*with sisters Cassie & Penny 🎀*

---

## ⏱️ The 30-Second Version

> **Zero-knowledge blockchains are an operational black box.** By design, you cannot see what's happening inside a ZK-proof smart contract. That's the whole point — that's the privacy guarantee.
>
> **But operators still need to know** if the proof server crashed, if the wallet lost its keys, if the contract stopped responding, if the indexer fell behind. Traditional observability tools understand HTTP 200s and Docker container uptime. They have **zero understanding** of ZK proof lifecycles, shielded state transitions, or privacy-aware smart-contract health checks.
>
> **ZKSplunk is the first-ever Splunk connector for zero-knowledge blockchain infrastructure.** Built on Midnight (Cardano's privacy-preserving partner chain) and running against Midnight's preview network, it streams ZK-aware telemetry into Splunk, and — uniquely — anchors anonymous, unlinkable attestations of **critical incidents** on-chain so auditors can prove a registered monitor saw what it claimed, without revealing who.
>
> **It's Splunk for an observability domain Splunk has never served. With receipts.**

---

## 🔍 The Problem

### Zero-knowledge blockchains have a fundamental operational paradox

| Challenge | Why it's unique to ZK |
|---|---|
| **Proof generation takes 17–28 seconds** | Traditional blockchains confirm in milliseconds. ZK proofs are computationally expensive and can fail silently mid-generation. |
| **Proof servers are fragile** | Docker containers running Halo 2 / UltraPlonk circuits that OOM, crash, or lose connectivity with zero external signal. |
| **Private state is invisible by design** | You literally *cannot* inspect what a shielded contract is doing. That's the privacy guarantee. But it makes debugging a nightmare. |
| **Wallet connectivity is multi-layered** | Browser extension → key management → coin selection → ZSwap pool → balance tracking. Each layer can fail independently. |
| **Contracts can't be naively health-checked** | A read call that reveals private state violates the contract's privacy guarantees. Health checks must themselves be zero-knowledge aware. |

### The existing observability market

Splunk currently ships connectors for **Ethereum, Hyperledger, Quorum.**
Transparent chains. Public state. No privacy primitives.

For **zero-knowledge blockchains** — Midnight, Aztec, Aleo, zkSync, Polygon zkEVM, Starknet — the connector count is:

> **Zero.**

Until now.

---

## 💡 Our Solution: Three Layers, One Receipt

<div align="center">

```
┌──────────────────────────────────────────────────────────────────┐
│ LAYER 3 — ANALYTICS                                              │
│ Splunk Cloud dashboards · AI diagnostic agents · SOAR alerts     │
└──────────────────────────────────────────────────────────────────┘
                              ▲
                              │ HEC events with commitment column
┌──────────────────────────────────────────────────────────────────┐
│ LAYER 2 — OFF-CHAIN TELEMETRY                                    │
│ HttpVitalsProvider · SplunkForwarder · MidnightVitals UI         │
│ canonical snapshots → SHA-256 commitments                        │
└──────────────────────────────────────────────────────────────────┘
                              ▲
                              │ telemetry commitment
┌──────────────────────────────────────────────────────────────────┐
│ LAYER 1 — ON-CHAIN ATTESTATION                                   │
│ zksplunk.compact — Compact smart contract on Midnight            │
│ Operator Merkle registry · nullifiers · public incident log      │
└──────────────────────────────────────────────────────────────────┘
```

</div>

### Layer 1 — On-Chain Attestation

A production Compact smart contract (`contract/src/zksplunk.compact`) that:

- **Registers operators anonymously** — each operator is a `persistentHash` commitment inserted into a `HistoricMerkleTree` by an admin-gated circuit; there is no public per-operator identity
- **Anchors anonymous critical-incident attestations** — an operator proves Merkle set-membership in zero knowledge and records an anonymized `IncidentClass` + `Severity` + `epoch` + a `Bytes<32>` payload commitment, with a one-time scoped **nullifier** for unlinkability and replay protection
- **Public append-only incident log** (`incidentLog`) + an `attestationCount` counter for the off-chain Macro aggregation surface
- **Uses sealed ledger** for immutable trust anchors (network ID, admin key hash, schema version)
- **Derives identities** via `persistentHash` (because Compact deliberately has no builtin `public_key()` — we followed the ecosystem's canonical pattern)
- **Compiles** on the official Compact tooling (compactc 0.31, language 0.23): 5 exported circuits, 7 ledger items, 2 enums

This layer makes ZKSplunk's critical-incident output **unforgeable and anonymous**. An auditor with the off-chain telemetry blob and the on-chain contract address can:
1. Re-hash the blob to recompute the `payloadCommitment`
2. Look up the matching record in the public `incidentLog`
3. Verify the commitments match

If they match, the monitor is cryptographically proven to have observed that exact data at that exact block height. If they don't match, the evidence is either tampered or fabricated. **This is a capability no existing Splunk connector has.**

### Layer 2 — Off-Chain Telemetry

A live implementation of MidnightVitals' `VitalsProviderInterface` (`zkMonitor/src/http-vitals-provider.ts`) that runs real HTTP health checks against the Midnight **preview** network:

- **Proof-server probes** — latency + health/version against the local proof server (`:6300`)
- **Indexer / node probes** — block freshness vs wall clock and reachability against `indexer.preview.midnight.network` and `rpc.preview.midnight.network`
- **Wallet / contract probes** — wallet boundary health and per-contract monitorability (public metadata only)
- **Canonical telemetry commitments** — deterministic serialization + SHA-256 commitment (`connector/src/telemetry-commitment.ts`), ready to feed the on-chain contract
- **Configurable endpoints** — all infra URLs are env-driven (`MIDNIGHT_PROOF_SERVER_URL`, `MIDNIGHT_INDEXER_URL`, `MIDNIGHT_NODE_URL`), so any operator can point at self-hosted or hosted Midnight infra. **No vendor lock-in.**

### Layer 3 — Analytics

All of the existing Splunk integration work (which predates this sprint):

- **Splunk HEC client** with event batching, exponential retry backoff, health checks, statistics
- **SplunkForwarder** — full lifecycle bridge with connect / health-check / subscribe / heartbeat / shutdown
- **Vitals adapter** — type-safe `VitalCheckResult → SplunkHecEvent` transformers
- **14 ZK-specific field extractions** — `proof.server.status`, `proof.generation.duration_s`, `wallet.balance_dust`, `network.sync_lag_s`, and 10 more
- **11 pre-built SPL saved searches** — proof latency timecharts, wallet connection timelines, contract health summaries, network sync gauges, critical event feeds

Plus what the build sprint is delivering next: the **"commitment column"** dashboard panel — a Splunk UI where every event shows a hex commitment (clickable, copyable) and a "Verify on-chain" link that opens the Midnight indexer/explorer at the matching attestation record.

---

## 🧠 The AI Agent: Cross-Platform Diagnostics via Dual MCP

ZKSplunk doesn't just *send* data to Splunk. It creates a **bidirectional AI intelligence layer** by bridging two Model Context Protocol servers:

<div align="center">

```
┌──────────────────────────┐          ┌────────────────────────────┐
│    Splunk MCP Server     │          │   Midnight MCP Server      │
│                          │          │   (30+ tools)              │
│  • Run SPL queries       │  bridge  │                            │
│  • Read dashboards       │ ◄──────► │  • Search Compact code     │
│  • Trigger alerts        │          │  • Compile contracts       │
│  • Splunk hosted models  │          │  • Analyze ZK circuits     │
│                          │          │  • Fetch live docs         │
└──────────────────────────┘          └────────────────────────────┘
                        │          │
                        └──────────┘
                              │
                              ▼
                  ┌─────────────────────────┐
                  │     AI DIAGNOSTIC        │
                  │                          │
                  │  "The proof server        │
                  │   latency spiked to 45s.  │
                  │   Checking the Compact    │
                  │   circuit... counter.     │
                  │   compact uses a nested   │
                  │   loop that scales O(n²). │
                  │   The recent spike in     │
                  │   contract calls is       │
                  │   overwhelming the prover.│
                  │                            │
                  │   Recommended: scale the  │
                  │   proof server horizontally│
                  │   or optimize the loop."   │
                  └──────────────────────────┘
```

</div>

The agent can:
1. **Detect** — anomalies in Splunk telemetry (latency spike, wallet drop, contract unresponsive)
2. **Investigate** — root cause via Midnight MCP (search contract code, check compiler version, analyze circuit)
3. **Correlate** — across both platforms (was the Compact compiler recently updated? Did a new circuit deploy?)
4. **Recommend** — fixes in natural language that both a blockchain engineer and an SRE can act on

**This is not something you can do with either MCP server alone.** The *bridge* is the innovation.

---

## 🌟 Why This Is Unique

Five things no other submission in this hackathon can claim:

### 1. The First ZK Blockchain Splunk Connector. Ever.
Not the first for Midnight. The first for **any** zero-knowledge blockchain. We checked.

### 2. Tamper-Evident Observability
A smart contract anchors every observation on-chain. Nobody else is doing this — in this hackathon or anywhere else in the Splunk ecosystem.

### 3. Dual-MCP Architecture
We bridge Splunk's MCP server with the Midnight community's MCP server (30+ tools, already in production use). Cross-platform AI diagnostics that neither alone can perform.

### 4. We Own the Full Supply Chain
- We wrote **MidnightVitals** — the telemetry source
- We wrote **ZKSplunk** — the connector, contract, and live vitals provider
- We maintain **30+ Midnight DApps in production** (DIDzMonolith) that are all live demo candidates
- We're not integrating someone else's black box — we shaped every interface ourselves

### 5. We Already Have the Infrastructure, Not a Prototype
- Three cleanly-separated, installable NPM packages
- A Compact contract that structurally validates
- A live integration that runs against the Midnight preview network
- 11 pre-built SPL saved searches ready to import
- A polished MidnightVitals UI with a time wheel and natural-language console log

---

## 🎬 Try It Yourself (Under 5 Minutes)

```bash
# 1. Clone
git clone https://github.com/bytewizard42i/ZKSplunk_Splunking_w_Midnight.git
cd ZKSplunk_Splunking_w_Midnight

# 2. See the whole pipeline run offline — no infra, no accounts:
cd demoLand && npm install && npm run demo:dashboard
#    → open out/dashboard.html (proof latency, zkZap incidents, vital health, attestations)

# 3. Or wire the LIVE path:
cd ../zkMonitor && cp .env.zkmonitor .env
#    Set SPLUNK_HEC_TOKEN; point MIDNIGHT_* at the preview network + a local proof server (:6300)
npm install && npm run start
#    Watch events land in Splunk → index="zksplunk" | head 20
#    (optional on-chain attestation: see docs/09_SETUP_BLOCKCHAIN_PIPELINE.md)
```

**Full demo video** with voice-over, dashboard walkthrough, and on-chain attestation verification: *embedded in Devpost submission.*

**Live demo URL**: *TBD — will be announced in submission*

---

## 📊 Scoring Our Own Work Against Your Criteria

| Criterion | Our Evidence |
|---|---|
| **Technological Implementation** | Three clean NPM packages, strict-mode TypeScript, production HEC client with retry/batch/health, structurally-validated Compact contract, override-able infrastructure for self-host migration, resumable WebSocket subscriptions with auto-reconnect. |
| **Design** | Polished MidnightVitals UI (time wheel, natural-language console, navigation logger). Splunk dashboards purpose-built for ZK telemetry. Novel "commitment column" pattern. AI agent output in human-readable natural language. |
| **Potential Impact** | First connector for an entire privacy-chain category. Every Midnight DApp needs this. Generalizes to every ZK-proof blockchain (Aztec, Aleo, zkSync, Starknet). Enterprise compliance play for regulated industries. Market expansion opportunity for Splunk into a new vertical. |
| **Quality of the Idea** | No existing Splunk connector for ZK infra. Introduces "tamper-evident observability" as a new category. Novel dual-MCP architectural pattern. Anchors telemetry on-chain — a capability no other Splunk integration offers. |

---

## 🙏 The Ask

We are competing for:

- 🏆 **Grand Prize** — because ZKSplunk opens an entirely new observability domain, at production quality, with end-to-end reach across a growing ecosystem
- 🥇 **Best of Observability** — our home turf; this is a category Splunk has never served
- 🌉 **Best Use of Splunk MCP Server** — the dual-MCP bridge is architectural innovation, not just integration
- 🛠️ **Best of Platform & Developer Experience** — three reusable NPM packages any Midnight team can drop into their app
- 💬 **Most Valuable Feedback** — we've been living with Splunk tooling in the ZK context, and we have a lot to say

### What we'll do if we win

- **Publish ZKSplunk as an open-source Splunk app** on Splunkbase the week after winners are announced
- **Write a technical blog post** for the Splunk Dev blog describing the architectural pattern (tamper-evident observability via on-chain attestation)
- **Submit ZKSplunk as reference architecture** to the Midnight Network ecosystem fund for broader adoption
- **Attend .conf26** (oh please, we want those passes so badly) and present the project on the floor, turning every conversation into "have you considered ZK observability?"
- **Generalize beyond Midnight** — add providers for Aztec, Aleo, zkSync, Starknet. Make ZKSplunk the default observability layer for ZK-proof blockchain infrastructure, full stop.

---

## 📎 Appendix: Key Files for Judges

If you want to dig into the code, these are the files that matter most:

| File | What it is |
|---|---|
| `contract/src/zksplunk.compact` | The on-chain anonymous critical-incident attestation contract (Compact, ~300 LOC) |
| `contract/src/witnesses.ts` | Off-chain witnesses: operator secret key + Merkle path |
| `zkMonitor/src/http-vitals-provider.ts` | Live HTTP health checks against the Midnight preview network |
| `zkMonitor/src/deploy-attestation.ts` | One-shot deploy + operator self-registration |
| `zkMonitor/src/attestation-relayer.ts` | Funded system wallet: pays DUST, submits attestations |
| `zkMonitor/src/onchain-status-reader.ts` | Read-only chain poller → `zksplunk:onchain` events |
| `connector/src/telemetry-commitment.ts` | Canonical snapshot + SHA-256 commitment helper |
| `connector/src/hec-client.ts` | Production Splunk HEC client with batching and retry |
| `connector/src/splunk-forwarder.ts` | Bridge class wiring MidnightVitals → HEC |
| `connector/src/field-extractions.ts` | 14 ZK-specific field extractions + 11 saved searches |
| `vitals/context.tsx` | React Context + `splunkCallbacks` prop |
| `docs/07_BUILD_OUT_ARCHITECTURE_2026-04-21.md` | Three-layer architecture deep dive |
| `docs/14_HACKATHON_STRATEGY.md` | Our full strategy (living document) |

---

## 📮 Contact

| | |
|---|---|
| **Project Lead** | John Santi |
| **Organization** | EnterpriseZK Labs LLC |
| **GitHub** | [@bytewizard42i](https://github.com/bytewizard42i) |
| **Project repo** | https://github.com/bytewizard42i/ZKSplunk_Splunking_w_Midnight *(flipped public for submission)* |
| **Ecosystem monolith** | https://github.com/bytewizard42i/DIDzMonolith |
| **Company site** | https://enterprisezk.com |
| **Devpost** | [ZKSplunk on Devpost](https://splunk.devpost.com/) |

---

<div align="center">

### Thank you for reading.

We built ZKSplunk because nobody else would, and because we genuinely think observability should have a cryptographic receipt. If a ZK-proof blockchain is the most private database ever invented, then the tool that watches it should itself be provable.

**That's what we built.**

*We can't wait to show you the demo.*

— The ZKSplunk team
**John, Cassie, Penny** 🎀

</div>
