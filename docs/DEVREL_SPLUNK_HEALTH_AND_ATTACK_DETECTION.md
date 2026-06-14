# ZKSplunk — DevRel Health Monitor & Real-Time Attack Detection

**Status**: Design Specification — **forward-looking**  
**Last Updated**: Apr 21, 2026  
**Audience**: Developers integrating Midnight DApps, Splunk engineers, DevRel team

> **Status note.** The live **health pulse** (proof-server / indexer / wallet /
> contract vitals → Splunk) is implemented. The **attack-signal enrichment**
> (`attack-signals.ts`), the **AI-agent alerting**, and the **SOAR** flows below
> are **planned / future work** — they are not built yet. Treat this as a design
> spec, not a description of shipped behavior.

---

## What This Is

ZKSplunk can serve a dual purpose:

1. **Ecosystem Health Pulse** — A public-facing, always-on dashboard that shows the live
   health of the Midnight Network's ZK-proof infrastructure (proof server latency, indexer
   uptime, wallet connectivity, contract state). Perfect as a DevRel "trust signal" — developers
   visiting docs or the ecosystem site can see that the system is healthy before they start
   building.

2. **Real-Time Attack Detection & Agent Warnings** — By streaming telemetry from every
   Midnight DApp that embeds MidnightVitals into Splunk, the ZKSplunk AI agent can detect
   anomalous patterns that signal attacks — DDoS, proof-flooding, contract griefing — and fire
   warning alerts *before* an incident escalates.

This document describes the architecture, the attack signal taxonomy, and the Splunk AI agent
wiring needed to make both features real.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MIDNIGHT DAPP LAYER                             │
│                                                                         │
│   Any DApp embedding MidnightVitals                                     │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│   │ Proof Server │  │  Indexer /   │  │  Wallet /    │  + ZKSplunk     │
│   │ Health Check │  │  Network     │  │  DUST        │  contract       │
│   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  attestation   │
│          │                 │                  │                         │
│          └─────────────────┴──────────────────┘                        │
│                           │                                             │
│                  MidnightVitals VitalsProvider                         │
│                  (proof-server, network, wallet, contracts)             │
└───────────────────────────┬─────────────────────────────────────────────┘
                            │  onVitalCheck / onLogEntry callbacks
                            ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                       ZKSPLUNK CONNECTOR LAYER                            │
│                                                                           │
│   SplunkForwarder                                                         │
│   ├── vitals-adapter.ts  (transforms VitalCheckResult → HEC events)      │
│   ├── hec-client.ts      (HTTP POST to Splunk Cloud HEC endpoint)        │
│   ├── field-extractions  (indexed fields for fast SPL queries)           │
│   └── [NEW] attack-signals.ts  (anomaly enrichment before HEC send)     │
│                                                                           │
│   Midnight indexer feed (public chain data) — planned Macro lens         │
└───────────────────────────┬───────────────────────────────────────────────┘
                            │  HTTPS HEC + batch events
                            ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                          SPLUNK CLOUD / SELF-HOSTED                        │
│                                                                            │
│  Index: zksplunk                                                           │
│  Sourcetype: midnight:vitals                                               │
│                                                                            │
│  ┌─────────────────────┐  ┌──────────────────────────────────────────┐   │
│  │  DevRel Health      │  │  Attack Detection Dashboard               │   │
│  │  Dashboard          │  │  (proof flood, griefing, DDoS signals)    │   │
│  │  (public-facing)    │  │                                            │   │
│  └─────────────────────┘  └──────────────────────────────────────────┘   │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │  ZKSplunk AI Agent (Splunk AI Assistant / SOAR Playbook)            │  │
│  │  Correlates: latency spikes + rejection rates + block anomalies      │  │
│  │  Fires: "Imminent attack" alert → Slack / PagerDuty / on-chain      │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 1 — DevRel Health Pulse

### What It Shows

