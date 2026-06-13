// =============================================================================
// ZKSplunk — Attestation Integration Tests
// =============================================================================
// Exercises the full attestation wiring inside SplunkForwarder:
//   • commitment derivation is deterministic
//   • MockAttestationClient returns valid-shaped results
//   • decideAttestation() honors attestOnlyOnStatusChange + min interval
//   • submitAttestation() emits confirmed / failed events correctly
// =============================================================================


import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SplunkForwarder,
  MockAttestationClient,
  commitSnapshot,
  buildSnapshot,
  DEFAULT_CONFIG,
  type ZKSplunkConfig,
  type SplunkHecEvent,
} from '../index';
import type { VitalCheckResult } from '../../../vitals/types';


// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<ZKSplunkConfig> = {}): ZKSplunkConfig {
  return {
    ...DEFAULT_CONFIG,
    splunkHecUrl: 'https://mock-splunk.local:8088',
    splunkHecToken: 'mock-token',
    enableConsoleLogging: false,
    // Attestation defaults for these tests
    enableAttestation: true,
    attestationContractAddress: '0xDEADBEEF',
    attestationNetwork: 'preprod',
    attestationSamplingRate: 1,
    attestOnlyOnStatusChange: false,
    attestationMinIntervalMs: 0,
    ...overrides,
  };
}

function healthy(): VitalCheckResult {
  return {
    status: 'healthy',
    message: 'OK',
    detailLine: 'Response: 42ms',
    responseTimeMs: 42,
  };
}

function critical(): VitalCheckResult {
  return {
    status: 'critical',
    message: 'proof server unreachable',
    detailLine: 'timeout after 5000ms',
    responseTimeMs: null,
  };
}

/**
 * Capture HEC events without touching the network. We stub the forwarder's
 * internal HEC client by intercepting `enqueue` via a spy — but since it's
 * private, we use the forwarder's public callback path and replace the
 * underlying fetch. Simpler: stub global fetch and parse the batched body.
 */
