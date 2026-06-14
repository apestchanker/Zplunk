# Splunk AI Hackathon 2026 — Rules, Deadlines & Battle Plan

> **Project**: ZKSplunk — Splunking with Midnight  
> **Devpost**: https://splunk.devpost.com/  
> **Registration**: https://bit.ly/splunkai26d  
> **Managed by**: John Santi + Penny 🎀

---

## Quick Reference

| Milestone | Date | Time | Status |
|-----------|------|------|--------|
| Full rules & requirements announced | **May 13, 2026** | — | ✅ DONE (parsed into our docs May 14) |
| Registration period | **Mar 27 → Jun 15, 2026** | 12:00 PM PDT → 9:00 AM PDT | ✅ Registered |
| Submissions open | **May 18, 2026** | 9:00 AM PDT / 12:00 PM EDT | ✅ OPEN |
| **Submission deadline** | **June 15, 2026** | 9:00 AM PDT / 12:00 PM EDT | ⏳ 12 days out |
| Feedback period | May 18 → **Jun 19, 2026** | 9:00 AM PDT both ends | ⏳ Open |
| Judging period begins | **June 26, 2026** | 9:00 AM PDT | — |
| Judging period ends | **July 10, 2026** | 5:00 PM PDT | — |
| **Winners announced** | **July 17, 2026** | ~2:00 PM PDT / 5:00 PM EDT | — |

**Build window**: May 18 → June 15 = **28 days**  
**Today**: June 3, 2026 → **MIDPOINT**. Submissions are open; **12 days until deadline**. Devpost sent the halfway-mark reminder (build a <3 min demo video, public repo + license, architecture diagram).

**Sponsor**: Cisco Systems, Inc. · **Administrator**: Devpost, Inc.

---

## Prize Tracks & Our Targets (CONFIRMED May 13, 2026)

> ⚠️ **Important rule**: a single project may win **at most one** Grand prize **and** **at most one** Bonus prize. Stacking Grand + a Bonus is allowed; stacking two Bonuses is not.

### Tier 1 — Primary Targets

| Track | Prize | Winners | Our Angle |
|-------|-------|---------|-----------|
| **🏆 Grand Prize** | **$7,000** + .conf26 pass per team member | 1 | Novel domain (ZK blockchain) + full-stack impact, cross-track |
| **Best of Observability** | $3,000 + .conf26 pass per team member | 1 | **Our home turf** — first Splunk connector for ZK-proof infrastructure |

### Tier 2 — Bonus Prizes (pick one to stack with the Grand)

| Track | Prize | Winners | Our Angle |
|-------|-------|---------|-----------|
| **Best Use of Splunk MCP Server** | $1,000 | 1 | Splunk MCP ↔ Idris (Midnight) MCP bridge for AI-driven cross-domain diagnostics |
| **Best Use of Splunk Developer Tools** | $1,000 | 1 | Stretch — clean SDK usage + App Inspect validation of our Splunk app |
| **Best Use of Splunk Hosted Models** | $1,000 | 1 | Cisco Deep Time Series Model for ZK proof-latency forecasting (now interesting; reconsider) |

### Tier 3 — Individual Prize (not project-bound)

| Track | Prize | Winners | Our Angle |
|-------|-------|---------|-----------|
| **Most Valuable Feedback** | $200 | 5 | Submit thoughtful, actionable feedback during the Feedback Period. Per-individual, not project. |

### Tracks We're NOT Targeting

| Track | Prize | Why Not |
|-------|-------|---------|
| Best of Security | $3,000 | Crowded field, security ops isn't our pitch |
| Best of Platform & Developer Experience | $3,000 | Doesn't fit our story; we're operations, not platform tooling |

### ❌ Removed from prior plan

- **"Best Use of AI Agents in Splunk Apps"** ($1K × 2) — this track **does NOT exist** in the May 13 official rules. We had it in earlier notes. The AI-agent narrative still feeds the Grand prize judging, but no longer has a dedicated bonus.

**Maximum realistic for us**: $7K Grand + $1K Bonus (MCP Server) + $200 MVF = **$8,200** + .conf26 passes.

---

## Judging Criteria

All submissions will be judged on these four dimensions:

| Criterion | Weight | Our Strategy |
|-----------|--------|-------------|
| **Technological Implementation** | Quality of software development | Clean TypeScript, proper batching/retry, clean separation of concerns. Show the code is production-grade. |
| **Design** | UX and design thoughtfulness | MidnightVitals UI is already polished (time wheels, console, etc.). Splunk dashboards should look equally sharp. |
| **Potential Impact** | How big could this be? | First observability tool for an entire blockchain ecosystem (Midnight). Emphasize: "every Midnight DApp needs this." |
| **Quality of the Idea** | Creativity and uniqueness | ZK-proof blockchain + Splunk has literally never been done. We're creating an entirely new observability category. |

---

## What We Know So Far

