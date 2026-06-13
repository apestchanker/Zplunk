<p align="center">
  <strong>🏗️ ZKSPLUNK — demoLand / zkMonitor Architecture 🏗️</strong><br/>
  <em>Same pipeline. Same code. Different backend. One uses simulated vitals + a local sink, the other uses live Midnight infrastructure + Splunk Cloud.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/demoLand-No_Docker_No_Cloud-blue" alt="demoLand"/>
  <img src="https://img.shields.io/badge/zkMonitor-Live_Midnight_+_Splunk-black" alt="zkMonitor"/>
  <img src="https://img.shields.io/badge/Pattern-DIDzMonolith_Standard-green" alt="Pattern"/>
</p>

---

> ZKSplunk follows the **demoLand / zkMonitor** separation pattern used across all
> DIDzMonolith products (ProofOrBluff, DiscoveryManagement, realVote, …). ZKSplunk
> is a connector/library rather than a frontend DApp, so the two sides are **thin
> orchestrators over the shared packages** (`connector/`, `vitals/`, `contract/`,
> `blockfrost-provider/`) — they do **not** duplicate pipeline logic.

---

## Why this exists

The hackathon demo must be **reproducible and safe to record** — a live proof
server crashing mid-recording would be a disaster. At the same time, the
submission needs **credibility** — real telemetry flowing into real Splunk. The
demoLand / zkMonitor split gives us both:

| | demoLand | zkMonitor |
|---|----------|----------|
| **Vitals source** | `MockVitalsProvider` (simulated health checks) | live HTTP checks against proof server / indexer / wallet |
| **Splunk sink** | local sink → console + `out/events.jsonl` | real Splunk Cloud HEC endpoint |
| **On-chain attestation** | `MockAttestationClient` (in-memory sequence + fake tx hash) | midnight.js + Lace wallet → `zksplunk.compact` |
| **Infra required** | none (no Docker, no internet, no Splunk account) | Midnight standalone Docker + Splunk Cloud trial |
| **zkZap attack signals** | scripted scenarios (proof flood, mint anomaly, wallet drain, failed-auth brute force) | derived from real telemetry + public chain `Effects` |
| **Purpose** | demos, dev, CI, safe video recording | production, live demo, credibility shot |

Both sides import the **same** transform + commitment logic
(`vitals-adapter`, `telemetry-commitment`, `attestation-client`), so an event
produced in demoLand has the identical shape to one produced in zkMonitor — only
the *source* and *sink* change.

---

## Side-by-side

```
┌──────────────────────────────────┬──────────────────────────────────┐
│          d e m o L a n d          │          r e a l D e a l          │
├──────────────────────────────────┼──────────────────────────────────┤
│                                  │                                  │
│  🩺 Vitals: MockVitalsProvider   │  🩺 Vitals: live HTTP checks      │
│  📤 Sink: console + JSONL file   │  📤 Sink: Splunk Cloud HEC       │
│  ⛓️  Attest: MockAttestation     │  ⛓️  Attest: midnight.js + Lace   │
│  🎭 Attacks: scripted scenarios  │  🛰️  Attacks: real telemetry      │
│                                  │                                  │
│  No Docker / no internet         │  Proof server (Docker) required   │
│  No Splunk account               │  Splunk Cloud HEC token required  │
│  Runs offline, deterministic     │  Live network + chain             │
│                                  │                                  │
└──────────────────────────────────┴──────────────────────────────────┘
        │                                      │
        └──────────── shared packages ─────────┘
        connector/  vitals/  contract/  blockfrost-provider/
   (vitals-adapter · telemetry-commitment · attestation-client · HEC client)
```

---

## demoLand — the simulated runner

**No Docker. No Splunk account. No chain. Just the full pipeline, simulated.**

demoLand drives the real `MockVitalsProvider` through normal operation and
through a set of **zkZap attack scenarios**, transforms every reading with the
real `vitals-adapter`, anchors a subset with the real commitment logic +
`MockAttestationClient`, and writes the resulting Splunk HEC events to a local
sink (console + `demoLand/out/events.jsonl`).