A public Splunk dashboard (shareable URL, read-only token) that renders:

| Panel | SPL Query | What It Tells Developers |
|-------|-----------|--------------------------|
| **Proof Server Status** | `latest(status) by vital_id` | "Can I generate ZK proofs right now?" |
| **Network / Indexer** | `avg(response_time_ms) where vital_id=network` | "Is the indexer responsive?" |
| **Wallet Connectivity** | `latest(status) where vital_id=wallet` | "Can my wallet connect?" |
| **Contract Health** | `latest(status) where vital_id=contracts` | "Are deployed contracts reachable?" |
| **30-Day Uptime** | `timechart span=1d avg(health_percentage)` | "How reliable has the network been?" |
| **Proof Latency Trend** | `timechart span=5m avg(response_time_ms) where vital_id=proof-server` | "How fast are proofs recently?" |

### How It Works

The `SplunkForwarder` already calls `handleVitalCheck` → `vitalCheckToSplunkEvent` → HEC.
The DevRel dashboard just needs:

1. A Splunk app package with the dashboard XML.
2. A **read-only access token** scoped to the `zksplunk` index.
3. An `<iframe>` or Splunk embedded dashboard link on `docs.midnight.network` or the
   ecosystem landing page.

### Recommended Check Intervals for DevRel Pulse

```
proof-server  →  15s   (high sensitivity — ZK proofs are the core capability)
network       →  30s   (indexer is usually stable)
wallet        →  60s   (wallet health changes slowly)
contracts     →  60s   (contract state changes on-chain, not in real time)
```

These can be set in the `VitalsProvider` config per DApp. ZKSplunk aggregates across
all contributing DApps into one ecosystem-wide view.

---

## Part 2 — Real-Time Attack Detection

### Attack Signal Taxonomy

The following signal types map to detectable attack patterns on Midnight:

#### Signal 1 — Proof Server Flood (DDoS / Resource Exhaustion)

**What it looks like**:
- Proof server response time spikes from < 200ms to > 5,000ms
- Sustained for 3+ consecutive check intervals
- Affects all DApps simultaneously (global signal, not one DApp)

**Splunk detection query**:
```spl
sourcetype="midnight:vitals" vital_id="proof-server"
| timechart span=1m avg(response_time_ms) as avg_latency
| where avg_latency > 5000
| eval signal="proof_flood"
```

**Threat level**: High — ZK proofs are required for all private transactions.
If the proof server is overwhelmed, the entire network goes dark for end users.

---

#### Signal 2 — Proof Rejection Rate Spike (Invalid Proof Flooding)

**What it looks like**:
- On-chain: high rate of transactions rejected (invalid ZK proof submissions)
- Midnight indexer subscription: `contractActions` showing unusual `REJECTED` counts

**Splunk detection query**:
```spl
sourcetype="midnight:vitals" event.type="midnight.vital.check" vital_id="contracts"
| timechart span=2m count(eval(status="critical")) as failures, count as total
| eval rejection_rate = failures / total * 100
| where rejection_rate > 30
| eval signal="proof_rejection_flood"
```

**Threat level**: Medium-High — Could indicate a bot submitting junk transactions to
consume block space (a form of griefing).

---

#### Signal 3 — Network Partition / Indexer Isolation

**What it looks like**:
- Network vital goes `critical` across multiple DApps simultaneously
- Midnight indexer WebSocket subscription drops (reconnect storm)
- Block height stops advancing (stale indexer)

**Splunk detection query**:
```spl
sourcetype="midnight:vitals" vital_id="network"
| stats count(eval(status="critical")) as critical_count, dc(dapp_name) as affected_dapps by _time span=5m
| where critical_count > 0 AND affected_dapps > 2
| eval signal="network_partition"
```

**Threat level**: High — If multiple DApps simultaneously lose network connectivity,
a partition or BGP attack may be in progress.

---