### Confirmed
- Hackathon is real and active on Devpost
- $20,000 total prize pool across 8 tracks
- Submissions: May 18 – June 15 (28-day build window)
- Judging by qualified panel (TBD)
- .conf26 passes for top track winners

### Not Yet Announced (Coming May 13)
- **Full official rules** (currently "not yet available")
- **Challenge requirements** (what must be in a submission)
- **Submission format** (video demo? README? live app?)
- **Team size limits**
- **Eligibility restrictions** (geography, age, etc.)
- **Technology requirements** (must you use specific Splunk products?)
- **Resource links** (Splunk dev tools, APIs, SDKs)
- **Judge identities**

### ⚠️ ACTION REQUIRED: May 13 Rules Drop
When the full rules are published on May 13, we need to immediately:
1. Read every word of the official rules
2. Verify our project is eligible
3. Check submission format requirements
4. Identify any mandatory Splunk products we must integrate
5. Adjust our architecture if needed
6. Update this document

---

## Our Project — ZKSplunk Architecture

```
┌─────────────────────────┐
│  Midnight DApp          │
│  (DiscoveryManagement,  │
│   proofOrBluff, etc.)   │
│                         │
│  ┌───────────────────┐  │
│  │  MidnightVitals   │  │
│  │  (React Context)  │  │
│  │  ┌─────────────┐  │  │
│  │  │ splunkCalls  │──┼──┼──► SplunkForwarder
│  │  └─────────────┘  │  │         │
│  └───────────────────┘  │         ▼
└─────────────────────────┘    HEC Client
                                    │
                                    ▼
                            Splunk Cloud / HEC
                                    │
                         ┌──────────┼──────────┐
                         ▼          ▼          ▼
                    Dashboards  AI Agent   SOAR Alerts
                    (SPL)       (MCP)      (Playbooks)
```

### What's Built (as of June 3, 2026)
- ✅ Full MidnightVitals module (`vitals/`, 12 files) copied into ZKSplunk
- ✅ Vitals context modified with `splunkCallbacks` prop
- ✅ Splunk HEC client with batching & exponential retry (`hec-client.ts`)
- ✅ SplunkForwarder bridge (connect/shutdown/heartbeat lifecycle, `splunk-forwarder.ts`)
- ✅ Vitals-to-Splunk adapter, typed event transformers (`vitals-adapter.ts`)
- ✅ 14 ZK-specific Splunk field extractions + 11 pre-built SPL saved searches (`field-extractions.ts`)
- ✅ Environment-based config loader (`config.ts`)
- ✅ **On-chain attestation Compact contract** (`contract/src/zksplunk.compact`) — Merkle-membership operator registry + nullifier-based anonymous critical-incident attestation. Compiles clean (compiler v0.31.0, language 0.23).
- ✅ **Attestation client** (`attestation-client.ts`) + **telemetry commitment helpers** (`telemetry-commitment.ts`) — commit off-chain telemetry snapshots on-chain
- ✅ **Connector test suite** (`connector/src/__tests__/attestation.test.ts`)
- ✅ **Live vitals provider** (`zkMonitor/src/http-vitals-provider.ts`) — real HTTP health checks against the Midnight preview network
- ✅ GitHub repo + DIDzMonolith submodule

### What Needs to Be Built (12 days left)
- ⚠️ **Make repo public + confirm license is visible** (Devpost requirement — currently private)
- ❌ Splunk Cloud trial account & live HEC token
- ❌ End-to-end test: vitals → HEC → Splunk index (live)
- ❌ Splunk app package: `splunk-app/` dashboards + saved searches as `.conf` files (NOT yet created)
- ❌ AI Agent: `ai-agent/` prompts + Splunk MCP ↔ Midnight MCP bridge (NOT yet created)
- ❌ **Demo video (< 3 min)** — show it working + explain how AI is used
- ❌ **Architecture diagram** as a submission asset (ASCII exists in README; need a clean rendered image)
- ❌ Devpost project page + submission materials

---

## Timeline & Sprint Plan

### Phase 0 — Pre-Hackathon Prep (NOW → May 13)
*Goal: Learn Splunk, get infrastructure ready, don't waste build window days*

| Week | Dates | Tasks |
|------|-------|-------|
| **Week 1** | Apr 7 – Apr 13 | Sign up for Splunk Cloud trial. Get HEC token. Test basic event ingestion. |
| **Week 2** | Apr 14 – Apr 20 | Build first Splunk dashboard manually. Learn SPL basics. Test our saved searches. |
| **Week 3** | Apr 21 – Apr 27 | Explore Splunk MCP Server. Understand AI Agent SDK. Prototype MCP bridge. |
| **Week 4** | Apr 28 – May 4 | End-to-end: run ZKSplunk connector against mock vitals → see data in Splunk Cloud. |
| **Week 5** | May 5 – May 11 | Polish connector. Package Splunk app. Prepare for rules drop. |
| **Week 6** | May 12 – May 13 | **RULES DROP.** Read everything. Adjust plan. |

