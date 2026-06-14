# ZKSplunk — Documentation Index

Suggested reading order. Files are numbered so this directory reads top-to-bottom
instead of alphabetically. **🔧 SETUP** marks the docs with hands-on setup steps.

> New here? Read **01 → 02** for orientation, then **03 → 06** for the concepts and
> architecture, then the **🔧 SETUP** docs (**08, 09**) when you're ready to run it.

---

### Start here
| # | Doc | What it is |
|---|-----|------------|
| 01 | [Synopsis](01_SYNOPSIS.md) | One-page onboarding — what ZKSplunk is, in five minutes |
| 02 | [Dear Judges](02_DEAR_JUDGES.md) | The full pitch: problem, solution, and why it's unique |

### Concepts — what's observable & the security design
| # | Doc | What it is |
|---|-----|------------|
| 03 | [Public Ledger Observability](03_PUBLIC_LEDGER_OBSERVABILITY.md) | What you can (and can't) see on a privacy chain; the public-signal → detection map |
| 04 | [zkZap Security Protocol](04_ZKZAP_SECURITY_PROTOCOL.md) | The detect → decide → act security layer + anonymous on-chain attestation design |
| 05 | [DevRel Health & Attack Detection](05_DEVREL_SPLUNK_HEALTH_AND_ATTACK_DETECTION.md) | Health pulse, attack-signal taxonomy, SPL queries *(detection/agent parts are future)* |

### Architecture & running it
| # | Doc | What it is |
|---|-----|------------|
| 06 | [demoLand vs zkMonitor](06_DEMOLAND_VS_ZKMONITOR.md) | The two run modes (offline simulated vs live) and the shared-package architecture |
| 07 | [Build-Out Architecture](07_BUILD_OUT_ARCHITECTURE_2026-04-21.md) | The three-layer architecture deep dive (analytics → telemetry → on-chain) |

### 🔧 Setup
| # | Doc | What it is |
|---|-----|------------|
| 08 | 🔧 [Splunk API Integration](08_SETUP_SPLUNK_API_INTEGRATION.md) | Splunk HEC/REST endpoints + bring-up reference |
| 09 | 🔧 [Blockchain Pipeline Setup](09_SETUP_BLOCKCHAIN_PIPELINE.md) | **Step-by-step** on-chain deploy → relayer → on-chain status → verify in Splunk |

### Ecosystem & roadmap
| # | Doc | What it is |
|---|-----|------------|
| 10 | [Candidate Integrations](10_CANDIDATE_INTEGRATIONS.md) | Which other products can adopt ZKSplunk, and how to onboard one |
| 11 | [Future Directions](11_FUTURE_DIRECTIONS.md) | Post-hackathon roadmap + the Midnight MCP capability map |

### Hackathon logistics
| # | Doc | What it is |
|---|-----|------------|
| 12 | [Cheatsheet](12_CHEATSHEET.md) | Single-source hackathon cheatsheet (dates, prizes, links) |
| 13 | [Rules & Deadlines](13_HACKATHON_RULES_AND_DEADLINES.md) | Full rules and submission requirements |
| 14 | [Strategy](14_HACKATHON_STRATEGY.md) | The living strategy / battle plan |
| 15 | [Calendar](15_CALENDAR.md) | Confirmed dates and reminder schedule |

### Research & working notes
| # | Doc | What it is |
|---|-----|------------|
| 16 | [Midnight Base-Layer Research](16_MIDNIGHT_BASE_LAYER_RESEARCH.md) | Stack/base-layer decision notes |
| 17 | [Midnight Local-Dev & Ecosystem](17_MIDNIGHT_LOCAL_DEV_AND_ECOSYSTEM_2026-05-13.md) | Local-dev and ecosystem research (point-in-time) |
| 18 | [Shared AgenticDID Specs](18_SHARED_AgenticDID_SPECS.md) | Shared DID specifications |

### Archive
- [`ai-chat/`](ai-chat/) — verbatim design-conversation transcripts (historical record).

---

*The repo-root [`README.md`](../README.md) is the entry point; [`architecture_diagram.md`](../architecture_diagram.md) holds the hackathon-required diagram.*
