# Candidate Integrations

> **Status**: Strategic catalog of products in the DIDzMonolith family that benefit from (or require) ZKSplunk. May 23, 2026.

ZKSplunk is the first observability bridge for ZK-proof blockchain infrastructure. Any product that puts a Midnight contract in a production loop is a candidate integration. This doc ranks the candidates by **fit strength** and **necessity**.

## Ranking

| Product | Midnight fit | ZKSplunk fit | Necessity | Notes |
|---|---|---|---|---|
| **SnapBooksAi** | High | **High** | **Necessary** | Cross-contractor BenchmarkPool is operationally blind without ZKSplunk |
| **DiscoveryManagement** | High | High | Necessary | Already a Midnight DApp; ZK contracts in production |
| **proofOrBluff** | High | High | Necessary | Casino-mode rake settlement requires ZK-aware monitoring |
| **BlindOracle** | High | High | Necessary | Round settlement contracts need lifecycle observability |
| **selectConnect** | High | High | High | Bond staking and progressive reveal need ZKSplunk for fraud detection |
| **DIDz / AgenticDID** | High | Medium | High | DID resolution telemetry without leaking holders |
| **KYCz** | High | High | High | KYC anchor contracts have audit-grade observability needs |
| **EventRevolution** | High | Medium | Medium | Aggregate-analytics tier benefits, individual-tier requires it |
| **SmartCart** | Medium | Medium | Conditional | Useful only after Midnight integration phase 4+ |
| **CareToCoin** | High | High | High | Donor compliance attestations need ZKSplunk |
| **SilentLedger** | High | High | High | Obfuscated orderbook lifecycles are inherently shielded |
| **SharedScience.me** | High | High | High | Disclosure protocol stages map to ZKSplunk events naturally |

## SnapBooksAi (deep dive)

**Status**: planned, not yet integrated. See `@/home/js/SnapBooksAi_com_app/docs/MIDNIGHT_INTEGRATION.md` and `@/home/js/SnapBooksAi_com_app/docs/SPLUNK_AND_ZKSPLUNK.md` for the full architecture.

Why this is a strong candidate:

- Four privacy-gated Midnight contracts (`BenchmarkPool`, `RevenueAttestation`, `UnderwritingProof`, `InsuranceAttestation`)
- The `BenchmarkPool` aggregator is a textbook ZKSplunk use case: operators need to know whether the pool is healthy without seeing contributor inputs
- Enterprise customers (auditors, lenders, insurers) will demand SLA-grade observability before they pay for attestations, and SLAs require ZKSplunk
- Cross-contract correlation (a deploy of `BenchmarkPool` causing `UnderwritingProof` failures) is exactly what ZKSplunk's AI agent layer was built to surface

This is the single strongest near-term integration target outside the products that already use Midnight in production.

## SmartCart (deep dive)

**Status**: planned, conditional. See `@/home/js/DIDzMonolith/SmartCart/docs/MIDNIGHT_INTEGRATION.md` and `@/home/js/DIDzMonolith/SmartCart/docs/SPLUNK_INTEGRATION.md`.

Why this is conditional:

- SmartCart's MVP is a route optimizer that needs neither Midnight nor Splunk
- Phase 4+ adds four privacy-gated contracts (store attestations, contributor rewards, eligibility proofs, bonded corrections)
- Once those contracts ship, ZKSplunk becomes necessary for the same reasons as SnapBooksAi
- Splunk's retail vertical is independently lucrative; SmartCart's "ship a Splunk app" plan is a separate revenue stream that does not require Midnight or ZKSplunk

Net: ZKSplunk is a **phase 4+ dependency**, not a phase 1 dependency, for SmartCart.

## DApps already in production

The DIDzMonolith family includes several Midnight DApps that have ZK contracts deployed today and would benefit from ZKSplunk immediately:

- **DiscoveryManagement** (formerly AutoDiscovery): DID-based legal-discovery platform with Midnight contracts deployed.
- **proofOrBluff**: Casino-mode bluffing card game; uses Midnight for selective reveal during settlement.
- **BlindOracle**: Privacy-preserving prediction game; round settlement uses ZK proofs.
- **selectConnect**: 989-line Compact contract with 22 ZK circuits; bond staking lifecycle.
- **CareToCoin**: Migrating from Cardano/Aiken to Midnight; donor-compliance attestations.
- **SilentLedger**: Obfuscated orderbook with multiple Compact contracts.

Each of these is a near-term ZKSplunk demo target. The hackathon submission can pick any one (or several) as live integration evidence.

## How to onboard a new candidate

Standard onboarding flow for a Midnight DApp adopting ZKSplunk:

1. **Add MidnightVitals** to the DApp (already prototyped in `proofOrBluff` and several others). MidnightVitals exposes `/api/vitals/*` endpoints with proof-server, RPC, indexer, wallet, and contract health.
2. **Configure SplunkForwarder** with HEC token, index name, and sourcetype.
3. **Subclass the vitals adapter** to translate DApp-specific contract events into Splunk events. The pattern is documented in the ZKSplunk source.
4. **Install the ZKSplunk app** in the customer's Splunk instance for pre-built dashboards and saved searches.
5. **Optionally add the AI agent** for autonomous incident response.

Total integration effort for a well-scoped DApp: 1 to 3 engineer-days for steps 1 to 3, another 1 to 2 days for steps 4 to 5.

## Cross-references

- ZKSplunk hackathon plan: `@/home/js/DIDzMonolith/ZKSplunk_Splunking_w_Midnight/docs/HACKATHON_RULES_AND_DEADLINES.md`
- MidnightVitals canonical implementation: `@/home/js/DIDzMonolith/MidnightVitals/`
- SnapBooksAi Midnight plan: `@/home/js/SnapBooksAi_com_app/docs/MIDNIGHT_INTEGRATION.md`
- SmartCart Midnight plan: `@/home/js/DIDzMonolith/SmartCart/docs/MIDNIGHT_INTEGRATION.md`
- DIDzMonolith Midnight knowledge base: `@/home/js/DIDzMonolith/monolith-docs/midnight/`
