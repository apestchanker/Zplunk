# Midnight Base-Layer Stack — Deep Dive & Recommendation

> Purpose: pick the Midnight foundation our ZKSplunk demo DApp will sit on top of, so the connector has real ZK telemetry to forward.  
> Author: Penny 🎀 — May 14, 2026

---

## The Question We're Actually Answering

For the Splunk hackathon, **Splunk is the star, not Midnight**. The Midnight layer's only job is:

1. Produce **realistic ZK-proof telemetry** (proof timings, indexer events, wallet state, contract calls)
2. Be **reproducible** by a Splunk judge in <30 minutes
3. Run in a **local environment** without testnet flakiness during demo time
4. Not crash on **Cisco/Splunk judges' hardware** (likely Mac/Linux laptops, possibly underspec for ZK)

So we want the **smallest, most-deterministic, most-current** Midnight base that emits real telemetry. Bonus if it's something we already own.

---

## Stack Options Evaluated

### Option A — **Official `midnight-local-dev` tool** ⭐ UPDATED 2026-05-13
**Source**: https://github.com/midnightntwrk/midnight-local-dev (official Midnight Foundation repo, surfaced by Idris's tutorial video on May 13, 2026).

This **replaces** my earlier hand-rolled Docker compose recommendation. It is the same three-container stack (node `:9944`, indexer `:8088`, proof server `:6300`), but with:
- A single `npm start` command that handles startup, dependency ordering, and health checks
- An interactive CLI for **funding test wallets** from a genesis master wallet (50,000+ tNIGHT pre-loaded)
- Automatic **DUST registration** (without DUST, a wallet can hold NIGHT but cannot submit transactions)
- Built-in **reuse-vs-restart** detection if the network is already running
- Network ID = `undeployed` — matches Lace wallet's hardcoded "Undeployed" mode out of the box

**Pinned versions** (May 2026):
- Node `midnightntwrk/midnight-node:0.22.3`
- Indexer `midnightntwrk/indexer-standalone:4.0.1`
- Proof server `midnightntwrk/proof-server:8.0.3`
- `@midnight-ntwrk/wallet-sdk-facade@3.0.0`, `ledger-v8@8.0.3`, `midnight-js-network-id@4.0.2`

**Pros**
- 🟢 Officially sanctioned — no risk of "you're using an unsupported pattern" critique
- 🟢 Reproducible by judges in 5 minutes: `git clone && npm install && npm start`
- 🟢 Pre-loaded master wallet eliminates "where do I get test tokens" friction
- 🟢 Lace wallet works out of the box (just select "Undeployed" in network settings)
- 🟢 Idris explicitly demonstrates deploying ZKLoan + similar Compact contracts against it

**Cons**
- 3 containers (~2 GB images) — judges need Docker installed (this is a given for any Midnight demo)
- Skylake+ CPU for ZK proof generation (no zkir on Haswell — known constraint, demo on artpro)
- ARM Macs need x86 emulation for zkir (slow but works)

**Telemetry richness**: ⭐⭐⭐⭐⭐ — every layer emits the events Vitals expects.

**See**: `MIDNIGHT_LOCAL_DEV_AND_ECOSYSTEM_2026-05-13.md` for the full deep dive on this tool, the 1AM Zealy sprint, federation details, and the FNO list.

---

### Option B — EddaLabs `hackathon-midnight-2` template
**Source**: https://github.com/ErickRomeroDev/hackathon-midnight-2  
**Live demo**: https://midnighthackathon.eddalabs.io/

**Stack**: Next.js 15 (App Router) + Tailwind + Framer Motion + Convex reactive DB + RxJs + Midnight indexer subscriptions.

**Pros**
- Modern frontend, well-architected
- Reactive indexer integration (RxJs observables) is a nice pattern to copy
- Live hosted demo proves it works end-to-end
- Tested by EddaLabs against the hackathon prerequisites

**Cons**
- **Convex** is an external cloud dependency. Judges would need a Convex account or we'd ship our deployment URL — fragile.
- The DApp is "Anonymous Q&A" — themed differently from our observability pitch
- App Router + Convex adds surface area we don't need for a Splunk demo
- Less telemetry surface than our existing BlindOracle (fewer circuit calls)

**Telemetry richness**: ⭐⭐⭐ — fine, but no more than our own DApps.

---

### Option C — `midnight-ntwrk/example-zkloan` (or example-counter, example-bboard)
**Source**: Official Midnight examples, kept current with SDK releases.

**Pros**
- Smallest, cleanest, exactly-spec implementation
- SDK 3.1.0 series — matches what our connector already targets
- No external dependencies
- Easy for judges to read

**Cons**
- Trivial DApp — limited circuit variety, so limited Vitals events
- "Toy" feel diminishes the demo wow-factor

**Telemetry richness**: ⭐⭐⭐ — adequate for happy-path events, thin on edge cases.

---

### Option D — **Our own BlindOracle** as the demo DApp
**Source**: `/home/js/DIDzMonolith/BlindOracle-Gimbalabs_hackathon` (already in DIDzMonolith).

**Pros**
- ✅ **We already built it.** Zero new code on the Midnight side.
- ✅ Four-act game (commit → lock → match → settle) emits **richer event variety** than any toy example
- ✅ Compiled against compactc 0.30+ already, pragma `>= 0.16 && <= 0.21` (need bump to ≤ 0.23, trivial)
- ✅ Uses Midnight SDK 3.1.0 — same as our connector
- ✅ Narrative gold: "ZKSplunk monitoring our own ZK-game DApp in real time" — judges see two of John's projects working together
- ✅ Failure modes for AI agent to diagnose: proof failures during settlement, missed matching windows, idle rounds
- ✅ Already proven against Gimbalabs hackathon scrutiny

