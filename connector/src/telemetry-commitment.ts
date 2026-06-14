// =============================================================================
// ZKSplunk — Telemetry Commitment Helpers (connector-local copy)
// =============================================================================
// Canonical, connector-local commitment helpers so the package is
// self-contained and doesn't reach into sibling packages.
// =============================================================================


import { createHash } from 'node:crypto';


/**
 * A canonical, deterministic telemetry snapshot that the off-chain side of
 * ZKSplunk hashes and anchors on-chain via the zksplunk contract.
 *
 * The goal: given the same snapshot, always produce the same commitment, so
 * an auditor can independently re-hash the off-chain data and verify it
 * matches what was attested on-chain.
 */
export interface TelemetrySnapshot {
  /** Unix milliseconds when this snapshot was collected. */
  readonly timestamp: number;

  /** Which Midnight network this snapshot concerns. */
  readonly network: 'mainnet' | 'preprod' | 'preview';

  /** Block height at the moment of collection, if known (null when not applicable). */
  readonly blockHeight: number | null;

  /** Which component of the stack this snapshot describes. */
  readonly component: 'proof-server' | 'network' | 'wallet' | 'contracts' | 'composite';

  /**
   * Arbitrary telemetry payload. Serialization is handled canonically by this
   * module so clients don't need to worry about key ordering.
   */
  readonly payload: Record<string, unknown>;
}


/**
 * Serialize a value to a deterministic JSON string: keys are sorted
 * alphabetically at every nesting level.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalStringify(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(obj[k])).join(',') +
    '}'
  );
}


/**
 * Compute the on-chain commitment for a telemetry snapshot.
 *
 * We use SHA-256 for now — Midnight's on-chain `persistentCommit` uses
 * Poseidon over Bytes<32>, and this value is what off-chain consumers store
 * alongside the chain attestation so they can compare equality.
 *
 * Returns a lowercase 64-char hex string (32 bytes).
 */
export function commitSnapshot(snapshot: TelemetrySnapshot): string {
  const canonical = canonicalStringify(snapshot);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}


/**
 * Build a canonically-shaped snapshot from a telemetry payload.
 */
export function buildSnapshot(
  component: TelemetrySnapshot['component'],
  network: TelemetrySnapshot['network'],
  blockHeight: number | null,
  payload: Record<string, unknown>,
): TelemetrySnapshot {
  return {
    timestamp: Date.now(),
    network,
    blockHeight,
    component,
    payload,
  };
}
