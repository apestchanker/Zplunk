// =============================================================================
// ZKSplunk — On-Chain Attestation Client
// =============================================================================
// Defines the AttestationClient interface and its implementations.
//
//   1. AttestationClient interface — any backend must satisfy this.
//   2. MockAttestationClient — deterministic stub for dev / tests /
//      environments where midnight.js or a wallet is not configured.
//   3. LoggingAttestationClient — wraps any client for debug logging.
//
// The real MidnightJsAttestationClient lives in
// zkMonitor/src/midnight-attestation-client.ts, which is the only place
// that imports @midnight-ntwrk/* — keeping this file dependency-free so
// the connector can be used in browser contexts without bundler friction.
// =============================================================================


// ---------------------------------------------------------------------------
// Incident domain types (dependency-free string unions)
// ---------------------------------------------------------------------------

/**
 * Human-readable incident class names that map to the contract's IncidentClass
 * enum. Using string literals keeps this file free of @midnight-ntwrk imports.
 */
export type IncidentClassName =
  | 'proof-server-outage'
  | 'auth-bruteforce-burst'
  | 'mint-anomaly'
  | 'block-stall'
  | 'wallet-drain';

/**
 * Human-readable severity names that map to the contract's Severity enum.
 */
export type SeverityName =
  | 'info'
  | 'warning'
  | 'degraded'
  | 'critical'
  | 'outage';

/**
 * Structured input for a critical-incident attestation. Mirrors the
 * attestCriticalIncident circuit arguments but uses friendlier types.
 *
 * Fields:
 *   incidentClass  — which category of incident (maps to IncidentClass enum)
 *   severity       — severity level at time of incident (maps to Severity enum)
 *   epoch          — unix time in whole hours (bigint), derived by the client
 *                    from Date.now() / 3_600_000n if not supplied
 *   payloadCommitmentHex — 64-char hex (32 bytes); the SHA-256 commitment of
 *                    the telemetry snapshot that triggered the alert
 *   scopeTagHex    — optional 64-char hex (32 bytes); zero-padded if absent,
 *                    may carry a free-form scope identifier in the top bytes
 */
export interface CriticalIncident {
  incidentClass: IncidentClassName;
  severity: SeverityName;
  epoch?: bigint;
  payloadCommitmentHex: string;
  scopeTagHex?: string;
}


// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * Result of submitting an attestation transaction to the Midnight network.
 */
export interface AttestationResult {
  /** Commitment hash that was attested (64-char hex, 32 bytes). */
  commitmentHex: string;

  /** Transaction hash of the attestation tx (64-char hex). */
  txHash: string;

  /** On-chain sequence number (from the contract counter), if known. */
  sequence: number | null;

  /** Block height where the attestation landed, if known. */
  blockHeight: number | null;

  /** Milliseconds from submit to confirmation. */
  latencyMs: number;

  /** Whether the attestation was actually submitted or short-circuited. */
  wasSubmitted: boolean;

  /** When wasSubmitted=false, why the attestation was skipped. */
  skipReason?: 'disabled' | 'sampled_out' | 'unchanged' | 'rate_limited';
}


// ---------------------------------------------------------------------------
// AttestationClient interface
// ---------------------------------------------------------------------------

/**
 * The abstract contract for any attestation backend.
 *
 * Implementations must be idempotent-safe: the SplunkForwarder may call
 * attestCriticalIncident for the same commitment more than once on retry,
 * so backends that dedupe at the contract level should not error on
 * duplicates — they should either succeed with the existing sequence
 * number or return wasSubmitted=false with skipReason='unchanged'.
 */
export interface AttestationClient {
  /**
   * Submit an anonymous critical-incident attestation to the on-chain
   * zksplunk contract. Resolves when the transaction has been confirmed;
   * rejects only on unrecoverable errors.
   *
   * This is the PRIMARY method. Use it for all new code.
   */
  attestCriticalIncident(input: CriticalIncident): Promise<AttestationResult>;

  /**
   * DEPRECATED — pointed at the removed attestObservation circuit.
   * Kept for back-compat only; implementations return wasSubmitted=false
   * with skipReason='disabled'. Do not call this from new code.
   *
   * @deprecated Use attestCriticalIncident instead.
   */
  attest(commitmentHex: string): Promise<AttestationResult>;

  /**
   * Liveness check — does this backend appear ready to submit attestations?
   * Used by the SplunkForwarder at startup to decide whether to enable the
   * attestation path.
   */
  isReady(): Promise<boolean>;

  /** Human-readable name for logging (e.g. "mock", "midnight-js@preview"). */
  readonly backendName: string;
}


// ---------------------------------------------------------------------------
// Mock Attestation Client
// ---------------------------------------------------------------------------

/**
 * Options controlling the mock client's simulated behavior.
 */
export interface MockAttestationClientOptions {
  /** Simulated network latency range (ms). [min, max] inclusive. */
  latencyRangeMs?: [number, number];

  /** Probability of a simulated failure (0-1). 0 = never fail. */
  failureRate?: number;

  /** If true, the mock counts attestations in memory and returns a sequence. */
  trackSequence?: boolean;

  /** Initial sequence number (useful for tests that want a specific start). */
  initialSequence?: number;

