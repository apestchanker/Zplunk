# ZKSplunk — Hackathon Cheatsheet 🎀

> **Single source of truth.** If it isn't here, it's in a deep-dive doc linked below.  
> Last updated: **May 14, 2026** (day after official rules dropped).

---

## TL;DR

| Field | Value |
|---|---|
| **Hackathon** | Splunk Agentic Ops Hackathon 2026 |
| **Sponsor** | Cisco Systems, Inc. (170 W Tasman Dr, San Jose, CA 95134) |
| **Administrator** | Devpost, Inc. (250 Broadway, Floor 24, NY, NY 10007) |
| **Devpost URL** | https://splunk.devpost.com/ |
| **Submission window** | May 18 → Jun 15, 2026 (9:00 AM PDT = 12:00 PM EDT) |
| **Winners announced** | Jul 17, 2026 ~2:00 PM PDT |
| **Prize pool** | $20,000 USD |
| **Our project** | ZKSplunk: first observability bridge between ZK-proof blockchain (Midnight) and Splunk |
| **Tracks we target** | Observability (primary) + Platform & Dev Experience (secondary) |
| **Bonus prizes we target** | Splunk MCP Server, Splunk Developer Tools |

---

## Eligibility Snapshot

- ✅ Above age of majority in country of residence
- ✅ **Teams up to 2 people** only (down from "no limit" assumption — confirm with anyone before adding)
- ❌ Excluded countries/territories: Belarus, Brazil, **Quebec (Canada)**, Russia, Cuba, Iran, Syria, North Korea, Crimea, Donetsk PR, Luhansk PR
- ❌ Government / state-owned entity employees
- ❌ Cisco/Splunk/Devpost employees & affiliates
- ⚠️ A single individual may join multiple teams AND submit solo
- ⚠️ Each Team picks one **Representative** to file the submission

---

## Prize Structure (CONFIRMED May 13)

### Track Prizes (one Grand + one of these per project, max)

| Prize | Cash | Extras | Track |
|-------|------|--------|-------|
| **🏆 Grand Prize** | **$7,000** | .conf26 pass / team member | All tracks |
| Best of Observability | $3,000 | .conf26 pass / team member | Observability |
| Best of Security | $3,000 | .conf26 pass / team member | Security |
| Best of Platform & Dev Experience | $3,000 | .conf26 pass / team member | P&DX |

### Bonus Prizes (one bonus per project, max — stacks with Grand)

| Prize | Cash | Quantity |
|-------|------|----------|
| Best Use of Splunk MCP Server | $1,000 | 1 |
| Best Use of Splunk Hosted Models | $1,000 | 1 |
| Best Use of Splunk Developer Tools | $1,000 | 1 |

### Feedback Prizes (separate; individuals not projects)

| Prize | Cash | Quantity |
|-------|------|----------|
| Most Valuable Feedback | $200 | 5 winners |

**⚠️ RULE CHANGE FROM OUR EARLIER NOTES:** The "Best Use of AI Agents in Splunk Apps" track does **NOT** exist. It was replaced by "Best Use of Splunk Developer Tools." Update strategy accordingly.

**Max realistic for us**: $7K (Grand) + $1K (MCP Server bonus) + $200 (Feedback) = **$8,200** + .conf26 passes.

---

## Required Submission Deliverables

Every submission **must** include:

- [ ] Project on a public, **open-source** GitHub repo with **detectable license file**
- [ ] **README** with setup + run instructions, dependencies, example configs/data
- [ ] **`architecture_diagram.(md|pdf|png)`** at the **root** of the repo showing:
  - How the app interacts with Splunk
  - How AI models / agents are integrated
  - Data flow between services, APIs, components
- [ ] Text description of features & functionality (Devpost form)
- [ ] **Demo video < 3 minutes** on YouTube, Vimeo, or Youku (publicly visible) showing:
  - Project working on target device
  - How AI is used
  - The problem being solved
  - The value provided
  - No unlicensed trademarks/music
- [ ] Track selection: Observability / Security / Platform & Dev Experience
- [ ] All materials in English (or English-translated)

---

## Judging — 4 Equally Weighted Criteria

