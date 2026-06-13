# ZKSplunk Architecture Diagram

This is the required hackathon architecture diagram file. It shows how ZKSplunk
interacts with Splunk, how the Splunk-native AI Toolkit analyst is integrated,
and how data flows between the Midnight infrastructure, ZKSplunk services,
Splunk, and the operator-facing chat.

For VS Code Mermaid preview, open [`architecture_diagram.mmd`](architecture_diagram.mmd).
This `.md` file is kept at the repository root because the hackathon rules
require `architecture_diagram.md`, `architecture_diagram.pdf`, or
`architecture_diagram.png`.

```mermaid
graph TD
  A1[Proof server] --> B1[HttpVitalsProvider]
  A2[Indexer GraphQL and WebSocket] --> B1
  A3[Node RPC] --> B1
  A4[Wallet public boundary] --> B1
  A5[Contracts public metadata] --> B1

  B1 --> B2[Seven live probes]
  B2 --> B3[VitalCheckResult events]
  B3 --> C1[SplunkForwarder]

  C1 --> C2[HEC client]
  C1 --> C3[Field extraction schema]
  C1 --> C4[Telemetry commitments]
  C2 --> D1[Splunk HTTP Event Collector]

  D1 --> D2[index equals zksplunk]
  D2 --> D3[Saved searches and alerts]
  D2 --> D4[Splunk dashboards]
  D2 --> D5[Splunk REST API]
  D2 --> D6[Splunk MCP Server]
  D2 --> D7[Splunk AI Toolkit]

  F1[Operator browser] --> E0[Splunk tab ZKSplunk AI Toolkit Analyst]
  E0 --> E6[SPL evidence aggregation]
  E6 --> D2
  E6 --> D7
  D7 --> E7[ai_result_1 answer]

  F1 --> E1[Local ZKSplunk chat UI fallback]
  E1 --> E2[API route api ask]
  E2 --> E3[zkZap analyst]
  E3 --> E4[Predefined SPL evidence library]

  E4 --> D6
  D6 --> E4
  E4 -. REST fallback .-> D5
  D5 -. REST results .-> E4
  E3 --> E5[Splunk AI Toolkit phrasing client]
  E5 --> D7
  D7 --> E5
  E3 -. external fallback only .-> E8[OpenAI compatible LLM]
  E5 --> E3
  E3 --> F2[Evidence backed answer]
  F2 --> F3[Recommended action]

  C4 -. optional proof anchor .-> G1[zksplunk compact]
  E3 -. optional critical incident .-> G1
  G1 --> G2[Anonymous public incident class]
  G1 --> G3[Tamper evident commitment]
```

## Runtime Flow

1. `zkMonitor` probes live Midnight infrastructure: proof server, indexer, node,
   wallet public boundary, contract monitorability, block cadence, and version
   metadata.
2. The `connector` converts those observations into Splunk HEC events and sends
   them to `index=zksplunk`.
3. The Splunk app provides dashboards, saved searches, and alert surfaces over
   that live telemetry.
4. The primary operator path is the **ZKSplunk AI Toolkit Analyst** tab inside
   the Splunk app. It aggregates live `index=zksplunk` evidence with SPL and
   calls Splunk AI Toolkit directly with
   `| ai prompt="{prompt}" provider=Gemini model=gemini-2.5-flash`.
5. The local `ai-agent` chat remains available at `localhost:8787`. It uses
   Splunk MCP Server at runtime to run SPL against live Splunk evidence. If MCP
   is not configured, it falls back to Splunk REST for evidence.
6. Answer phrasing prefers Splunk AI Toolkit. External OpenAI-compatible LLMs
   are fallback-only and never supply facts. The live facts, health status,
   counts, and latency claims come from Splunk evidence.
7. Optional on-chain attestation anchors only public incident classes and
   telemetry commitments. Private Midnight state, witness values, shielded
   parties, and shielded amounts are never observed.
