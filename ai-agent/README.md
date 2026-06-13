# ZKSplunk ai-agent — zkZap analyst

An evidence-based MCP/chat analyst that answers operational questions about
Midnight component health **strictly from Splunk evidence**. Web chat defaults to
`http://localhost:8787`, or `https://localhost:8787` when local TLS is enabled.

```
Browser chat UI :8787
      |
      v
ai-agent backend ── evidence prefers ──> Splunk MCP Server (app 7931)
      |                    fallback ──> Splunk REST API :8089
      v
predefined SPL library ── phrasing prefers ──> Splunk AI Toolkit | ai
                              fallback ──> external OpenAI-compatible LLM
```

## Run

```bash
cd ai-agent
cp .env.example .env     # fill in Splunk auth (REST token or user/pass)
npm install
npm run start            # http://localhost:8787
```

No build step — runs from TypeScript via `tsx`.

## Local HTTPS for Splunk embedding

If Splunk Web is loaded over HTTPS, browsers block an embedded
`http://localhost:8787` chat frame as mixed content. Run the analyst over HTTPS:

```bash
cd ai-agent
npm run cert:localhost
```

Then add the printed values to `ai-agent/.env`:

```env
AI_AGENT_TLS_CERT=certs/localhost.pem
AI_AGENT_TLS_KEY=certs/localhost-key.pem
```

Restart the agent:

```bash
npm run start            # https://localhost:8787
```

Allow Splunk dashboards to embed the local HTTPS chat:

```bash
npm run splunk:trust-chat
```

This updates Splunk's system-level Dashboards Trusted Domains List through
`/servicesNS/nobody/system/web-features/feature:dashboards_csp`, adding
`https://localhost:8787` and loopback variants. Splunk documents this as the
supported way to permit external iframe content in SimpleXML and Dashboard
Studio without disabling the external-content safeguards.

For a self-signed certificate, the browser may still require one manual trust
step. Open `https://localhost:8787` directly once and continue/trust the local
certificate; the Splunk iframe can load it after that. A `mkcert` certificate is
cleaner if you want a locally trusted cert with no browser warning.

## Evidence sources (in priority order)

1. **Splunk MCP Server** — set `SPLUNK_MCP_ENDPOINT` (+ optional token). Preferred.
2. **Splunk REST** — `SPLUNK_REST_URL` (default `https://localhost:8089`) with
   either `SPLUNK_REST_TOKEN` or `SPLUNK_USERNAME`/`SPLUNK_PASSWORD`.
   `SPLUNK_INSECURE=true` (default for localhost) skips self-signed TLS checks.

If neither is reachable, the analyst answers `UNKNOWN` and tells the operator to
start the agent / fix Splunk connectivity — it never fabricates telemetry.

## Splunk AI Toolkit phrasing (preferred)

For the hackathon path, set `SPLUNK_AI_TOOLKIT_ENABLED=true` after installing
and configuring Splunk AI Toolkit. The analyst phrases answers through
Splunk's `| ai` command, while evidence still comes from Splunk MCP/REST.
The tested local configuration uses the AI Toolkit connection `ZKsplunk3`:

```spl
| ai prompt="{prompt}" provider=Gemini model=gemini-2.5-flash
```

Set the same provider/model in `.env`:

```env
SPLUNK_AI_TOOLKIT_ENABLED=true
SPLUNK_AI_TOOLKIT_PROVIDER=Gemini
SPLUNK_AI_TOOLKIT_MODEL=gemini-2.5-flash
```

Leave provider/model blank only if the Splunk user has a working default AI
Toolkit mapping. For this project, keeping the tested values explicit avoids
accidentally using an older connection.

If AI Toolkit is not enabled, set `NVIDIA_API_KEY` or `OPENAI_API_KEY` as a
fallback. External models only *rephrase* evidence already gathered from Splunk;
with no key, deterministic markdown is returned.

## API

- `GET /api/health` → analyst + Splunk reachability, evidence source, LLM on/off.
- `POST /api/ask` `{ "question": string }` →
  `{ markdown, classification, evidenceSource, phrasedByLlm }`.

## Answer contract

Every answer contains: **Classification · Evidence · Time window · Confidence ·
Impact · Recommended action · Privacy boundary**.

The analyst never claims visibility into private Midnight state, witness
arguments, shielded parties, or shielded amounts. Core framing:

> Metadata and volumes are public. Contents are private. ZKSplunk observes.

## Predefined query library

`src/zkzap-analyst.ts` ships the spec's searches: Current Health, Proof/Indexer
Trend, Recent Alertable Conditions, Connector Health, Block Cadence. Generated
SPL is intentionally not exposed yet — predefined searches first.
