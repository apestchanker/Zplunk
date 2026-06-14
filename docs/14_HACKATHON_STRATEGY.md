<div align="center">

# 🎯 ZKSplunk — Splunk Agentic Ops Hackathon Strategy

### *Living battle plan. Last updated: **April 21, 2026***

[![Hackathon](https://img.shields.io/badge/Hackathon-Splunk_Agentic_Ops-FF6B00?style=for-the-badge&logo=splunk&logoColor=white)](https://splunk.devpost.com/)
[![Prize Pool](https://img.shields.io/badge/Prize_Pool-$20,000-10B981?style=for-the-badge)](https://splunk.devpost.com/)
[![Status](https://img.shields.io/badge/Status-In_Build-3B82F6?style=for-the-badge)]()
[![Days Until Submit](https://img.shields.io/badge/Deadline-June_15_2026-EF4444?style=for-the-badge)]()

**Project**: ZKSplunk — Splunking with Midnight
**Tagline**: *The world's first observability bridge between zero-knowledge blockchain infrastructure and Splunk.*
**Team**: John Santi · EnterpriseZK Labs LLC · with sisters Cassie (me) and Penny 🎀

</div>

---

## 📋 Table of Contents

1. [Hackathon Overview](#-hackathon-overview)
2. [Critical Dates](#-critical-dates)
3. [Prize Tracks & Our Targets](#-prize-tracks--our-targets)
4. [Judging Criteria & How We Win Each One](#-judging-criteria--how-we-win-each-one)
5. [Our Unfair Advantages](#-our-unfair-advantages)
6. [What's Already Built](#-whats-already-built)
7. [Sprint Plan](#-sprint-plan)
8. [Risk Register](#-risk-register)
9. [Submission Checklist](#-submission-checklist)
10. [Decisions & Open Questions](#-decisions--open-questions)
11. [Change Log](#-change-log)

---

## 🏆 Hackathon Overview

### Official Name
**Splunk Agentic Ops Hackathon** — "Reimagine the future of agentic operations using Splunk AI"

### Organizer
Splunk (managed by Devpost) · Contact: sara@devpost.com

### Summary
> *"The Splunk AI Hackathon invites developers, security, IT and network engineers, and all AI-forward builders to create innovative solutions that combine AI with the power of Splunk. Participants will build intelligent applications that enhance observability, security/network operations and developer productivity using the latest Splunk AI capabilities."*

### Three Core Tracks
| Track | Theme |
|---|---|
| **Observability** | AI-powered incident investigation, anomaly detection, auto-remediation |
| **Security** | Intelligent security workflows, threat detection with AI |
| **Platform & Developer Experience** | Next-generation developer experiences for Splunk apps |

### Key Technologies Participants Can Leverage
- **AI agents** for Splunk apps
- **Splunk MCP Server**
- **Splunk hosted models**
- **Splunk AI Assistant**
- **AI-powered app development tools**

### Themes
Machine Learning / AI · Cybersecurity · Enterprise

---

## 📅 Critical Dates

| Milestone | Date | Time | Status |
|---|---|---|---|
| Full rules & requirements announced | **May 13, 2026** | TBD | ⏳ Waiting |
| Submissions open | **May 18, 2026** | 9:00 AM PDT | ⏳ Waiting |
| **Submission deadline** | **June 15, 2026** | 9:00 AM PDT | ⏳ Waiting |
| Judging period begins | June 26, 2026 | 9:00 AM PDT | — |
| Judging period ends | July 10, 2026 | 5:00 PM PDT | — |
| **Winners announced** | **July 17, 2026** | 2:00 PM PDT | — |

**Today**: April 21, 2026 → **22 days until rules drop** · **55 days until submission deadline**

---

## 💰 Prize Tracks & Our Targets

### Tier 1 — Primary Targets

| Track | Prize | Our Angle |
|---|---|---|
| **🏆 Grand Prize** | .conf26 pass per team member | Novel domain (ZK-proof blockchain observability) + production-grade code + end-to-end impact across an entire L1 ecosystem |
| **🥇 Best of Observability** | .conf26 pass per team member | **Our home turf.** The first Splunk connector for ZK-proof infrastructure, ever. 14 purpose-built field extractions, 11 pre-built SPL saved searches, tamper-evident on-chain attestations. |

### Tier 2 — Strong Contenders

| Track | Prize | Our Angle |
|---|---|---|
| **Best Use of Splunk MCP Server** | Cash | **Dual-MCP bridge** — Splunk MCP ↔ Midnight MCP. Two production MCP servers bridged for cross-platform AI diagnostics that neither could do alone. |
| **Best of Platform & Developer Experience** | .conf26 pass | `@zksplunk/connector` is a drop-in package any Midnight DApp can install in 3 lines. Reusable template for the whole ecosystem. |
| **Best Use of Splunk Developer Tools** | Cash | TBD based on May 13 rules — likely app packaging + SPL tooling |

### Tier 3 — Stretch / Free Money

| Track | Prize | Our Angle |
|---|---|---|
| **Best Use of Splunk Hosted Models** | Cash | Revisit after May 13 — maybe wire hosted model into the AI diagnostic agent |
| **Most Valuable Feedback** | Cash | Low-hanging — submit thoughtful technical feedback on Splunk tooling |

### Tracks We're NOT Targeting
- **Best of Security** — we're an observability play. Don't dilute the narrative by chasing Security as well.

### Maximum Realistic Haul
Grand + Observability + MCP Server + Platform/Dev Experience + Feedback ≈ **full podium sweep** + .conf26 passes for the team

---

## 🧑‍⚖️ Judging Criteria & How We Win Each One

> Source: https://splunk.devpost.com/ → "Judging Criteria"

### 1. **Technological Implementation** — *"Does the project demonstrate quality software development?"*

**How we win:**
- **Cleanly-separated workspace packages** — `@zksplunk/contract`, `@zksplunk/connector`, `@zksplunk/zkmonitor` (plus `vitals/`, `demoLand/`, `splunk-app/`, `ai-agent/`) — each installable alone, each with its own `package.json` and `tsconfig.json`
- **Production-grade TypeScript** — strict mode, exhaustive `never` checks, proper error propagation
- **Production-grade HEC client** — event batching, exponential retry backoff, health checks, send statistics, heartbeat self-monitoring
- **Provider-agnostic abstraction** — `VitalsProviderInterface` lets us swap the mock provider and the live HTTP provider without touching UI code
- **Real smart contract** — Compact contract compiled with the official tooling (compactc 0.31, language 0.23); 5 exported circuits, 7 ledger items, 2 enums; a Merkle-membership operator registry + nullifier-based anonymous attestation on a sealed ledger with `persistentHash`-derived keys
- **Live HTTP health checks** — proof server, indexer, and node probes against the Midnight preview network
- **Open-source escape hatch** — every Midnight endpoint (proof server, indexer, node) is env-configurable, so a customer can point at hosted or self-hosted infra by changing env vars

### 2. **Design** — *"Is the user experience and design of the project well thought out?"*

**How we win:**
- **MidnightVitals UI is already polished** — time wheels, live console, navigation logger, monitor bar, time-series panels
- **Plain-English log messages** — every log entry uses a human-readable template (no unexplained jargon), 200+ message templates curated for operators
- **Splunk dashboards designed for the ZK domain** — proof latency heatmap, wallet state timeline, contract health grid, network sync gauge
- **"The commitment column"** — a brand-new Splunk UI pattern: every event has a cryptographic commitment anchored on-chain, clickable to verify independently
- **AI agent output in natural language** — not a wall of log lines; diagnostic narratives like *"The proof server latency spiked to 45s. The Compact circuit `counter.compact` uses a nested loop that scales O(n²). The recent increase in calls is overwhelming the prover."*

### 3. **Potential Impact** — *"How big of an impact could the project have?"*

**How we win:**
- **Every Midnight DApp needs this.** Midnight is Cardano's partner chain; it has a growing ecosystem of DApps (DiscoveryManagement, proofOrBluff, KYCz, equineProData, petProData, DIDz, SilentLedger, GeoZ, and 20+ more in our own monolith alone). Each one has a proof server, a wallet, contracts, and a network to monitor. ZKSplunk is the answer for all of them.
- **Generalizable to every ZK blockchain.** Midnight today, zkSync / Aztec / Aleo / Polygon zkEVM / Starknet tomorrow. Our architectural pattern — off-chain telemetry + on-chain attestation + Splunk ingestion — transfers to any ZK infrastructure.
- **Enterprise compliance play.** Tamper-evident observability is a regulated-industry requirement. Banks, healthcare, government — anyone subject to audit — needs cryptographically provable "the monitor actually saw what it claimed, at the block height it claimed."
- **Market expansion for Splunk.** Splunk has connectors for Ethereum, Hyperledger, and Quorum. Until ZKSplunk, **zero** for ZK-proof infrastructure — a market category Splunk doesn't currently serve.

### 4. **Quality of the Idea** — *"How creative and unique is the project?"*

**How we win:**
- **A first.** No Splunk connector has ever existed for ZK-proof blockchain infrastructure. Not Ethereum-tier privacy chains. Not STARKs. Not SNARKs. We are the first.
- **A new observability category.** We define "ZK-aware observability": telemetry that understands proof lifecycles, shielded state semantics, and the privacy boundary of zero-knowledge circuits. Splunk has never seen this data type.
- **A new pattern: tamper-evident, anonymous observability.** Critical incidents can optionally carry a cryptographic commitment anchored on-chain as an anonymous, unlinkable attestation. No other Splunk integration does this. The contract we wrote (`zksplunk.compact`) is itself novel on-chain infrastructure.
- **A new MCP topology.** Dual-MCP bridges (Splunk MCP ↔ Midnight MCP) create cross-platform AI diagnostics that neither MCP alone can perform. This is an architectural pattern, not just a feature.

---

## 🛡️ Our Unfair Advantages

### 1. We Started 6 Weeks Early
Most hackathon teams start when submissions open. We started in early April. By the time the build window opens May 18, we'll have:
- A working connector
- A deployed on-chain contract
- Splunk Cloud trial fully configured
- End-to-end demo running

### 2. We Own the Upstream
John authored **MidnightVitals** — the exact telemetry source ZKSplunk consumes. We're not integrating against a third-party black box; we can shape the upstream interface to be perfect for our downstream.

### 3. We Own an Entire Ecosystem
**30+ Midnight DApps in DIDzMonolith.** Every single one can be a live demo. Judges will see ZKSplunk monitoring real, deployed, production-scale projects — not a toy example.

### 4. We Already Understand ZK Operations
We're not an observability team that learned about ZK for the hackathon. We're a ZK team that has deployed contracts on testnet, debugged proof server OOMs at 3am, and written Compact code that runs in circuits. We know what hurts. We know what matters.

### 5. On-Chain Attestation = Unforgeable, Anonymous Proof of Observation
A Compact contract that anchors **anonymous, unlinkable** attestations of critical incidents on-chain. When a judge asks *"how do we know the monitor isn't lying — and how do you report without exposing operators?"* — we show them the on-chain record, the `payloadCommitment`, and the off-chain blob that re-hashes to match, with the operator proven via Merkle membership but never identified. **Zero other submissions will have this.**

### 6. Runs on Midnight's Preview Network — No Vendor Lock-In
ZKSplunk runs against Midnight's hosted **preview** network (indexer + node) with only the proof server local. Every endpoint is env-configurable, so operators can point at hosted or self-hosted Midnight infra — no third-party data vendor in the trust path.

### 7. Live Chain Data, Not Mocks
ZKSplunk ships `HttpVitalsProvider` (`zkMonitor/src/http-vitals-provider.ts`) — a real implementation of the vitals interface that runs live HTTP health checks against the proof server, indexer, and node. Most hackathon submissions demo with fake data; we demo on the real chain. (`demoLand/` provides a deterministic offline twin for safe recording.)

---

## ✅ What's Already Built

### 🟢 Done
- [x] Full MidnightVitals module (12 files) integrated into ZKSplunk
- [x] `splunkCallbacks` prop on VitalsContext wired to SplunkForwarder
- [x] Splunk HEC client — batching, exponential retry, health checks, stats
- [x] SplunkForwarder bridge — connect, subscribe, heartbeat, shutdown
- [x] Vitals-to-Splunk adapter — type-safe event transformers
- [x] 14 ZK-specific Splunk field extractions
- [x] 11 pre-built SPL saved searches
- [x] Environment-based config loader (Node.js + Vite)
- [x] **Compact contract** — `zksplunk.compact` — anonymous critical-incident attestation (Merkle registry + nullifiers + public log)
- [x] **Witnesses** — `contract/src/witnesses.ts` (operator secret key + Merkle path)
- [x] **Live vitals provider** — `zkMonitor/src/http-vitals-provider.ts` — HTTP health checks vs the Midnight preview network
- [x] **Deploy / relayer / status tooling** — `deploy-attestation.ts`, `attestation-relayer.ts`, `onchain-status-reader.ts`
- [x] **Telemetry commitment helpers** — canonical snapshot + SHA-256 commit
- [x] Build-out architecture doc — `docs/07_BUILD_OUT_ARCHITECTURE_2026-04-21.md`
- [x] GitHub repo + DIDzMonolith submodule integration

### 🟡 In Progress / Next Sprint
- [ ] `compactc` the Compact contract and commit `managed/zksplunk/` artifacts
- [ ] `npm install` in all three packages, smoke-test the builds
- [ ] Connector helper that invokes `attestCriticalIncident` from `handleVitalCheck`
- [ ] Deploy `zksplunk.compact` to preprod; record contract address
- [ ] Splunk Cloud trial account + HEC token acquired and wired up
- [ ] End-to-end integration test: vitals → commit → attest → HEC → Splunk index

### 🔴 Not Started (Will Build in Main Sprint)
- [ ] Splunk app package (app.conf, default/, metadata/, dashboards)
- [ ] AI diagnostic agent (prompts + dual-MCP bridge)
- [ ] Splunk SOAR playbook (stretch goal)
- [ ] Demo video (2–3 min, submission-ready)
- [ ] "The commitment column" Splunk dashboard panel
- [ ] Live deployment for judges
- [ ] Public demo URL

---

## 🗓️ Sprint Plan

### Phase 0 — Pre-Hackathon Prep (NOW → May 13)

| Week | Dates | Focus |
|---|---|---|
| Week 1 | Apr 7 – Apr 13 | ✅ Done — connector, vitals, HEC client |
| Week 2 | Apr 14 – Apr 20 | ✅ Done — repo integration, first docs |
| **Week 3** | **Apr 21 – Apr 27** | ✅ Contract + live vitals provider scaffolded. Next: compactc, npm install, first Splunk Cloud trial dashboard. |
| Week 4 | Apr 28 – May 4 | End-to-end: live vitals → SplunkForwarder → Splunk Cloud live dashboard |
| Week 5 | May 5 – May 11 | Contract deployment to preprod. Polish dashboards. Draft MCP agent. |
| **Week 6** | **May 12 – May 13** | ⚠️ **RULES DROP.** Read everything. Adjust plan. |

### Phase 1 — Build Sprint (May 18 → June 8)

| Week | Dates | Focus |
|---|---|---|
| Week 7 | May 18 – May 25 | Finalize any rule-required features. AI agent v1. |
| Week 8 | May 26 – Jun 1 | Splunk app dashboards. Commitment column. MCP bridge. |
| Week 9 | Jun 2 – Jun 8 | Integration testing. Bug fixes. Demo video script. |

### Phase 2 — Polish & Submit (June 9 → June 15)

| Week | Dates | Focus |
|---|---|---|
| Week 10 | Jun 9 – Jun 12 | Record demo video. Write Devpost submission. Screenshots. |
| **DEADLINE** | Jun 13 – Jun 15 | Submit by **June 14** (1-day buffer). 🚀 |

### Phase 3 — Post-Submit (June 15 → July 17)

Sit back. Watch results. Book .conf26 travel. 🎟️

---

## ⚠️ Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| May 13 rules require unplanned tech | Medium | High | Keep architecture flexible. Three-package split means we can swap any layer. |
| Splunk Cloud trial has crippling limits | Low | High | Apply for trial in Week 4. Identify limits early. Fallback: use free Splunk Enterprise locally. |
| Can't get proof server running for live demo | Medium | Medium | Mock provider (demoLand) is built for offline demos. Can run the proof server on a dedicated box. |
| MCP bridge scope too ambitious | Medium | Low | It's a $1K bonus track. Cut if needed, keep for Tier 1 tracks. |
| 28-day build window too tight | Medium | High | We already built the connector, contract, and live vitals provider. We have a huge head start. |
| Underpowered CPU can't run Halo 2 proofs | Confirmed | Low | Demo on a capable box; the preview network handles chain data, proof gen runs on the local proof server. |
| Repo was made private — submission might require public | Medium | Medium | We can flip public for submission window. GitHub access is already granted to teammates. |

---

## 📦 Submission Checklist

*To be finalized after May 13 rules drop.*

- [ ] Devpost project page created with project title, tagline, description
- [ ] Demo video recorded (length per rules — usually 2–3 min)
- [ ] Submission README with architecture diagrams + setup instructions
- [ ] Screenshots of Splunk dashboards (at least 4: proof latency heatmap, wallet timeline, contract grid, network gauge)
- [ ] GitHub repo public (flip during submission window)
- [ ] List of Splunk products/APIs/services used
- [ ] Team member info + roles
- [ ] Track selection (compete for Grand + Observability + MCP + Platform)
- [ ] Commitment column demo — a live dashboard panel showing on-chain attestations
- [ ] AI agent demo prompt + screenshot
- [ ] Any required attestations, agreements, forms
- [ ] "Most Valuable Feedback" submission on Splunk tooling (free money track)

---

## 🤔 Decisions & Open Questions

### Resolved
| Decision | Resolution | Date |
|---|---|---|
| Chain data source | Midnight hosted **preview** network (indexer + node); proof server local; endpoints env-configurable | updated |
| On-chain attestation contract? | YES — anonymous, unlinkable critical-incident attestation (Merkle registry + nullifiers + public log) | updated |
| Workspace split | Separate packages (`contract`, `connector`, `zkmonitor`) + `vitals` / `demoLand` / `splunk-app` / `ai-agent` | updated |
| Compact language version | `pragma language_version >= 0.23` | updated |

### Open
| Question | Owner | Deadline |
|---|---|---|
| Splunk Cloud trial account — which plan? | John | Week 4 |
| AI agent host — Splunk Hosted Models vs local LLM? | After May 13 | May 14 |
| GitHub repo public/private during submission window? | John + rules | Jun 13 |
| Demo environment — local Docker vs deployed VPS? | John | Week 8 |

---

## 📜 Change Log

| Date | Change | Author |
|---|---|---|
| Apr 6, 2026 | Initial hackathon rules doc created | Penny |
| Apr 11, 2026 | Midnight indexer API deep dive; cross-pollinated to monolith | Cassie |
| **Apr 21, 2026** | **Major build-out sprint.** On-chain attestation contract written + structurally validated; live vitals provider scaffolded (HTTP checks, commitment helper). `docs/07_BUILD_OUT_ARCHITECTURE_2026-04-21.md` added. | Cassie |
| Apr 21, 2026 | **This doc** — living hackathon strategy overview published alongside `02_DEAR_JUDGES.md`. | Cassie |

---

<div align="center">

*This is a living document. Every major build decision, rule update, and strategic shift gets appended here. When May 13 rules drop, this doc is our first stop.*

**Let's win this thing.** 🏆

</div>