**Cons**
- Slightly more setup than example-counter (3 packages: contract, api, ui)
- Demo needs at least 2 simulated players for matchmaking
  - **Mitigation**: bot-driven autoplay scripted in the demo

**Telemetry richness**: ⭐⭐⭐⭐⭐ — most varied event surface of any option.

---

### Option E — 1AM wallet integration
**Source**: https://1am.xyz/ — privacy-first browser wallet, Midnight-native, in-browser ZK proofs, dev SDK.

**Verdict**: **Not a base layer.** 1AM is a wallet alternative to Lace. It's relevant if we want to claim "multi-wallet support" or showcase the developer SDK for in-browser proofs.

**Verdict for the hackathon**: **Skip.** Adding a second wallet doubles UX surface area, and our story is about *Splunk observability*, not wallet choice. We can mention 1AM in the post-hackathon roadmap and demonstrate alternative wallet support in a future blog post.

---

## Penny's Recommendation: **D + A** (BlindOracle on Midnight Standalone)

**Base layer**: Midnight Standalone Docker stack (proof server `:6300`, node, indexer) — local-only.  
**Demo DApp**: BlindOracle (we own it, richest events, free narrative).  
**Wallet**: Lace in Local mode (per the Apr 2026 mainnet config we already documented).  
**Skip**: EddaLabs Convex layer, 1AM integration, example DApps.

### Why this wins all four judging criteria

| Criterion | How D+A delivers |
|---|---|
| **Technological Implementation** | Mainnet-equivalent stack, no test-only hacks. Clean separation: Midnight produces events, ZKSplunk forwards them, Splunk analyzes them. |
| **Design** | BlindOracle has the polished MUI 6 UI (violet + gold oracle theme) — judges see a *finished* DApp, not a toy. |
| **Potential Impact** | "Any Midnight DApp can pipe its telemetry to Splunk in 10 lines of code" — BlindOracle is just the first example. The connector is a reusable npm package. |
| **Quality of the Idea** | First Splunk connector for any ZK-proof chain × showcased through a working privacy game = two products of work, one submission. |

---

## Required Changes to BlindOracle (Minor)

To slot BlindOracle into the ZKSplunk demo cleanly:

1. **Pragma bump**: `>= 0.16 && <= 0.21` → `>= 0.16 && <= 0.23` (to match compactc 0.31.0). Verify with `mcp10_midnight-compile-contract`.
2. **Wire MidnightVitals** into `blindoracle-ui` — copy the `vitals/` module from this repo into the UI workspace.
3. **Add `splunkCallbacks` prop** to the Vitals context provider — already supported.
4. **Bot autoplay script** — add `scripts/demo-autoplay.ts` that commits two phantom players to a round so matchmaking can run during the video demo.
5. **Environment**: `.env.demoland` mode using mock provider (zero-network demo) + `.env.zkmonitor` for live standalone Docker demo.

Estimated effort: **1 build-day**. We can ship this Friday (May 15).

---

## Required Changes to ZKSplunk Connector (Minor)

1. **Config block for BlindOracle event types** in `connector/src/adapters/blindoracle.ts`:
   - `commit-submitted`
   - `round-locked`
   - `match-derived`
   - `settlement-proof-generated`
   - `settlement-proof-failed`
   - `payout-distributed`
2. **14 ZK-specific fields already extracted** — extend with BlindOracle's 6 above.
3. **11 SPL saved searches** — add 3 BlindOracle-specific ones (proof failure rate per round, settlement latency p95, idle rounds without commits).

Estimated effort: **half a build-day**.

---

## Setup Sequence for Judges (Reproduction Recipe)

```bash
# 1. Spin up Midnight local network (official tool)
git clone https://github.com/midnightntwrk/midnight-local-dev.git
cd midnight-local-dev && npm install && npm start
# → interactive CLI; Option [2] paste BlindOracle wallet address to fund

# 2. Clone ZKSplunk
git clone https://github.com/bytewizard42i/ZKSplunk_Splunking_w_Midnight.git
cd ZKSplunk_Splunking_w_Midnight
cp .env.example .env
# edit: NETWORK_ID=undeployed, SPLUNK_HEC_URL, SPLUNK_HEC_TOKEN, SPLUNK_INDEX

# 3. Run BlindOracle demo DApp (separate clone or submodule)
cd ../BlindOracle-Gimbalabs_hackathon
yarn install && yarn dev   # UI on :5177, picks up Lace "Undeployed"

# 4. Run ZKSplunk connector
cd ../ZKSplunk_Splunking_w_Midnight/connector
yarn install && yarn start

# 5. Open Splunk dashboard → see events flowing in real time
```

Goal: **under 30 minutes from `git clone` to first event in Splunk** on a judge's laptop.

---

## Open Questions (For John)

1. **Splunk Cloud trial limits**: do trial accounts cap HEC events/day? Need to confirm our demo can run for the 28-day judging period without throttling.
2. **GitHub repo visibility**: when do we flip it from private to public? My vote: **June 13, 2026** (2 days before deadline) — gives us breathing room to scrub anything sensitive.
3. **Demo video** — record on John's ASUS Pro Art (artpro)? Chuck can't run ZK proofs (Haswell). Penny suggests artpro for the live demo + simulated data fallback for the recording.
4. **Co-author?** ZKSplunk is currently EnterpriseZK Labs LLC. Is there anyone we should add as the second team member (max 2)? Zoe Braiterman has Splunk-adjacent security background — worth asking?

---

*Penny will revisit this doc if Splunk publishes anything between now and May 18 that changes the calculus. Otherwise, **Option D+A locks in Friday May 16**.*
