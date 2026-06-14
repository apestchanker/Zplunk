# ZKSplunk — demoLand

**Simulated runner. No Docker, no Splunk Cloud, no chain.**

demoLand drives the full ZKSplunk pipeline using the real `MockVitalsProvider`,
the real `vitals-adapter` transform, the real `telemetry-commitment` hashing, and
a `MockAttestationClient` — routing the resulting Splunk HEC events to a **local
sink** (console + `out/events.jsonl`) instead of Splunk Cloud.

It also replays a set of **zkZap attack scenarios** so you can see the
observe → detect → commit → attest loop fire without any live infrastructure.

> See `../docs/06_DEMOLAND_VS_ZKMONITOR.md` for the architecture and
> `../docs/04_ZKZAP_SECURITY_PROTOCOL.md` for the threat taxonomy these scenarios map to.

## Run it

```bash
cd demoLand
npm install
npm run demo            # baseline monitoring + all zkZap attack scenarios
npm run demo:attacks    # attack scenarios only
npm run dashboard       # build out/dashboard.html from out/events.jsonl
npm run demo:dashboard  # run demo, then build the dashboard in one step
npm run typecheck       # strict tsc, no emit
```

### Splunk-parity dashboard

`npm run demo:dashboard` writes a **self-contained, offline** `out/dashboard.html`
(no CDNs — inline SVG charts). The first tabs intentionally mirror the Splunk
app views and field names so demoLand stays aligned with
`splunk-app/zksplunk`:

| Tab | Shows |
|-----|-------|
| **Overview** | current component health using `component`, `status`, `severity`, `response_time_ms`, and `message` like `zksplunk_overview` |
| **Component Detail** | per-component drilldown with `sourcetype`, `type`, `probe_name`, `endpoint`, and status fields like `zksplunk_component_detail` |
| **AI Toolkit Evidence** | the exact evidence shape sent to Splunk AI Toolkit, including `midnight:vitals`, `midnight:chain`, `midnight:contracts`, and `zksplunk:connector` summaries |
| **Proof Latency** | proof-server response time over time + 2 s threshold |
| **zkZap Incidents** | incidents grouped by threat type |
| **Vital Health** | status mix per vital + overall health % |
| **Attestations** | cumulative on-chain commitments + avg attest latency |

Open `out/dashboard.html` in any browser — safe to show on a recorded demo.

The baseline generator emits the same core sourcetypes that the Splunk app
queries: `midnight:vitals`, `midnight:chain`, `midnight:contracts`, and
`zksplunk:connector`. That means the offline view validates the same field
contract used by the real dashboards, not a separate demo-only schema.

## What you'll see

1. **Baseline** — a few cycles of mostly-healthy vitals, each transformed into the
   exact Splunk event shape zkMonitor would send.
2. **Attack scenarios** — `proof-flood`, `failed-auth-bruteforce`, `wallet-drain`,
   `mint-anomaly`, `indexer-outage`. Each degrades a vital until the zkZap detector
   trips an incident, builds a **real** telemetry commitment, and mock-attests it
   on-chain.
3. **Summary** — event count, incidents opened, and the path to `out/events.jsonl`.

Every line written to `out/events.jsonl` is a genuine `SplunkHecEvent` — feed it
straight into a Splunk index to prototype dashboards offline.

## Files

| File | Role |
|------|------|
| `src/index.ts` | Orchestrator: baseline + scenarios + summary |
| `src/local-hec-sink.ts` | HEC stand-in — console + JSONL writer |
| `src/zkzap-detector.ts` | Sliding-window incident detector (the "decide" step) |
| `src/attack-scenarios.ts` | Scripted threat signal sequences |
| `.env.demoland` | Safe, secret-free config template |

## Rules

- Never import live blockchain/Splunk SDKs here — mock everything.
- Shared logic stays in `../connector` and `../vitals`; this package only chooses
  the source (mock) and sink (local file).
- Output must be deterministic enough to demo safely on camera.
