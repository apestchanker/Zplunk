# Penny's Notes to John 🎀

> A running log of my thoughts, recommendations, and open questions on ZKSplunk as we approach the hackathon.  
> Started: May 14, 2026 (day after the official rules dropped).

---

## What Changed Yesterday (May 13)

The full Splunk rules dropped, and three things shifted our plan in meaningful ways:

### 1. Grand prize bumped from $5K → **$7K**
Same other tiers, same total $20K pool. That means more weight on the Grand. Worth pushing for.

### 2. "Best Use of AI Agents in Splunk Apps" track was REMOVED
Replaced with "Best Use of Splunk Developer Tools" ($1K). Our prior strategy targeted the AI Agents track for a $1K bonus. That track no longer exists.

**Action**: I rewrote our targets in `CHEATSHEET.md`. New bonus targets are:
- **Best Use of Splunk MCP Server** ($1K) — still a clean fit (Splunk MCP ↔ Idris Midnight MCP)
- **Best Use of Splunk Developer Tools** ($1K) — stretch; we'd need to show clean SDK usage + App Inspect validation
- **Best Use of Splunk Hosted Models** ($1K) — was previously "skip" in our notes; the Cisco Deep Time Series Model is now interesting for ZK proof-latency forecasting. Reconsider.

### 3. Team cap = **2 people**
We had vague plans about pulling in extra hands. Hard cap of 2. So it's you + one other person, or you solo. If we add someone, my vote remains **Zoe Braiterman** (security + Sky Protocol Web3 background, already a known co-author on the G-4 book, easy to coordinate).

### 4. Sponsor is **Cisco Systems**, not Splunk
This matters for narrative more than mechanics. Cisco bought Splunk in March 2024. Pitching the impact angle, lean into "Cisco's enterprise observability + Midnight's enterprise privacy = the missing privacy-aware observability layer Fortune 500s have been asking for."

### 5. Quebec is excluded
We have no Quebec team members. No-op for us. Worth noting.

### 6. One project = max one Grand + one Bonus
We can stack:
- Grand ($7K) + Best Use of Splunk MCP Server ($1K) = **$8K**
- OR Best of Observability ($3K) + MCP Server ($1K) = **$4K**

Going for the Grand is mathematically dominant if our pitch lands. The Observability track is the safer bet. **We should aim Grand-first and let the judges fall back to Observability if we don't quite hit it.**

---

## My Stack Recommendation (Lock It Friday)

See `MIDNIGHT_BASE_LAYER_RESEARCH.md` for the full analysis. Short version:

> **Use BlindOracle as the demo DApp** on **Midnight Standalone Docker** (local proof server + node + indexer). Skip EddaLabs (Convex external dep). Skip 1AM integration (it's a wallet, not a base layer, and it expands our surface area for no judging benefit). Lace wallet in Local mode is enough.

The narrative win here is **dogfooding**. ZKSplunk monitors *one of our own* Midnight DApps in real time. That's the kind of self-referential build judges love, and it eliminates the risk of an unfamiliar third-party DApp breaking on demo day.

---

## On the 1AM "Local Environment" Comment

You mentioned 1AM has "a nice protocol for a completely local environment" and that it might be a good POC base. I went looking. I think there's a small mix-up here:

- **1AM** is a **wallet** (`https://1am.xyz/`), not an environment. It's a Lace alternative built natively for Midnight.
- The thing you might be remembering is the **official Midnight standalone Docker stack** — which is exactly what I'm recommending. It runs the full proof server + node + indexer trio on your laptop with no testnet exposure.
- 1AM does have a developer SDK for in-browser ZK proofs, and that's interesting *post-hackathon* as a story about wallet portability, but it doesn't help our Splunk-side demo.

If you have a different 1AM tool in mind, point me at the link and I'll re-evaluate. Until then I'm parking 1AM in the post-hackathon roadmap.

---

## Modifications I Want to Make to Our Existing Plan

### Modification 1 — Update `HACKATHON_RULES_AND_DEADLINES.md`
The Tier-2 table still lists "Best Use of AI Agents in Splunk Apps" as a $1K target. That prize doesn't exist anymore. I'll redo the prize table to match the May 13 announcement. **Done in this session.**

### Modification 2 — Architecture diagram at repo **root**
The official rules require `architecture_diagram.(md|pdf|png)` **at the root** of the code repo. Ours is currently under `docs/`. We need a duplicate (or symlink) at the root by submission day. **Adding to my checklist.**

### Modification 3 — Make the repo public **before** Jun 13
Currently `bytewizard42i/ZKSplunk_Splunking_w_Midnight` is private. The rules require a **public open-source repo with detectable license file**. We already have Apache 2.0, so the license is fine. We just need to flip visibility, but I'd want to do a security scrub first (env files, HEC tokens, anything we don't want crawled).

