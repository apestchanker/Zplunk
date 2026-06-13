# ZKSplunk — zkMonitor

**Live wiring. Real vitals → real Splunk Cloud HEC → optional on-chain attestation.**

zkMonitor connects the real `SplunkForwarder` to a live `HttpVitalsProvider` that
performs actual HTTP health checks against your Midnight infrastructure, and
forwards events to a real Splunk HEC endpoint. It is the same connector code
demoLand uses — only the **source** (live HTTP) and **sink** (real HEC) differ.

> See `../docs/DEMOLAND_VS_ZKMONITOR.md` for the architecture.

## Prerequisites

- A **Splunk Cloud** (or self-hosted) HEC URL + token.
- Live Midnight infrastructure: the local-dev stack (proof server `:6300`,
  node `:9944`, indexer `:8088`) or your hosted endpoints.
- (Optional) A deployed `zksplunk.compact` address + wallet for real attestation.

## Run it

```bash
cd zkMonitor
cp .env.zkmonitor .env       # then edit .env — set SPLUNK_HEC_TOKEN etc.
npm install
npm run start               # connects to HEC, polls live vitals
npm run typecheck           # strict tsc, no emit
```

`.env` is git-ignored — **never commit a real HEC token**. `.env.zkmonitor` is a
placeholder-only template.

## Behavior

- On start it prints the resolved config and attempts a HEC health check.
- If Splunk is unreachable it logs clearly and **keeps polling** (so you can see
  live vital states locally even before HEC is configured).
- Each vital is checked on its configured interval (`POLL_INTERVAL_*`).
- `wallet` reports `tracked` when `MIDNIGHT_WALLET_ADDRESS` is configured by
  subscribing to public unshielded activity through the indexer WebSocket.
  Shielded balances stay private and are never read without a viewing key.
  Without an address, it reports the headless privacy boundary as `unknown`.
- Until on-chain attestation is enabled, a `MockAttestationClient` exercises the
  confirmed/failed event path end-to-end.
- `Ctrl-C` flushes remaining events and shuts down gracefully.

## Files

| File | Role |
|------|------|
| `src/index.ts` | Live orchestrator: config → forwarder → polling loop |
| `src/http-vitals-provider.ts` | Real HTTP health checks (proof server, indexer) |
| `.env.zkmonitor` | Config template (placeholders only) |

## Going fully live

Swap the `MockAttestationClient` for a real midnight.js-backed client and
replace the mock attestation path with the Midnight SDK.
Nothing above the provider/attestation interfaces changes.