#### Signal 4 — Wallet / DUST Drain Attack

**What it looks like**:
- DUST balance for many wallets drops to zero in a short window
- `dustLedgerEvents` subscription (via the Midnight indexer) shows unusual outflow patterns

**Splunk detection query**:
```spl
sourcetype="midnight:vitals" vital_id="wallet"
| timechart span=5m count(eval(status!="healthy")) as wallet_failures
| where wallet_failures > 10
| eval signal="dust_drain"
```

**Threat level**: Medium — Could indicate a targeted campaign draining DUST from
developer wallets, blocking transaction submission.

---

#### Signal 5 — Smart Contract Griefing

**What it looks like**:
- Contract vital flips `critical` on specific addresses only (not global)
- On-chain: contract state transitions at an abnormally high rate (spam calls)
- Attestation count on `zksplunk.compact` spikes (if attestation is enabled)

**Splunk detection query**:
```spl
sourcetype="midnight:vitals" vital_id="contracts"
| stats count by dapp_name, status
| where status="critical"
| join dapp_name [search sourcetype="midnight:vitals" event.type="midnight.vital.check"
  | stats avg(response_time_ms) as avg_rt by dapp_name]
| where avg_rt > 3000
| eval signal="contract_griefing"
```

**Threat level**: Medium — Contract griefing can exhaust gas or force contract into
unexpected states.

---

### New Fields Needed: `attack-signals.ts`

To support the above detection queries, the connector needs a new enrichment module
`connector/src/attack-signals.ts` that:

1. Maintains a **rolling window** of recent `VitalCheckResult` values (last N checks per `VitalId`).
2. Computes derived fields before HEC send:
   - `rolling_avg_latency_ms` — 5-minute rolling average
   - `consecutive_critical_count` — how many checks in a row were critical
   - `status_changed` — boolean: did status change since last check?
   - `status_change_direction` — `degraded` | `recovered` | `stable`
   - `cross_dapp_critical` — boolean: is the same vital critical in 3+ DApps right now?