function installFetchSpy(): { getBodies: () => string[]; restore: () => void } {
  const bodies: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: unknown) => {
    const body = (init as { body?: string } | undefined)?.body;
    if (typeof body === 'string') bodies.push(body);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ text: 'Success', code: 0 }),
    } as unknown as Response;
  }) as typeof fetch;
  return {
    getBodies: () => bodies,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** Parse newline-delimited JSON from captured fetch bodies. */
function parseHecEvents(bodies: string[]): SplunkHecEvent[] {
  const events: SplunkHecEvent[] = [];
  for (const body of bodies) {
    for (const line of body.split('\n')) {
      if (!line.trim()) continue;
      events.push(JSON.parse(line));
    }
  }
  return events;
}


// ---------------------------------------------------------------------------
// Commitment determinism
// ---------------------------------------------------------------------------

describe('telemetry commitment', () => {
  it('produces the same hash for the same snapshot regardless of key order', () => {
    const a = buildSnapshot('proof-server', 'preprod', 1000, { x: 1, y: 2, z: 3 });
    const b = buildSnapshot('proof-server', 'preprod', 1000, { z: 3, y: 2, x: 1 });
    // Timestamps will differ — override for equality
    const aFixed = { ...a, timestamp: 1234 };
    const bFixed = { ...b, timestamp: 1234 };
    expect(commitSnapshot(aFixed)).toBe(commitSnapshot(bFixed));
  });

  it('returns a 64-char lowercase hex string', () => {
    const snap = buildSnapshot('proof-server', 'preprod', 42, { hello: 'world' });
    const hash = commitSnapshot(snap);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different payloads', () => {
    const a = buildSnapshot('proof-server', 'preprod', 100, { s: 'healthy' });
    const b = buildSnapshot('proof-server', 'preprod', 100, { s: 'critical' });
    const aFixed = { ...a, timestamp: 999 };
    const bFixed = { ...b, timestamp: 999 };
    expect(commitSnapshot(aFixed)).not.toBe(commitSnapshot(bFixed));
  });
});


// ---------------------------------------------------------------------------
// MockAttestationClient
// ---------------------------------------------------------------------------

describe('MockAttestationClient', () => {
  it('increments sequence on each successful attestation', async () => {
    const client = new MockAttestationClient({ latencyRangeMs: [0, 1] });
    const r1 = await client.attest('a'.repeat(64));
    const r2 = await client.attest('b'.repeat(64));
    expect(r1.sequence).toBe(0);
    expect(r2.sequence).toBe(1);
    expect(r1.wasSubmitted).toBe(true);
    expect(r1.txHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws when failureRate=1 (simulated failure)', async () => {
    const client = new MockAttestationClient({
      latencyRangeMs: [0, 1],
      failureRate: 1,
    });
    await expect(client.attest('c'.repeat(64))).rejects.toThrow();
  });

  it('reports ready', async () => {
    const client = new MockAttestationClient();
    await expect(client.isReady()).resolves.toBe(true);
  });
});


// ---------------------------------------------------------------------------
// SplunkForwarder + Attestation integration
// ---------------------------------------------------------------------------

describe('SplunkForwarder + attestation', () => {
  let spy: ReturnType<typeof installFetchSpy>;

  beforeEach(() => {
    spy = installFetchSpy();
  });

  it('emits a vital_check event with pending commitment + a later confirmed event', async () => {
    const client = new MockAttestationClient({ latencyRangeMs: [0, 5] });
    const forwarder = new SplunkForwarder(
      makeConfig({ batchSize: 1 }), // flush immediately
      { attestationClient: client, dappName: 'test-dapp' },
    );
    await forwarder.connect();

    forwarder.handleVitalCheck('proof-server', critical());

    // Give async attestation time to resolve
    await new Promise((r) => setTimeout(r, 50));
    await forwarder.shutdown();

    const events = parseHecEvents(spy.getBodies()).map((e) => e.event);

    const checks = events.filter(
      (e) => e.type === 'midnight.vital.check',
    );
    const confirmed = events.filter(
      (e) => e.type === 'midnight.attestation.confirmed',
    );

    expect(checks.length).toBe(1);
    expect(checks[0].attestation_status).toBe('pending');
    expect(checks[0].attestation_commitment).toMatch(/^[0-9a-f]{64}$/);

    expect(confirmed.length).toBe(1);
    expect(confirmed[0].attestation_commitment).toBe(
      checks[0].attestation_commitment,
    );
    expect(confirmed[0].attestation_tx_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(confirmed[0].attestation_seq).toBe(0);

    const stats = forwarder.getAttestationStats();
    expect(stats.totalSubmitted).toBe(1);
    expect(stats.totalFailed).toBe(0);
  });

  it('submits only critical status changes when attestOnlyOnStatusChange=true', async () => {
    const client = new MockAttestationClient({ latencyRangeMs: [0, 1] });
    const attestSpy = vi.spyOn(client, 'attestCriticalIncident');
    const forwarder = new SplunkForwarder(
      makeConfig({
        batchSize: 1,
        attestOnlyOnStatusChange: true,
        attestationMinIntervalMs: 0,
      }),
      { attestationClient: client },
    );
    await forwarder.connect();

    // First check: healthy is committed in Splunk but not submitted on-chain.
    forwarder.handleVitalCheck('network', healthy());
    // Second check: status changes to critical (should attest).
    forwarder.handleVitalCheck('network', critical());
    // Third check: status stays critical (should skip as unchanged).
    forwarder.handleVitalCheck('network', critical());

    await new Promise((r) => setTimeout(r, 50));
    await forwarder.shutdown();

    expect(attestSpy).toHaveBeenCalledTimes(1);

    const events = parseHecEvents(spy.getBodies()).map((e) => e.event);
    const checks = events.filter((e) => e.type === 'midnight.vital.check');
    expect(checks.map((c) => c.attestation_status)).toEqual([
      'skipped',
      'pending',
      'skipped',
    ]);
    expect(checks[0].attestation_skip_reason).toBe('unchanged');
    expect(checks[2].attestation_skip_reason).toBe('unchanged');
  });

  it('rate-limits attestations via attestationMinIntervalMs', async () => {
    const client = new MockAttestationClient({ latencyRangeMs: [0, 1] });
    const attestSpy = vi.spyOn(client, 'attestCriticalIncident');
    const forwarder = new SplunkForwarder(
      makeConfig({
        batchSize: 1,
        attestOnlyOnStatusChange: false,
        attestationSamplingRate: 1,
        attestationMinIntervalMs: 60_000, // 1 minute cooldown
      }),
      { attestationClient: client },
    );
    await forwarder.connect();

    forwarder.handleVitalCheck('wallet', critical());
    // Second call should be rate-limited, not submitted
    forwarder.handleVitalCheck('wallet', critical());

    await new Promise((r) => setTimeout(r, 30));
    await forwarder.shutdown();

    expect(attestSpy).toHaveBeenCalledTimes(1);

    const events = parseHecEvents(spy.getBodies()).map((e) => e.event);
    const checks = events.filter((e) => e.type === 'midnight.vital.check');
    expect(checks[1].attestation_status).toBe('skipped');
    expect(checks[1].attestation_skip_reason).toBe('rate_limited');
  });

  it('emits attestation.failed when the client throws', async () => {
    const client = new MockAttestationClient({
      latencyRangeMs: [0, 1],
      failureRate: 1,
    });
    const forwarder = new SplunkForwarder(
      makeConfig({ batchSize: 1 }),
      { attestationClient: client },
    );
    await forwarder.connect();

    forwarder.handleVitalCheck('contracts', critical());

    await new Promise((r) => setTimeout(r, 30));
    await forwarder.shutdown();

    const events = parseHecEvents(spy.getBodies()).map((e) => e.event);
    const failed = events.filter(
      (e) => e.type === 'midnight.attestation.failed',
    );
    expect(failed.length).toBe(1);
    expect(failed[0].error_message).toMatch(/Simulated attestation failure/);

    const stats = forwarder.getAttestationStats();
    expect(stats.totalFailed).toBe(1);
  });

  it('always emits commitment in vital event even when attestation is disabled', async () => {
    const forwarder = new SplunkForwarder(
      makeConfig({ batchSize: 1, enableAttestation: false }),
      { /* no attestation client */ },
    );
    await forwarder.connect();

    forwarder.handleVitalCheck('proof-server', healthy());

    await new Promise((r) => setTimeout(r, 10));
    await forwarder.shutdown();

    const events = parseHecEvents(spy.getBodies()).map((e) => e.event);
    const checks = events.filter((e) => e.type === 'midnight.vital.check');
    expect(checks[0].attestation_commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(checks[0].attestation_status).toBe('skipped');
    expect(checks[0].attestation_skip_reason).toBe('disabled');
  });
});