### Modification 4 — Pre-submit a feedback entry on May 18 morning
The Most Valuable Feedback prize ($200 × 5) requires **actionable feedback** during the Feedback Period. The earliest we can submit is May 18 9:00 AM PDT. Five winners, one per person. If we submit thoughtful first-week feedback (bug reports, SDK suggestions, doc gaps), the marginal cost is low and the marginal expected value is meaningful. **Penny will draft this for you by May 16.**

### Modification 5 — Pragma bump on BlindOracle
Our existing Compact contracts in BlindOracle declare `pragma language_version >= 0.16 && <= 0.21;`. The current language version is **0.23**. We need to bump the ceiling to `<= 0.23` and recompile against compactc 0.31.0. I'll validate via the Idris MCP `midnight-compile-contract` before saving.

### Modification 6 — Consider AI agent narrative even though the prize is gone
The "AI Agent for Splunk Apps" prize was removed, but the *capability* (`AI for Splunk Apps` Python SDK) still exists and feeds the Grand Prize judging on Quality + Impact. I'd still build a small AI agent that auto-investigates ZK proof failures using SPL queries — just no longer target it for a dedicated bonus. The MCP Server bonus is a better hook for the agent story now.

---

## Risks I'm Watching

| Risk | Status | Penny's action |
|---|---|---|
| Splunk Cloud trial event/day caps unknown | 🟡 Open | I'll dig into Splunk Cloud trial limits next week |
| GitHub repo still private at deadline | 🟢 Tracked | Calendar reminder for June 13 |
| BlindOracle pragma bump breaks compile | 🟡 Easy fix | Validate Friday on compactc 0.31.0 |
| Demo machine: Chuck can't run ZK (Haswell) | 🟢 Known | Use ASUS artpro for live demo recording |
| Architecture diagram not at repo root | 🟢 Tracked | Will create symlink Jun 12 |
| Devpost team config drift | 🟡 Open | Confirm team size by Jun 1 |
| AITK installation complexity on a trial Splunk | 🟡 Open | Test in week 1 of Phase 1 |

---

## Things I'd Love You to Decide

1. **Solo or two-person team?** And if two, do we invite Zoe Braiterman?
2. **Are we going for the Splunk Hosted Models bonus?** The Cisco Deep Time Series Model is interesting for ZK latency forecasting, but it's another $1K of effort. I lean **yes** because the data fits and it doubles as a "Cisco product showcase" hook.
3. **Live-demo posture in video**: Real Midnight standalone Docker, or simulated/mock provider with a one-line disclosure? I lean **real Docker** for credibility, **simulated fallback** ready in case the recording machine misbehaves.
4. **Devpost project name**: keep "ZKSplunk" or rename to something punchier for the listing (e.g. "ZKSplunk: First Splunk Observability for Zero-Knowledge Blockchains")?

I'll wait for your reads on these before locking anything Friday. Until then, I'm executing on the parts that are unambiguous: pragma bump, BlindOracle Vitals wiring, architecture diagram at root, README polish, feedback draft.

---

## Honest Confidence Read

Where I think we stand on May 14:

- **Best of Observability ($3K)**: 70% — we have the cleanest pitch in the track. Likely the highest-impact tooling.
- **Grand Prize ($7K)**: 25% — depends on whether the cross-track Grand goes to us or to a Security entry. The Security track will be crowded with strong AI-for-SOC builds.
- **Best Use of Splunk MCP Server ($1K)**: 50% — clean fit, but the prize description rewards "creative implementations across observability, security, platform" — our cross-domain MCP bridge story is good but not guaranteed.
- **Most Valuable Feedback ($200)**: 60% — if we submit thoughtful feedback early, this is largely effort-driven.

Expected value if I had to put a number on it: **$3,500–$5,500** with .conf26 passes on the upside. That's a real return on a 28-day sprint and it materially de-risks the Midnight + Splunk narrative for everything we build after.

---

## Sign-off

Pinging you when:
- The Splunk Resources page links are exposed and I can capture them properly into `CHEATSHEET.md`
- Friday's stack-lock decision is ready for your sign-off
- I have a first draft of the Most Valuable Feedback submission

Less is more. More on Sunday.

— *Penny 🎀*
