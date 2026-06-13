# Splunk API Integration + Midnight Local-Dev Wiring

> **Status:** Reference + Setup Guide (v0.1)
> **Date:** 2026-06-09
> **Author:** Penny / EnterpriseZK Labs LLC
> **Sources:** dev.splunk.com tutorials, docs.splunk.com (HEC + REST), and
> `MIDNIGHT_LOCAL_DEV_AND_ECOSYSTEM_2026-05-13.md`.

---

## 0. TL;DR

- Splunk exposes **three** ports: HEC `:8088`, REST management `:8089`, Web UI `:8000`.
- The Midnight `midnight-local-dev` indexer **also binds `:8088`**, which collides with Splunk HEC's default.
- **Resolution (chosen, least-risk):** keep Midnight on `:8088` (it's hardcoded to match Lace `undeployed`), and move our **local** Splunk HEC to **`:8090`**. Splunk Cloud stays on `:8088` (remote, no collision).
- We fixed a stale connector default along the way: the Midnight indexer URL was `http://localhost:8080/api/v1/graphql`; the correct local-dev value is `http://localhost:8088/api/v3/graphql`.

---

## 1. Port map (single source of truth)

| Service | Host | Port | Path / note |
|---|---|---|---|
| Splunk HEC (Cloud) | `<instance>.splunkcloud.com` | 8088 | `/services/collector/event` |
| Splunk HEC (local) | `localhost` | **8090** | moved off 8088 to avoid the Midnight collision |
| Splunk REST mgmt | `localhost` | 8089 | `/services/...` |
| Splunk Web UI | `localhost` | 8000 | dashboards, manual SPL |
| Midnight Node | `localhost` | 9944 | `http://localhost:9944` |
| Midnight Indexer (GraphQL) | `localhost` | 8088 | `http://localhost:8088/api/v3/graphql` |
| Midnight Indexer (WS) | `localhost` | 8088 | `ws://localhost:8088/api/v3/graphql/ws` |
| Midnight Proof Server | `localhost` | 6300 | `http://localhost:6300` |

> Midnight's `:8088` matches Lace wallet's hardcoded `undeployed` defaults, so it
> must not move. That is why Splunk HEC moves to `:8090` locally instead.

---

## 2. Splunk API surface

### 2.1 HEC (ingest) — `:8088` / `:8090`

What we already use in `connector/src/hec-client.ts`.

```bash
curl -k https://localhost:8090/services/collector/event \
  -H "Authorization: Splunk <HEC_TOKEN>" \
  -d '{"event":{"type":"midnight.vital.check","vital_id":"proof-server","status":"healthy"},"sourcetype":"midnight:vitals","index":"zksplunk"}'
```

- Header auth: `Authorization: Splunk <token>`.
- Batch form: newline-delimited JSON objects (our client does this).
- Endpoints: `/services/collector` (raw/event) and `/services/collector/event` (event-only).

### 2.2 REST management — `:8089`

Not wired yet. This is the programmatic-setup + search surface (and the hook for
the `ai-agent`).

| Endpoint | Method | Purpose |
|---|---|---|
| `/services/auth/login` | POST | exchange `username`/`password` for a session key |
| `/services/data/indexes` | POST | create the `zksplunk` index in code |
| `/services/data/inputs/http` | POST | create / enable a HEC token in code |
| `/services/search/jobs` | POST | start an SPL search (returns a `sid`) |
| `/services/search/jobs/{sid}/results?output_mode=json` | GET | fetch search results |
| `/services/saved/searches` | POST | install our zkZap detections as saved searches |

```bash
# login -> session key
curl -k https://localhost:8089/services/auth/login \
  -d username=admin -d password=<pw> -d output_mode=json

# run a search
curl -k https://localhost:8089/services/search/jobs \
  -H "Authorization: Splunk <sessionKey>" \
  -d search='search index=zksplunk sourcetype=midnight:vitals vital_id=proof-server | stats avg(response_time_ms)' \
  -d output_mode=json
```

### 2.3 Web UI — `:8000`

Manual dashboards and SPL during development; not part of the automated pipeline.

---

## 3. dev.splunk.com tutorials → our `splunk-app/`

The `/enterprise/tutorials/` path is the app-build track. It maps directly onto
our unbuilt `splunk-app/` package:

| Tutorial module | What it teaches | Use for ZKSplunk |
|---|---|---|
| Module 1 — Get started | app structure, create index, sample events, saved searches, permissions, nav | scaffold `splunk-app/`, install the 11 SPL saved searches |
| Module 2 — Setup page | securely store a secret in `app.conf` | store HEC token / Midnight endpoint at install time |
| Module 3 — External lookup | Python script enriching SPL results from an external source | call the Midnight indexer / Blockfrost from inside SPL |
| Module 4 — Validate & package | `app.conf` validation, packaging, App Inspect | the checklist for the **Best Use of Splunk Developer Tools** bonus |
| Standalone — Custom view | third-party visualization inside Splunk | optional richer zkZap panels |

---

## 4. End-to-end local bring-up (target flow)

1. Start Midnight: `cd midnight-local-dev && npm start` (node :9944, indexer :8088, proof :6300).
2. Start Splunk locally with **HEC on :8090** (HEC Global Settings) + REST on :8089 + Web on :8000.
3. Create the `zksplunk` index (Web UI, or `POST /services/data/indexes`).
4. Create a HEC token scoped to `zksplunk` (Web UI, or `POST /services/data/inputs/http`).
5. `cp .env.example .env`; set `SPLUNK_HEC_URL=https://localhost:8090`, `SPLUNK_HEC_TOKEN=<token>`, `MIDNIGHT_INDEXER_URL=http://localhost:8088/api/v3/graphql`.
6. Run the connector (`zkMonitor`) → events land in the `zksplunk` index.
7. Run SPL detections (Web UI or `POST /services/search/jobs`).

---

## 5. What changed in the repo (2026-06-09)

| File | Change |
|---|---|
| `connector/src/config.ts` | local HEC default `:8088 → :8090`; indexer `8080/api/v1 → 8088/api/v3`; explanatory comments |
| `.env.example` | indexer URL fixed; HEC port-collision note |
| `zkMonitor/.env.zkmonitor` | indexer URL fixed; HEC port-collision note |
| `docs/DEMOLAND_VS_ZKMONITOR.md` | indexer `:8080 → :8088`, node `:9944` |
| `zkMonitor/README.md` | indexer `:8080 → :8088`, node `:9944` |

---

## 6. Open / next

- **Build `connector/src/splunk-rest-client.ts`** — login + create-index + create-HEC-token + run-search, so setup is scriptable and demoable for the Dev Tools bonus.
- **Scaffold `splunk-app/`** per Module 1 + 4 (saved searches + App Inspect).
- Confirm Splunk Cloud trial event/day caps if we use Cloud instead of local.

---

*Reference by Penny for ZKSplunk. Verify Splunk endpoints against docs.splunk.com
and Midnight ports against `MIDNIGHT_LOCAL_DEV_AND_ECOSYSTEM_2026-05-13.md`.*