  /** Optional deterministic tx hash generator for testing. */
  txHashFor?: (commitmentHex: string, sequence: number) => string;
}

/**
 * Mock AttestationClient for local development, CI, and unit tests.
 *
 * Simulates:
 *   - Realistic latency (default 200-800 ms, like preprod block time)
 *   - Occasional failures (default 0% — deterministic by default)
 *   - An on-chain sequence counter (so consumers see realistic data)
 */
export class MockAttestationClient implements AttestationClient {
  readonly backendName = 'mock';

  private sequence: number;
  private readonly options: Required<MockAttestationClientOptions>;

  constructor(options: MockAttestationClientOptions = {}) {
    this.options = {
      latencyRangeMs: options.latencyRangeMs ?? [200, 800],
      failureRate: options.failureRate ?? 0,
      trackSequence: options.trackSequence ?? true,
      initialSequence: options.initialSequence ?? 0,
      txHashFor: options.txHashFor ?? defaultMockTxHash,
    };
    this.sequence = this.options.initialSequence;
  }

  async attestCriticalIncident(input: CriticalIncident): Promise<AttestationResult> {
    const startTime = Date.now();

    // Simulate network latency
    const [minMs, maxMs] = this.options.latencyRangeMs;
    const latency = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
    await new Promise((resolve) => setTimeout(resolve, latency));

    // Simulate failure
    if (this.options.failureRate > 0 && Math.random() < this.options.failureRate) {
      throw new Error(
        `[MockAttestationClient] Simulated attestation failure for commitment ${input.payloadCommitmentHex.slice(0, 12)}…`,
      );
    }

    const assignedSequence = this.options.trackSequence ? this.sequence++ : 0;
    const txHash = this.options.txHashFor(input.payloadCommitmentHex, assignedSequence);

    return {
      commitmentHex: input.payloadCommitmentHex,
      txHash,
      sequence: assignedSequence,
      blockHeight: null,
      latencyMs: Date.now() - startTime,
      wasSubmitted: true,
    };
  }

  /**
   * @deprecated The old attestObservation circuit has been removed.
   * Routes to attestCriticalIncident with dummy class/severity for back-compat
   * in any existing test harnesses that still call attest(). All production
   * code should call attestCriticalIncident directly.
   */
  async attest(commitmentHex: string): Promise<AttestationResult> {
    return this.attestCriticalIncident({
      incidentClass: 'block-stall',
      severity: 'warning',
      payloadCommitmentHex: commitmentHex,
    });
  }

  async isReady(): Promise<boolean> {
    return true;
  }

  /** For tests: read the current counter without mutating state. */
  getSequence(): number {
    return this.sequence;
  }

  /** For tests: reset the counter. */
  resetSequence(to = 0): void {
    this.sequence = to;
  }
}

/**
 * Deterministic mock tx hash: first 8 hex chars of commitment + zero-padded seq.
 */
function defaultMockTxHash(commitmentHex: string, sequence: number): string {
  const prefix = commitmentHex.slice(0, 8);
  const seqHex = sequence.toString(16).padStart(8, '0');
  return (prefix + seqHex).padEnd(64, '0');
}


// ---------------------------------------------------------------------------
// Logging Decorator
// ---------------------------------------------------------------------------

/**
 * Wraps any AttestationClient to emit console.log messages before and after
 * each attestation. Useful during demos and local debugging.
 */
export class LoggingAttestationClient implements AttestationClient {
  readonly backendName: string;

  constructor(
    private readonly inner: AttestationClient,
    private readonly logPrefix: string = '[ZKSplunk Attestation]',
  ) {
    this.backendName = `logging(${inner.backendName})`;
  }

  async attestCriticalIncident(input: CriticalIncident): Promise<AttestationResult> {
    // eslint-disable-next-line no-console
    console.log(
      `${this.logPrefix} Submitting critical incident ` +
        `class=${input.incidentClass} severity=${input.severity} ` +
        `commitment=${input.payloadCommitmentHex.slice(0, 16)}… via ${this.inner.backendName}`,
    );
    try {
      const result = await this.inner.attestCriticalIncident(input);
      // eslint-disable-next-line no-console
      console.log(
        `${this.logPrefix} Attested seq=${result.sequence} tx=${result.txHash.slice(0, 16)}… in ${result.latencyMs}ms`,
      );
      return result;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        `${this.logPrefix} Attestation failed for ${input.payloadCommitmentHex.slice(0, 16)}…:`,
        error,
      );
      throw error;
    }
  }

  /**
   * @deprecated Use attestCriticalIncident instead.
   */
  async attest(commitmentHex: string): Promise<AttestationResult> {
    // eslint-disable-next-line no-console
    console.warn(
      `${this.logPrefix} attest() is deprecated — the old attestObservation circuit has been removed. ` +
        `Returning wasSubmitted=false (disabled). Call attestCriticalIncident() instead.`,
    );
    return {
      commitmentHex,
      txHash: '0'.repeat(64),
      sequence: null,
      blockHeight: null,
      latencyMs: 0,
      wasSubmitted: false,
      skipReason: 'disabled',
    };
  }

  async isReady(): Promise<boolean> {
    return this.inner.isReady();
  }
}