1. **Technological Implementation** — quality software dev?
2. **Design** — UX well-thought-out?
3. **Potential Impact** — how big could this be?
4. **Quality of the Idea** — creative & unique?

**Stage 1** = pass/fail viability check (does it fit the theme + use required APIs/SDKs?).  
**Stage 2** = scored on the 4 criteria above.

**Tiebreaker order**: Technological Implementation → Design → Potential Impact → Quality of Idea → judges vote.

---

## Splunk AI Capabilities — What We Can Leverage

| Capability | What it is | Our angle |
|---|---|---|
| **AI for Splunk Apps** (Python SDK) | Agentic workflows inside Splunk apps | Build an agent that auto-investigates ZK proof failures |
| **Splunk MCP Server** | AI agents → Splunk data via Model Context Protocol | **Bridge to Midnight MCP** — Splunk MCP + Idris MCP cross-talk (targets $1K bonus) |
| **Splunk AI Assistant for SPL** | NL → SPL query generation | Use during dashboard build; possibly demo a "natural-language ZK debugging" UX |
| **Splunk AI Toolkit (AITK)** | Build custom models on your data | Train anomaly detector on ZK proof latency distributions |
| **Splunk Hosted Models** | Foundation-Sec-1.1-8B-Instruct, Cisco Deep Time Series Model, gpt-oss-{20b,120b} | Time-series model for proof latency forecasting |

### Official Resource Links

**Splunk AI Master Doc**: https://docs.splunk.com/Documentation/Splunk/latest/Search/AboutSplunkAI (referenced as "Master Documentation: Splunk AI" on the resources page)

**Python SDK AI**:
- Setup README — (link from dev.splunk.com)
- AI Custom Alert App example
- AI Custom Search App example
- AI Custom Modular Input App example

**Splunk MCP Server**:
- About MCP server for Splunk Platform
- How to Configure the Splunk MCP server
- Operationalizing MCP Server Security with the Splunk MCP TA
- Unlock the Power of Splunk Cloud Platform with the MCP Server
- Splunkbase app listing (includes installation steps)

**Splunk AI Assistant for SPL (SAIA)**:
- Splunk AI Assistant for SPL — overview
- Splunkbase app listing
- Enabling the Splunk Enterprise AI Assistant for SPL
- Technical Review of Splunk AI Assistant for SPL
- Building an AI Assistant in Splunk Observability Cloud

**Splunk AI Toolkit (AITK)**:
- Splunkbase listing
- Gen AI capability in security operations with the AITK
- Implementing use cases with Splunk Artificial Intelligence
- Learn more about Splunk AI toolkit

**Splunk Hosted Models**:
- Splunk Hosted Models overview
- Cisco Deep Time Series Model (use cases)
- gpt-oss-120b — HuggingFace
- gpt-oss-20b — HuggingFace
- Foundation-Sec-1.1-8B-Instruct — HuggingFace

**Splunk Enterprise Developer License**: https://dev.splunk.com/

**Community Slack**: `#splunk-ai-hackathon` channel on Splunk Community Slack

> ⚠️ **TODO for John**: When you get a quiet hour, click through each Splunk resource link from the Resources page and copy the exact URL into this section. They didn't expose direct hyperlinks in the email I parsed; we need them captured so judges can't catch us with a stale link.

---

## Our Stack (Confirmed)

| Layer | Choice | Why |
|---|---|---|
| Privacy blockchain | **Midnight Network mainnet/testnet-02** | Already live, our target ecosystem |
| Compact compiler | **compactc 0.31.0** (language 0.23.0, runtime 0.16.0) | Latest stable as of Apr 29, 2026 |
| Pragma | `pragma language_version >= 0.16 && <= 0.23;` | Range to cover backward + current |
| Demo DApp | **BlindOracle** (already in DIDzMonolith) | Self-built, no external dep, already wired with Vitals |
| Local environment | **`midnightntwrk/midnight-local-dev`** (official tool, surfaced May 13, 2026) | Sanctioned, `npm start` one-liner, pre-funded master wallet, auto DUST registration. See `17_MIDNIGHT_LOCAL_DEV_AND_ECOSYSTEM_2026-05-13.md`. |
| Vitals layer | **MidnightVitals** (12 files already in repo) | Telemetry source |
| Connector | **TypeScript HEC client** (already built) | Batches + exponential retry into Splunk HEC |
| Splunk side | **Splunk Cloud trial** + HEC token | 60-day free trial |
| AI agent | **Splunk MCP Server ↔ Midnight (Idris) MCP** bridge | Targets $1K MCP bonus + Grand differentiator |
| Hosted model | **Cisco Deep Time Series Model** for proof latency forecasting | Targets $1K Hosted Models bonus (stretch) |