3. Adds an `attack_signal` field when a heuristic threshold is breached (pre-Splunk,
   as a "warm" signal; Splunk's statistical detection is the authoritative source).

```typescript
// connector/src/attack-signals.ts (skeleton — implementation TBD)

export interface AttackSignalEnrichment {
  rolling_avg_latency_ms: number | null;
  consecutive_critical_count: number;
  status_changed: boolean;
  status_change_direction: 'degraded' | 'recovered' | 'stable';
  attack_signal: string | null;  // e.g. "proof_flood" or null
  attack_signal_confidence: 'low' | 'medium' | 'high' | null;
}

export class AttackSignalDetector {
  // Rolling window per VitalId
  // compute() returns AttackSignalEnrichment given current VitalCheckResult
  // mergeIntoEvent() splices enrichment into SplunkHecEvent before HEC send
}
```

---

## Part 3 — Splunk AI Agent: Imminent Attack Warnings

### Agent Design

The ZKSplunk AI Agent is a Splunk AI Assistant action that:

1. **Monitors** a saved Splunk search for any of the 5 attack signals above.
2. **Correlates** multiple weak signals into a higher-confidence warning
   (e.g., proof latency spike + network critical across 3 DApps = "High confidence DDoS").
3. **Fires alerts** via:
   - Splunk alert action → **Slack webhook** (immediate team notification)
   - Splunk SOAR playbook → **PagerDuty** (if severity is critical)
   - On-chain: calls `attestCriticalIncident()` on `zksplunk.compact` (tamper-evident record)

### Alert Levels

| Alert Level | Condition | Action |
|-------------|-----------|--------|
| 🟡 **Advisory** | Single signal, 1 DApp | Log to Splunk, Slack `#midnight-devrel` channel |
| 🟠 **Warning** | Signal sustained 10+ min OR affects 2+ DApps | Slack `@here`, SOAR creates ticket |
| 🔴 **Critical** | Signal sustained 20+ min OR affects 5+ DApps | PagerDuty, on-chain `attestCriticalIncident` |

### Splunk Saved Search (Alert Trigger)

```spl
index=zksplunk sourcetype="midnight:vitals"
| eval is_attack_signal=if(isnotnull(attack_signal), 1, 0)
| stats sum(is_attack_signal) as signal_count,
        dc(dapp_name) as affected_dapps,
        values(attack_signal) as signals,
        max(attack_signal_confidence) as max_confidence
  by _time span=5m
| where signal_count >= 2 OR (signal_count >= 1 AND affected_dapps >= 3)
| eval alert_level=case(
    affected_dapps >= 5, "critical",
    affected_dapps >= 2, "warning",
    true(), "advisory"
  )
```

### MCP Bridge (Dual-Agent Mode)

When the Splunk AI Agent detects an imminent attack, it can invoke the Midnight MCP
tools to:

- Query `getAttestationCount()` — confirm on-chain attestation activity matches
  the off-chain signal (correlation check).
- Call `attestCriticalIncident()` — append an anonymous, unlinkable on-chain
  incident record.
- Read `attestationCount` / the public `incidentLog` — show how many incidents
  have been recorded over time in the DevRel dashboard (transparency metric).

This is the **dual-MCP bridge**: Splunk's AI layer talks to both the Splunk MCP
(for alert management) and the Midnight MCP (for on-chain incident attestation).

---

## Part 4 — Implementation Roadmap

### Phase 1 — DevRel Health Pulse (MVP, ~1 week)

- [ ] Wire `SplunkForwarder` into at least one real Midnight DApp (e.g., `DiscoveryManagement`).
- [ ] Create Splunk app package: `app.conf`, dashboard XML for the 6 DevRel panels.
- [ ] Publish read-only dashboard link.
- [ ] Add `devrel_mode: boolean` flag to `ZKSplunkConfig` — when true, events get
      `audience: "devrel"` field for easy dashboard filtering.

### Phase 2 — Attack Signal Enrichment (~1 week)

- [ ] Implement `connector/src/attack-signals.ts` (`AttackSignalDetector` class).
- [ ] Integrate detector into `SplunkForwarder.handleVitalCheck` before HEC send.
- [ ] Add `attack_signal` and `attack_signal_confidence` to `field-extractions.ts`.
- [ ] Write Splunk saved searches for all 5 attack signal types.

### Phase 3 — AI Agent & Alerting (~1 week)

- [ ] Configure Splunk AI Assistant action on saved search.
- [ ] Build Slack webhook alert action.
- [ ] Build SOAR playbook skeleton (advisory → warning → critical escalation).
- [ ] Wire Midnight MCP bridge: `attestCriticalIncident()` on critical alerts.

### Phase 4 — Public Demo (~hackathon deadline)

- [ ] Deploy ZKSplunk connector on a cloud server (or GitHub Actions cron).
- [ ] Publish DevRel health dashboard at a shareable URL.
- [ ] Record "real-time attack detection" demo (simulated proof-flood).
- [ ] Update `DEAR_JUDGES.md` with live dashboard link.

---

## Related Files

| File | Purpose |
|------|---------|
| `connector/src/vitals-adapter.ts` | Transforms VitalCheckResults to HEC events |
| `connector/src/splunk-forwarder.ts` | Manages HEC batching and forwarding lifecycle |
| `connector/src/attack-signals.ts` | **[TO BUILD]** Rolling-window attack signal enrichment |
| `zkMonitor/src/http-vitals-provider.ts` | Live HTTP health checks for vitals |
| `contract/src/zksplunk.compact` | On-chain anonymous critical-incident attestation |
| `docs/HACKATHON_STRATEGY.md` | Overall hackathon strategy and sprint plan |
| `docs/DEAR_JUDGES.md` | Submission pitch document |
