// =============================================================================
// ZKSplunk demoLand — zkZap Attack Scenarios
// =============================================================================
// Scripted sequences of vital readings that reproduce the threat signals from
// docs/ZKZAP_SECURITY_PROTOCOL.md §2. Each scenario maps a real-world attack to
// the observable telemetry it would produce on Midnight, so the zkZap detector
// can trip an incident — all without any live infrastructure or attacker.
//
// Important: these are SIMULATED readings. They are shaped to look exactly like
// what MidnightVitals would emit during the real attack, so the downstream
// transform + commitment + detection path is identical to zkMonitor.
// =============================================================================

import type { VitalId, VitalCheckResult } from '../../vitals/types.ts';

type AttackVitalId = Extract<VitalId, 'proof-server' | 'network' | 'wallet' | 'contracts'>;

export interface AttackScenario {
  /** zkZap threat-taxonomy label. */
  threatLabel: string;
  /** Which vital surfaces the signal. */
  vitalId: AttackVitalId;
  /** One-line description of the real-world attack. */
  description: string;
  /** What's actually observable on Midnight (privacy-honest note). */
  observable: string;
  /** The simulated reading sequence (healthy baseline → degradation). */
  readings: VitalCheckResult[];
}

function reading(
  status: VitalCheckResult['status'],
  message: string,
  detailLine: string,
  responseTimeMs: number | null,
): VitalCheckResult {
  return { status, message, detailLine, responseTimeMs };
}

export const ATTACK_SCENARIOS: AttackScenario[] = [
  {
    threatLabel: 'proof-flood',
    vitalId: 'proof-server',
    description:
      'Resource-exhaustion / DDoS: an attacker floods the proof server with ' +
      'expensive proof requests until latency explodes and it OOMs.',
    observable:
      'Proof-server response time climbs from <200ms to multiple seconds, ' +
      'sustained across checks. Operator-side, fully observable.',
    readings: [
      reading('healthy', 'Proof server healthy (62ms).', 'Response: 62ms', 62),
      reading('warning', 'Proof server slow (820ms) — queue backing up.', 'Slow: 820ms', 820),
      reading('critical', 'Proof server latency 5,200ms — request queue saturated.', 'Saturated', 5200),
      reading('critical', 'Proof server unreachable — likely OOM.', 'Unreachable', null),
    ],
  },
  {
    threatLabel: 'failed-auth-bruteforce',
    vitalId: 'contracts',
    description:
      'Brute force against a user contract: repeated calls to a gated entry ' +
      'point trying to guess a private input.',
    observable:
      'Cannot read the private state — but the burst of FAILED/REJECTED ' +
      'contract calls to one entry point is public + visible locally.',
    readings: [
      reading('healthy', 'Contract calls succeeding (1/1 entry points OK).', '1/1 OK', 48),
      reading('warning', 'Elevated failed calls: 14 rejections in 20s on entry point 0x9f…', '14 failed/20s', 51),
      reading('critical', 'Failed-call flood: 220 rejections in 20s on entry point 0x9f…', '220 failed/20s', 55),
      reading('critical', 'Sustained brute-force pattern against gated entry point.', 'ongoing', 57),
    ],
  },
  {
    threatLabel: 'wallet-drain',
    vitalId: 'wallet',
    description:
      'Wallet draining: rapid succession of unshielded spends emptying an ' +
      "operator's wallet.",
    observable:
      'Unshielded spends expose (address, amount) in public Effects — a rapid ' +
      'drawdown from one wallet is directly observable.',
    readings: [
      reading('healthy', 'Wallet connected, balance stable.', 'Connected', null),
      reading('warning', 'Unusual outflow: 6 unshielded spends in 30s.', '6 spends/30s', null),
      reading('critical', 'Rapid drawdown: balance fell 78% in 90s.', '-78% / 90s', null),
    ],
  },
  {
    threatLabel: 'mint-anomaly',
    vitalId: 'contracts',
    description:
      'Unexpected minting: a contract mints tokens at an abnormal rate, ' +
      'possibly a compromised mint authority.',
    observable:
      'shielded_mints / unshielded_mints amounts are in public Effects — a ' +
      'mint-rate spike is observable even though arguments are private.',
    readings: [
      reading('healthy', 'Mint rate nominal (0–2 mints/min).', 'nominal', 60),
      reading('warning', 'Mint rate elevated: 40 mints/min.', '40/min', 62),
      reading('critical', 'Mint storm: 900 mints/min — far above baseline.', '900/min', 65),
    ],
  },
  {
    threatLabel: 'indexer-outage',
    vitalId: 'network',
    description:
      'Network/indexer outage: the indexer stops responding, blinding every ' +
      'DApp that relies on it.',
    observable:
      'Indexer health-check failures + sync lag are directly observable; a ' +
      'simultaneous outage across DApps is a systemic (Macro) signal.',
    readings: [
      reading('healthy', 'Indexer responsive (38ms).', 'Response: 38ms', 38),
      reading('critical', 'Indexer timeout — no response in 10s.', 'Timeout', null),
      reading('critical', 'Indexer still down — sync lag growing.', 'Down', null),
    ],
  },
];