See `16_MIDNIGHT_BASE_LAYER_RESEARCH.md` for the deep dive on why we picked BlindOracle + standalone Docker over 1AM wallet integration or EddaLabs template.

---

## Getting Access Checklist

- [ ] Create free Splunk account: https://www.splunk.com/en_us/form/sign-up.html
- [ ] Download Splunk Enterprise Trial (60-day): https://www.splunk.com/en_us/download/splunk-enterprise.html
- [ ] Apply for Developer License (6-month) via https://dev.splunk.com/
- [ ] Generate HEC token on Splunk instance
- [ ] Join Splunk Community Slack → `#splunk-ai-hackathon`
- [ ] Verify Devpost team configuration (≤2 members)
- [ ] Confirm GitHub repo is **public** before submission (currently private)
- [ ] Add `architecture_diagram.png` at repo **root** (not inside `/docs`)

---

## Common Pitfalls (Don't Trip Over These)

| Pitfall | Why it matters | Mitigation |
|---|---|---|
| Repo still **private** at submission | Auto-disqualifies (rules require public + open source) | Flip to public on Jun 13; verify LICENSE detectable |
| Architecture diagram **not at root** | Rules say "at the root of the code repository" | Symlink or duplicate `architecture_diagram.png` to repo root |
| Demo video **over 3 minutes** | Judges aren't required to watch past 3:00 | Hard-cut to 2:50 max |
| Music/trademarks in demo video | Can be disqualified | Use Splunk-friendly stock music or none |
| Devpost team config ≠ actual contributors | Verification can disqualify | Lock team list by Jun 1 |
| Project **dev'd under contract or with sponsor funding** | Disqualified | We're clean — built independently |
| **Quebec** team member | Excluded | None on team |

---

## Internal Links (This Repo)

- `docs/13_HACKATHON_RULES_AND_DEADLINES.md` — full rules + sprint plan (updated)
- `docs/15_CALENDAR.md` — confirmed dates + Penny's reminder schedule
- `docs/16_MIDNIGHT_BASE_LAYER_RESEARCH.md` — stack deep dive: 1AM vs EddaLabs vs official examples
- `docs/14_HACKATHON_STRATEGY.md` — pre-existing strategy doc
- `docs/02_DEAR_JUDGES.md` — pre-existing judge-facing pitch
- `docs/07_BUILD_OUT_ARCHITECTURE_2026-04-21.md` — pre-existing architecture
- `docs/05_DEVREL_SPLUNK_HEALTH_AND_ATTACK_DETECTION.md` — pre-existing detection patterns
- `docs/11_FUTURE_DIRECTIONS.md` — post-hackathon roadmap

---

## External Links

| Resource | URL |
|---|---|
| Hackathon Devpost | https://splunk.devpost.com/ |
| Official Rules | https://splunk.devpost.com/rules |
| Splunk Developer Portal | https://dev.splunk.com/ |
| Splunk Cloud signup | https://www.splunk.com/en_us/form/sign-up.html |
| Splunk Enterprise trial | https://www.splunk.com/en_us/download/splunk-enterprise.html |
| Splunkbase | https://splunkbase.splunk.com/ |
| Midnight docs | https://docs.midnight.network/ |
| Midnight compatibility matrix | https://docs.midnight.network/relnotes/overview |
| Idris (Midnight) MCP repo | https://github.com/bytewizard42i/idris-midnight-mcp-johns-copy |
| EddaLabs example DApp | https://midnighthackathon.eddalabs.io/ |
| 1AM wallet | https://1am.xyz/ |
| Our repo | https://github.com/bytewizard42i/ZKSplunk_Splunking_w_Midnight (private → make public before Jun 15) |

---

*Maintained by Penny 🎀 on behalf of John M.P. Santi. Update on every rule change, deadline shift, or scope decision.*