### Phase 1 — Build Sprint (May 18 → June 8)
*Goal: Complete all deliverables with 1 week buffer*

| Week | Dates | Tasks |
|------|-------|-------|
| **Week 7** | May 18 – May 25 | Submissions open. Finalize connector with any rule-required features. Build AI agent. |
| **Week 8** | May 26 – Jun 1 | Splunk app dashboards. SOAR alerts. MCP bridge if targeting that track. |
| **Week 9** | Jun 2 – Jun 8 | Integration testing. Fix bugs. Start demo video script. |

### Phase 2 — Polish & Submit (June 9 → June 15)
*Goal: Ship a polished submission before deadline*

| Week | Dates | Tasks |
|------|-------|-------|
| **Week 10** | Jun 9 – Jun 12 | Record demo video. Write submission README. Screenshots. |
| **DEADLINE** | Jun 13 – Jun 15 | Final review. **Submit by June 14** (1 day buffer). 🚀 |

### Phase 3 — Post-Submit (June 15 → July 17)
*Goal: Sit back, wait for results*

| Date | Event |
|------|-------|
| June 26 | Judging begins |
| July 10 | Judging ends |
| **July 17** | **Winners announced** (2:00 PM PDT / 5:00 PM EDT) |

---

## Splunk Learning Checklist

Things John needs to learn before the build sprint:

- [ ] Splunk Cloud account setup & navigation
- [ ] HEC (HTTP Event Collector) configuration
- [ ] Basic SPL (Search Processing Language) queries
- [ ] Creating dashboards in Splunk
- [ ] Splunk App packaging (app.conf, default/, metadata/)
- [ ] Splunk MCP Server — what it can do, how to connect
- [ ] Splunk AI Agent capabilities — what's available
- [ ] Splunk Hosted Models — worth using for our case?
- [ ] Splunk SOAR basics (for stretch goal)
- [ ] Submission format on Devpost (video length, README, etc.)

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Rules on May 13 require tech we haven't planned for | Medium | High | Start broad prep. Keep architecture flexible. |
| Splunk Cloud trial has limitations that block us | Low | High | Apply for trial early. Check limits. |
| Can't get Midnight proof server running for live demo | Medium | Medium | Mock provider is already built. Demo can use simulated data. |
| AI agent track is more complex than expected | Medium | Low | It's a $1K bonus track, not our primary. Cut if needed. |
| Time crunch — 28-day build window is tight | Medium | High | We've already built the connector foundation. Head start is huge. |
| Chuck's Haswell CPU can't run ZK proofs for demo | Known | Low | Demo on ASUS (artpro) or use mock provider. |

---

## Submission Checklist (Devpost requirements confirmed)

- [ ] Devpost project page created
- [x] Project description & README (comprehensive README done; keep in sync with code)
- [ ] Demo video (**< 3 min** — confirmed by June 3 reminder; show it working + explain AI usage)
- [ ] Screenshots of Splunk dashboards (blocked on Splunk Cloud + dashboards)
- [ ] **Make GitHub repo public** (still private; required, with visible Apache-2.0 license)
- [x] License present and visible (Apache 2.0 `LICENSE` in repo root)
- [ ] Clear setup instructions in README (verify build/run steps are copy-pastable)
- [ ] Architecture diagram as a rendered asset (ASCII in README; need an image)
- [ ] List of Splunk products/APIs used
- [ ] Team member info
- [ ] Track selection (Grand + Best of Observability + MCP bonus)
- [ ] Any required attestations or agreements

---

## Key Links

| Resource | URL |
|----------|-----|
| Devpost hackathon page | https://splunk.devpost.com/ |
| Registration shortlink | https://bit.ly/splunkai26d |
| ZKSplunk GitHub (private) | https://github.com/bytewizard42i/ZKSplunk_Splunking_w_Midnight |
| Splunk HEC docs | https://docs.splunk.com/Documentation/Splunk/latest/Data/UsetheHTTPEventCollector |
| Splunk MCP Server | TBD (check after May 13) |
| Splunk Cloud trial | https://www.splunk.com/en_us/download/splunk-cloud.html |
| Splunk Dev portal | https://dev.splunk.com/ |
| Midnight docs | https://docs.midnight.network/ |

---

## Penny's Reminders

> **Penny will proactively remind John about:**
> - Weekly sprint goals every Monday
> - The May 13 rules drop (critical date)
> - Submission deadline approaching (June 15)
> - Any blockers that need attention
> - When to submit feedback for the "Most Valuable Feedback" track ($200 × 5 winners = easy money)

---

*Last updated: June 3, 2026 (midpoint reminder from Devpost) — by Cassie 💜 & Penny 🎀*  
*Companion docs: `CALENDAR.md`, `CHEATSHEET.md`, `PENNYS_NOTES_TO_JOHN.md`, `MIDNIGHT_BASE_LAYER_RESEARCH.md`*