### What it demonstrates
- The end-to-end event shape exactly as Splunk would receive it.
- **zkZap detection**: a simple sliding-window detector trips an incident when a
  vital degrades for N consecutive checks, then builds a telemetry snapshot,
  commits it, and "attests" it (mock) — proving the observe → detect → record
  loop without any live infrastructure.

### What demoLand does NOT have
- ❌ No live proof server / indexer / wallet
- ❌ No Splunk Cloud connection
- ❌ No real on-chain transactions (commitments are real; submission is mocked)

### Run it
```bash
cd demoLand
npm install
npm run demo            # full run: baseline + all attack scenarios
npm run demo:attacks    # attack scenarios only
```

---

## zkMonitor — the live wiring

**Live Midnight infrastructure. Real Splunk Cloud HEC. Real attestation (optional).**

zkMonitor wires the real `SplunkForwarder` to a live `HttpVitalsProvider` (which
performs actual HTTP health checks against the configured proof server and
indexer) and forwards events to a real Splunk HEC endpoint. On-chain attestation
can be enabled once the contract is deployed and a wallet is configured.

### Requires
- Midnight local-dev stack (proof server :6300, node :9944, indexer :8088), or
  Blockfrost Midnight project credentials.
- A Splunk Cloud (or self-hosted) HEC URL + token.
- (Optional) Deployed `zksplunk.compact` address + Lace wallet for real attestation.

### Run it
```bash
cd zkMonitor
cp .env.zkmonitor .env          # then fill in real secrets (HEC token, etc.)
npm install
npm run start                  # connects to Splunk HEC, polls live vitals
```

---

## Directory structure

```
ZKSplunk_Splunking_w_Midnight/
├── connector/              # SHARED — HEC client, forwarder, adapter, commitments
├── vitals/                 # SHARED — provider interface + MockVitalsProvider
├── contract/               # SHARED — zksplunk.compact
├── blockfrost-provider/    # SHARED — live public-chain data
├── demoLand/               # ← simulated runner (no infra)
│   ├── src/
│   │   ├── index.ts            # orchestrator: baseline + scenarios
│   │   ├── local-hec-sink.ts   # console + JSONL sink (HEC stand-in)
│   │   ├── attack-scenarios.ts # zkZap threat scenarios
│   │   └── zkzap-detector.ts   # sliding-window incident detector
│   ├── .env.demoland
│   ├── package.json
│   └── README.md
└── zkMonitor/               # ← live wiring
    ├── src/
    │   ├── index.ts            # orchestrator: real forwarder + polling loop
    │   └── http-vitals-provider.ts  # real HTTP health checks
    ├── .env.zkmonitor
    ├── package.json
    └── README.md
```

---

## Environment configuration

| Variable | demoLand | zkMonitor |
|----------|----------|----------|
| `ZKSPLUNK_MODE` | `demoland` | `zkmonitor` |
| `SPLUNK_HEC_URL` / `SPLUNK_HEC_TOKEN` | unused | **required** |
| `MIDNIGHT_PROOF_SERVER_URL` | unused | required |
| `MIDNIGHT_INDEXER_URL` | unused | required |
| `ZKSPLUNK_ATTEST_ENABLED` | `false` (mock) | `true` to attest on-chain |

> Secrets live only in `.env` (git-ignored). `.env.demoland` and `.env.zkmonitor`
> are committed **templates** with no real tokens.

---

## Rules (per the DIDzMonolith demoLand standard)

1. **Never import live blockchain/Splunk SDKs in demoLand** — mock everything.
2. **Shared logic stays in `connector/` and `vitals/`** — demoLand/zkMonitor only
   choose the source + sink; they must not fork the adapter or commitment code.
3. **Identical event shape** — a demoLand event and a zkMonitor event must be
   indistinguishable to Splunk except for the `environment` field.
4. **demoLand must run offline and deterministically** (seeded where practical).

---

*Companion docs: `ZKZAP_SECURITY_PROTOCOL.md` (what the attack scenarios detect),
`ai-chat/2026-06-06_zkZap_security_protocol_deep_dive.md` (design conversation).*
