# ZKSplunk — Future Directions & Midnight MCP Integration Map

> *Where ZKSplunk goes after the hackathon — and every Midnight capability we can observe.*

---

## Table of Contents

1. [Midnight MCP Tool Inventory](#midnight-mcp-tool-inventory)
2. [Capability-to-Observability Matrix](#capability-to-observability-matrix)
3. [Midnight.js Provider Architecture — Telemetry Opportunities](#midnightjs-provider-architecture)
4. [Splunk MCP ↔ Midnight MCP Bridge Scenarios](#mcp-bridge-scenarios)
5. [Phase 3+ Feature Roadmap](#feature-roadmap)
6. [AI Agent Evolution Path](#ai-agent-evolution)
7. [Enterprise & Multi-Chain Vision](#enterprise-vision)

---

## Midnight MCP Tool Inventory

The Midnight MCP Server (Idris) exposes **30 tools across 7 categories**. Each one represents a Midnight capability that ZKSplunk can either **observe**, **query on behalf of an AI agent**, or **use to enrich telemetry data**.

### Search Tools (4)

| Tool | What It Does | ZKSplunk Integration Potential |
|------|-------------|-------------------------------|
| `midnight-search-compact` | Semantic search across Compact smart contract code and patterns | **AI Agent**: When a proof fails, search for the circuit definition to understand complexity. Correlate proof latency with circuit structure. |
| `midnight-search-typescript` | Search TypeScript SDK code, types, and API implementations | **AI Agent**: When a wallet error occurs, search SDK code for the failing API pattern. Surface relevant type definitions in diagnostic reports. |
| `midnight-search-docs` | Full-text search across official Midnight documentation | **AI Agent**: When an operator asks "what does this error mean?", search docs for the error code and return the explanation alongside Splunk data. |
| `midnight-fetch-docs` | Fetch live documentation pages from docs.midnight.network | **AI Agent**: Retrieve the latest troubleshooting guide for a specific component. Always up-to-date, not stale training data. |

**Observability angle**: These tools let the AI agent *understand* what it's monitoring. Raw telemetry says "proof server latency: 45s." The search tools say "that's because the circuit at line 47 of your contract has a nested loop."

### Analysis Tools (4)

| Tool | What It Does | ZKSplunk Integration Potential |
|------|-------------|-------------------------------|
| `midnight-analyze-contract` | Static analysis of Compact contracts — structure, security patterns | **Proactive Monitoring**: Analyze deployed contracts for security patterns. Flag contracts with known anti-patterns before they cause production issues. |
| `midnight-explain-circuit` | Explain a circuit in plain language with ZK proof implications | **AI Agent**: When a specific circuit is slow, explain what it does and why it might be expensive. Surface privacy considerations. |
| `midnight-compile-contract` | Real compilation via hosted Compact compiler service | **CI/CD Integration**: Compile contracts before deployment and send compilation metrics to Splunk. Track compilation time trends. |
| `midnight-extract-contract-structure` | Extract circuits, witnesses, ledger structure with critical checks | **Pre-Deploy Scanning**: Before a contract deploys, extract its structure and send to Splunk. Flag deprecated syntax, missing disclose() calls, potential overflow. |

**Observability angle**: These tools enable *predictive* observability — catching problems before they manifest as runtime failures.

### Repository Tools (3)

| Tool | What It Does | ZKSplunk Integration Potential |
|------|-------------|-------------------------------|
| `midnight-get-file` | Retrieve specific files from Midnight repositories | **AI Agent**: Pull the exact contract source when investigating a failure. Show operators the code that's causing issues. |
| `midnight-list-examples` | List available example contracts and DApps with complexity ratings | **Benchmarking**: Compare your contract's performance against reference examples. "Your contract takes 45s to prove; the reference counter example takes 17s." |
| `midnight-get-latest-updates` | Retrieve recent commits across Midnight repositories | **Change Correlation**: When performance degrades, check: "Did the Compact compiler change recently? Was the proof server updated?" Correlate Splunk telemetry with upstream changes. |

**Observability angle**: Repository tools provide *context* — the "what changed?" that turns telemetry spikes into root cause analysis.

### Versioning Tools (6)

| Tool | What It Does | ZKSplunk Integration Potential |
|------|-------------|-------------------------------|
| `midnight-get-version-info` | Get latest version, release notes, breaking changes for a repo | **Drift Detection**: Track which version of the Compact compiler, SDK, and proof server each DApp is running. Alert when versions fall behind. |
| `midnight-check-breaking-changes` | Check for breaking changes between versions | **Upgrade Risk Assessment**: Before upgrading, check breaking changes and surface them in a Splunk dashboard. Quantify upgrade risk. |
| `midnight-get-migration-guide` | Detailed migration guide between versions | **AI Agent**: When a version mismatch is detected, generate the migration guide and present it to the operator with affected contract counts. |
| `midnight-get-file-at-version` | Get exact file content at a specific version | **Diff Analysis**: Compare contract behavior before and after a version change. "Latency increased after upgrading from v0.25.0 to v0.26.0 — here's what changed." |
| `midnight-compare-syntax` | Compare a file between two versions | **Breaking Change Detection**: Automatically compare Compact syntax files between versions and flag changes that might affect deployed contracts. |
| `midnight-get-latest-syntax` | Get the authoritative Compact syntax reference | **Validation**: Before deploying, verify contract syntax against the latest reference. Flag deprecated patterns in Splunk alerts. |

**Observability angle**: Version tools enable *infrastructure lifecycle management* — knowing not just what's running, but whether it's current, compatible, and upgrade-ready.

### Generation Tools (3) — Requires Sampling

| Tool | What It Does | ZKSplunk Integration Potential |
|------|-------------|-------------------------------|
| `midnight-generate-contract` | AI-powered Compact contract generation | **Future**: Auto-generate monitoring contracts — lightweight "canary" contracts deployed specifically for health checking. |
| `midnight-review-contract` | AI-powered security review | **Proactive Security**: Review contracts scheduled for deployment and send findings to Splunk. Create a security audit trail indexed by contract address. |
| `midnight-document-contract` | AI-powered documentation generation | **Documentation-as-Telemetry**: Auto-generate documentation for deployed contracts and attach it to Splunk events so operators always have context. |

**Observability angle**: Generation tools are the future of *self-documenting infrastructure* — contracts that explain themselves when they fail.

### Health Tools (8)

| Tool | What It Does | ZKSplunk Integration Potential |
|------|-------------|-------------------------------|
| `midnight-health-check` | Check Midnight MCP server health, API connectivity, resources | **Meta-Monitoring**: Monitor the Midnight MCP server itself. If the AI agent's brain goes down, Splunk should know. |
| `midnight-get-status` | Quick server status, rate limits, cache stats | **Rate Limit Tracking**: Track MCP rate limit usage over time. Alert before hitting limits during incident investigation. |
| `midnight-check-version` | Check if MCP server is up to date | **MCP Drift Detection**: Alert when the Midnight MCP server falls behind, ensuring the AI agent always has latest capabilities. |
| `midnight-auto-update-config` | (Deprecated) Config update paths | — |
| `midnight-get-update-instructions` | Platform-specific MCP update instructions | **Runbook Integration**: When MCP version drift is detected, include update instructions in the Splunk alert. |
| `midnight-list-tool-categories` | List available tool categories | **Capability Discovery**: Track which MCP capabilities are available. Useful for multi-environment monitoring. |
| `midnight-list-category-tools` | List tools within a category | **Capability Inventory**: Index all available MCP tools and their schemas in Splunk for AI agent planning. |
| `midnight-suggest-tool` | Natural language → tool recommendation | **AI Agent Routing**: When the AI agent needs to investigate, use this to choose the right tool dynamically. |

**Observability angle**: Health tools let ZKSplunk monitor *itself* and *its own AI infrastructure* — the observer observing the observer.

### Compound Tools (2)

| Tool | What It Does | ZKSplunk Integration Potential |
|------|-------------|-------------------------------|
| `midnight-upgrade-check` | Version check + breaking changes + migration guide in one call | **Scheduled Audits**: Run weekly upgrade checks across all DApps in the ecosystem. Send results to Splunk as scheduled reports. |
| `midnight-get-repo-context` | Version info + syntax reference + examples in one call | **Session Bootstrap**: When the AI agent starts an investigation, get full context in one call instead of three. Reduces latency for incident response. |

**Observability angle**: Compound tools make the AI agent *faster* at root cause analysis — fewer round trips, more insight per interaction.

---

## Capability-to-Observability Matrix

Every Midnight capability mapped to what ZKSplunk can observe about it:

| Midnight Capability | Observable Metrics | Current Support | Future Support |
|---------------------|-------------------|-----------------|----------------|
| **ZK Proof Generation** | Duration, success/fail, circuit name, prover memory usage | ✅ Via MidnightVitals | Add prover memory + CPU via Docker stats |
| **Proof Server Health** | Status, latency, version, uptime | ✅ Via MidnightVitals | Add container-level metrics |
| **Compact Contract Compilation** | Compile time, success/fail, compiler version, warnings | ❌ Not yet | Via `midnight-compile-contract` |
| **Contract Deployment** | Deploy TX hash, gas cost, time to finality | Partial (log events) | Full via Midnight.js SDK hooks |
| **Contract Interaction (calls)** | Call duration, success/fail, state changes | Partial (log events) | Full via Midnight.js providers |
| **Wallet Connection** | Connected/disconnected, extension version | ✅ Via MidnightVitals | Add connection handshake timing |
| **Wallet Balance** | DUST, NIGHT balances | ✅ Via MidnightVitals | Add balance change events, low-balance alerts |
| **Key Derivation** | Key availability | ✅ Via MidnightVitals | Add derivation timing, key rotation events |
| **Coin Selection (ZSwap)** | Pool size, selection strategy | ❌ Not yet | Via wallet SDK instrumentation |
| **Transaction Balancing** | Fee calculation, balance sufficiency | ❌ Not yet | Via wallet SDK instrumentation |
| **Transaction Submission** | TX hash, submission latency, confirmation time | ❌ Not yet | Via midnightProvider hooks |
| **Network Indexer** | Status, block height, sync lag | ✅ Via MidnightVitals | Add GraphQL query performance |
| **GraphQL Queries** | Query latency, error rate, result size | ❌ Not yet | Via publicDataProvider instrumentation |
| **Private State (LevelDB)** | Encrypted state size, read/write latency | ❌ Not yet | Via privateStateProvider instrumentation |
| **ZK Artifact Loading** | Prover/verifier key fetch time, cache hit rate | ❌ Not yet | Via zkConfigProvider instrumentation |
| **Cardano Bridge** | Cross-chain transfer status, bridge latency | ❌ Not yet | Requires bridge API integration |
| **Block Production** | Block time, validator performance | ❌ Not yet | Requires node-level access |

### Midnight.js Provider Architecture

Midnight.js uses a modular provider pattern. Each provider is a telemetry goldmine:

```
MidnightProviders (from Midnight.js SDK v2.1.0)
│
├── privateStateProvider    → Encrypted local state storage
│   └── Observable: read/write latency, state size, encryption time
│
├── publicDataProvider      → Blockchain data queries via GraphQL
│   └── Observable: query latency, error rate, cache hit ratio
│
├── zkConfigProvider        → ZK artifact retrieval (prover/verifier keys)
│   └── Observable: fetch time, artifact size, cache hit/miss
│
├── proofProvider           → Zero-knowledge proof generation
│   └── Observable: proof time, memory usage, circuit complexity
│
├── walletProvider          → Transaction balancing and signing
│   └── Observable: balance check time, coin selection strategy, fee estimation
│
├── midnightProvider        → Transaction submission to the network
│   └── Observable: submission latency, confirmation time, rejection rate
│
└── loggerProvider          → Optional diagnostics logging
    └── Observable: THIS IS WHERE ZKSPLUNK HOOKS IN
```

**Key insight**: The `loggerProvider` slot in Midnight.js is *designed* for exactly what ZKSplunk does. A future version of ZKSplunk could implement the `loggerProvider` interface directly, making it a first-class citizen of the Midnight.js SDK rather than an external wrapper.

---

## MCP Bridge Scenarios

Concrete scenarios where the Splunk MCP ↔ Midnight MCP bridge creates value neither platform can deliver alone:

### Scenario 1: "Why Did My Proof Fail?"

```
1. Splunk detects: proof.generation.success = false (from ZKSplunk telemetry)
2. Splunk MCP → AI Agent: "Proof failure detected for contract 0xABC..."
3. AI Agent → Midnight MCP (midnight-search-compact): Search for the circuit definition
4. AI Agent → Midnight MCP (midnight-explain-circuit): Explain what the circuit does
5. AI Agent → Midnight MCP (midnight-analyze-contract): Check for security issues
6. AI Agent → Splunk MCP: Correlate with historical latency data
7. AI Agent → Operator: "The proof failed because the counter circuit's
   increment operation hit an overflow at value 2^64. The contract at
   0xABC doesn't have overflow protection. See line 23 of counter.compact."
```

### Scenario 2: "Performance Degraded After Upgrade"

```
1. Splunk detects: proof.server.latency_ms jumped from avg 120ms to 380ms
2. Splunk MCP → AI Agent: "Latency anomaly detected, 3x normal"
3. AI Agent → Midnight MCP (midnight-get-latest-updates): Check recent changes
4. AI Agent → Midnight MCP (midnight-compare-syntax): Diff the compiler between versions
5. AI Agent → Midnight MCP (midnight-check-breaking-changes): Any breaking changes?
6. AI Agent → Splunk MCP: Query historical latency by compiler version
7. AI Agent → Operator: "The latency spike correlates with updating the Compact
   compiler from v0.25.0 to v0.26.0. Breaking change: proof generation now
   uses a different circuit encoding that increased prover memory by 40%.
   Recommendation: either roll back to v0.25.0 or increase proof server
   memory allocation from 4GB to 6GB."
```

### Scenario 3: "Is My Infrastructure Current?"

```
1. Scheduled audit (weekly): AI Agent checks all components
2. AI Agent → Midnight MCP (midnight-upgrade-check): Check Compact compiler
3. AI Agent → Midnight MCP (midnight-get-version-info): Check SDK, proof server
4. AI Agent → Splunk MCP: Compare running versions vs latest available
5. AI Agent → Splunk Dashboard: Version drift report
   ┌──────────────────────────────────────────────┐
   │  Version Drift Report — June 2026            │
   │                                              │
   │  Compact Compiler: v0.25.0 → v0.26.0 ⚠️     │
   │    Breaking changes: 2 (see migration guide) │
   │  Midnight.js SDK: v2.1.0 ✅ (current)        │
   │  Proof Server: v3.0.6 ✅ (current)           │
   │  Wallet API: v5.0.0 ✅ (current)             │
   │  DApp Connector: v3.0.0 ✅ (current)         │
   │                                              │
   │  Recommendation: Defer compiler upgrade      │
   │  until v0.26.1 patches the known issues.     │
   └──────────────────────────────────────────────┘
```

### Scenario 4: "New Contract Pre-Deployment Scan"

```
1. Developer submits a new Compact contract for deployment
2. CI pipeline → Midnight MCP (midnight-compile-contract): Compile it
3. CI pipeline → Midnight MCP (midnight-extract-contract-structure): Analyze structure
4. CI pipeline → Midnight MCP (midnight-review-contract): Security review
5. Results → ZKSplunk → Splunk: Pre-deployment audit event
   {
     "type": "midnight.contract.pre_deploy_scan",
     "contract_name": "kyc-verifier",
     "circuits": 3,
     "witnesses": 2,
     "ledger_fields": 5,
     "private_fields": 3,
     "security_findings": 1,
     "compile_time_ms": 2340,
     "estimated_proof_time_s": 22,
     "recommendation": "deploy_with_caution"
   }
```

### Scenario 5: "Cross-DApp Anomaly Detection"

```
1. Splunk detects: 5 of 23 DApps show elevated proof latency simultaneously
2. Splunk MCP → AI Agent: "Multi-DApp anomaly — likely infrastructure issue"
3. AI Agent → Midnight MCP (midnight-health-check): Is the MCP server healthy?
4. AI Agent → Midnight MCP (midnight-get-latest-updates): Any recent platform changes?
5. AI Agent → Splunk MCP: Correlate affected DApps — do they share a proof server?
6. AI Agent → SOAR Playbook: "Shared proof server at proof-server-east is
   degraded. Affecting: DiscoveryManagement, KYCz, SentinelAI, proofOrBluff,
   SelectConnect. Recommended action: restart proof server container and
   investigate memory usage."
```

---

## Feature Roadmap

### Phase 3: Post-Hackathon (July–September 2026)

| Feature | Description | Midnight MCP Tools Used |
|---------|-------------|------------------------|
| **SOAR Playbooks** | Automated incident response for proof server failures | `midnight-health-check`, `midnight-get-file` |
| **Splunkbase Publication** | Package ZKSplunk as installable Splunk app | — |
| **Contract Compilation Metrics** | Track compile times, failures, and warnings | `midnight-compile-contract` |
| **Version Drift Dashboard** | Weekly audit of all Midnight component versions | `midnight-upgrade-check`, `midnight-get-version-info` |
| **Pre-Deployment Scanning** | Analyze contracts before deployment | `midnight-extract-contract-structure`, `midnight-analyze-contract` |

### Phase 4: Enterprise Tier (Q4 2026)

| Feature | Description | Midnight MCP Tools Used |
|---------|-------------|------------------------|
| **Multi-DApp Monitoring** | Single Splunk instance monitoring all 23+ DIDzMonolith products | All search tools for cross-DApp correlation |
| **Private State Observability** | Monitor encrypted state operations without revealing content | `midnight-search-typescript` (SDK instrumentation patterns) |
| **ZSwap Pool Analytics** | Coin selection efficiency, pool size trends | Custom instrumentation via walletProvider |
| **GraphQL Query Performance** | Indexer query latency and error rates | Custom instrumentation via publicDataProvider |
| **Transaction Lifecycle Tracking** | Full TX lifecycle: create → prove → sign → submit → confirm | All provider instrumentation |
| **SentinelAI Integration** | Feed ZKSplunk anomaly data into SentinelAI's threat detection | — |

### Phase 5: Cross-Chain Observability (2027)

| Feature | Description | Midnight MCP Tools Used |
|---------|-------------|------------------------|
| **Cardano Bridge Monitoring** | Track cross-chain asset transfers and bridge health | Requires bridge API access |
| **Multi-Chain Proof Correlation** | Compare ZK proof performance across different ZK chains | — |
| **Universal ZK Observability Standard** | Define an open standard for ZK infrastructure telemetry | `midnight-search-docs` (as reference implementation) |
| **Splunkbase Marketplace** | Paid enterprise tier with SLA monitoring and compliance reporting | — |

---

## AI Agent Evolution Path

### v1 (Hackathon): Reactive Diagnostics
- Responds to Splunk alerts with natural language explanations
- Uses Midnight MCP to fetch contract code and docs
- Single-platform (Splunk only)

### v2 (Post-Hackathon): Proactive Analysis
- Periodically audits infrastructure for version drift and security issues
- Pre-deployment scanning integrated into CI/CD
- Dual-MCP bridge (Splunk ↔ Midnight) fully operational

### v3 (Enterprise): Autonomous Operations
- Self-healing: Detects failures, diagnoses root cause, executes SOAR playbooks
- Multi-DApp awareness: Correlates issues across the entire portfolio
- Learning: Tracks which fixes work and recommends them faster next time

### v4 (Vision): Self-Improving Contracts
- Uses `midnight-generate-contract` to create optimized replacement circuits
- Uses `midnight-review-contract` to validate generated code before deployment
- Full closed-loop: detect → diagnose → generate fix → review → deploy → verify

---

## Midnight API Surface — Complete Observability Map

Every official Midnight API and what's observable:

| API | Package | Version | Observable Metrics | ZKSplunk Status |
|-----|---------|---------|-------------------|-----------------|
| **Compact Runtime** | `@midnight-ntwrk/compact-runtime` | 0.9.0 | Runtime execution time, memory usage | Future |
| **Midnight.js** | `@midnight-ntwrk/midnight-js` | 2.1.0 | Provider call latency, error rates | Future (loggerProvider) |
| **DApp Connector** | `@midnight-ntwrk/dapp-connector-api` | 3.0.0 | Session creation, auth handshake time | Future |
| **Midnight Indexer** | GraphQL API | — | Query latency, block sync lag | ✅ Current (network vitals) |
| **Ledger** | `@midnight-ntwrk/ledger` | 4.0.0 | TX assembly time, ledger ops | Future |
| **Onchain Runtime** | `@midnight-ntwrk/onchain-runtime` | 0.3.0 | On-chain execution metrics | Future |
| **ZSwap** | `@midnight-ntwrk/zswap` | — | Pool operations, shielded TX | Future |
| **Testkit.js** | `@midnight-ntwrk/testkit-js` | — | Test execution, mock provider perf | Development only |
| **Wallet SDK** | `@midnight-ntwrk/wallet` | 5.0.0 | Key derivation, coin selection, balancing | ✅ Partial (wallet vitals) |
| **Wallet API** | `@midnight-ntwrk/wallet-api` | 5.0.0 | High-level wallet ops interface | ✅ Partial (wallet vitals) |
| **Proof Server** | Docker container (`:6300`) | 3.0.6 | Health, latency, proof generation | ✅ Current (proof server vitals) |
| **Compact Compiler** | `compactc` | 0.26.0 | Compile time, warnings, errors | Future (via MCP) |

---

## The Big Picture

```
                    ZKSplunk: The Full Vision

     ┌──────────────────────────────────────────────────┐
     │                                                  │
     │            23 Midnight DApps                     │
     │    (DIDzMonolith Ecosystem)                      │
     │                                                  │
     │  Each DApp runs MidnightVitals + ZKSplunk        │
     │  connector. Telemetry flows continuously.        │
     │                                                  │
     └────────────────────┬─────────────────────────────┘
                          │
                          │  HTTPS / HEC
                          │  (structured JSON events)
                          │
                          ▼
     ┌──────────────────────────────────────────────────┐
     │              Splunk Cloud                        │
     │                                                  │
     │  Index: zksplunk                                 │
     │  Sourcetype: midnight:vitals                     │
     │                                                  │
     │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
     │  │Dashboard │ │ Alerts   │ │ AI Agent         │ │
     │  │ Suite    │ │ & SOAR   │ │                  │ │
     │  │          │ │          │ │ Splunk MCP ◄───► │ │
     │  │ Per-DApp │ │ Auto-    │ │ Midnight MCP     │ │
     │  │ Fleet    │ │ restart  │ │                  │ │
     │  │ Proof    │ │ Escalate │ │ Root cause in    │ │
     │  │ Perf     │ │ Page     │ │ natural language │ │
     │  └──────────┘ └──────────┘ └──────────────────┘ │
     │                                                  │
     │  ┌──────────────────────────────────────────┐    │
     │  │  Enterprise Features (Phase 4+)          │    │
     │  │                                          │    │
     │  │  • Multi-DApp correlation                │    │
     │  │  • Version drift management              │    │
     │  │  • Pre-deploy contract scanning          │    │
     │  │  • Private state monitoring              │    │
     │  │  • Cross-chain bridge observability       │    │
     │  │  • Self-healing autonomous ops           │    │
     │  └──────────────────────────────────────────┘    │
     └──────────────────────────────────────────────────┘
```

**The thesis**: Every privacy-preserving blockchain will eventually need observability tooling that respects its privacy guarantees. ZKSplunk is the first to solve this problem, and it's built on top of the most comprehensive ZK-DApp ecosystem in existence (DIDzMonolith). The Midnight MCP server gives us 30 tools to make that observability *intelligent*, not just reactive.

We're not building a hackathon project. We're building the observability standard for the privacy blockchain era.

---

*Last updated: April 6, 2026*
*Midnight MCP version: v0.2.18 (Idris)*
*Midnight.js SDK: v2.1.0 (4.0.2 API reference)*
*Proof Server: v3.0.6*
*Compact Compiler: v0.26.0*
