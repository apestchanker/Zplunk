// =============================================================================
// ZKSplunk — HEC client tests
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SplunkHecClient, type HecDeliveryInfo } from '../hec-client';
import { DEFAULT_CONFIG, type ZKSplunkConfig } from '../config';

function makeConfig(overrides: Partial<ZKSplunkConfig> = {}): ZKSplunkConfig {
  return {
    ...DEFAULT_CONFIG,
    splunkHecUrl: 'https://mock-splunk.local:8090',
    splunkHecToken: 'mock-token',
    splunkHost: 'unit-host',
    splunkSource: 'unit-source',
    splunkSourcetype: 'midnight:vitals',
    splunkIndex: 'zksplunk',
    enableConsoleLogging: false,
    batchFlushIntervalMs: 0, // disable timer; flush explicitly
    retryAttempts: 3,
    retryDelayMs: 1,
    ...overrides,
  };
}

/** A fetch mock whose per-call outcome is scripted. */
function scriptFetch(outcomes: Array<'ok' | 'httpError' | 'hecError' | 'throw'>) {
  const bodies: string[] = [];
  let i = 0;
  const fn = vi.fn(async (_url: unknown, init?: unknown) => {
    const body = (init as { body?: string } | undefined)?.body;
    if (typeof body === 'string') bodies.push(body);
    const outcome = outcomes[Math.min(i, outcomes.length - 1)];
    i++;
    if (outcome === 'throw') throw new Error('network down');
    if (outcome === 'httpError') {
      return { ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({}) } as unknown as Response;
    }
    const code = outcome === 'hecError' ? 6 : 0;
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({ text: code ? 'fail' : 'Success', code }) } as unknown as Response;
  });
  return { fn, bodies, calls: () => i };
}

let originalFetch: typeof globalThis.fetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

describe('enqueue', () => {
  it('applies host/source/sourcetype/index defaults from config', async () => {
    const s = scriptFetch(['ok']);
    globalThis.fetch = s.fn as typeof fetch;
    const client = new SplunkHecClient(makeConfig({ batchSize: 1 }));
    client.enqueue({ event: { type: 'x' } });
    await client.shutdown();
    const sent = JSON.parse(s.bodies[0]);
    expect(sent.host).toBe('unit-host');
    expect(sent.source).toBe('unit-source');
    expect(sent.sourcetype).toBe('midnight:vitals');
    expect(sent.index).toBe('zksplunk');
  });

  it('respects a host already set on the event', async () => {
    const s = scriptFetch(['ok']);
    globalThis.fetch = s.fn as typeof fetch;
    const client = new SplunkHecClient(makeConfig({ batchSize: 1 }));
    client.enqueue({ host: 'override-host', sourcetype: 'midnight:chain', event: { type: 'x' } });
    await client.shutdown();
    const sent = JSON.parse(s.bodies[0]);
    expect(sent.host).toBe('override-host');
    expect(sent.sourcetype).toBe('midnight:chain');
  });

  it('flushes automatically when batchSize is reached', async () => {
    const s = scriptFetch(['ok']);
    globalThis.fetch = s.fn as typeof fetch;
    const client = new SplunkHecClient(makeConfig({ batchSize: 3 }));
    client.enqueue({ event: { type: '1' } });
    client.enqueue({ event: { type: '2' } });
    expect(s.calls()).toBe(0); // not yet
    client.enqueue({ event: { type: '3' } }); // triggers flush
    await new Promise((r) => setTimeout(r, 5));
    expect(s.calls()).toBe(1);
    expect(s.bodies[0].split('\n')).toHaveLength(3); // NDJSON batch
    await client.shutdown();
  });
});

describe('delivery callbacks & retries', () => {
  // batchSize high so enqueue never auto-flushes; we drive flush() explicitly
  // and await it, making sends deterministic.
  it('reports success on the first attempt', async () => {
    const s = scriptFetch(['ok']);
    globalThis.fetch = s.fn as typeof fetch;
    const deliveries: HecDeliveryInfo[] = [];
    const client = new SplunkHecClient(makeConfig({ batchSize: 100 }), { onDelivery: (d) => deliveries.push(d) });
    client.enqueue({ event: { type: 'x' } });
    await client.flush();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].sendStatus).toBe('success');
    expect(deliveries[0].sendAttempt).toBe(1);
    expect(client.getStats().totalEventsSent).toBe(1);
    await client.shutdown();
  });

  it('retries on HTTP error then reports a retry success', async () => {
    const s = scriptFetch(['httpError', 'ok']);
    globalThis.fetch = s.fn as typeof fetch;
    const deliveries: HecDeliveryInfo[] = [];
    const errors: number[] = [];
    const client = new SplunkHecClient(makeConfig({ batchSize: 100 }), {
      onDelivery: (d) => deliveries.push(d),
      onSendError: (_e, _n, attempt) => errors.push(attempt),
    });
    client.enqueue({ event: { type: 'x' } });
    await client.flush();
    expect(errors).toEqual([1]); // one failed attempt
    expect(deliveries.at(-1)?.sendStatus).toBe('retry');
    expect(deliveries.at(-1)?.sendAttempt).toBe(2);
    await client.shutdown();
  });

  it('marks delivery failed after exhausting retries and counts failures', async () => {
    const s = scriptFetch(['throw', 'throw', 'throw']);
    globalThis.fetch = s.fn as typeof fetch;
    const deliveries: HecDeliveryInfo[] = [];
    const client = new SplunkHecClient(makeConfig({ batchSize: 100 }), { onDelivery: (d) => deliveries.push(d) });
    client.enqueue({ event: { type: 'x' } });
    await client.flush();
    const failed = deliveries.find((d) => d.sendStatus === 'failed');
    expect(failed).toBeTruthy();
    expect(failed?.errorMessage).toMatch(/network down/);
    expect(client.getStats().totalEventsFailed).toBe(1);
    await client.shutdown();
  });

  it('treats a non-zero HEC response code as a failure', async () => {
    const s = scriptFetch(['hecError', 'hecError', 'hecError']);
    globalThis.fetch = s.fn as typeof fetch;
    const client = new SplunkHecClient(makeConfig({ batchSize: 100 }));
    client.enqueue({ event: { type: 'x' } });
    await client.flush();
    expect(client.getStats().totalEventsFailed).toBe(1);
    expect(client.getStats().totalEventsSent).toBe(0);
    await client.shutdown();
  });
});

describe('healthCheck & stats', () => {
  it('returns healthy when HEC responds code 0', async () => {
    const s = scriptFetch(['ok']);
    globalThis.fetch = s.fn as typeof fetch;
    const client = new SplunkHecClient(makeConfig());
    const r = await client.healthCheck();
    expect(r.healthy).toBe(true);
    await client.shutdown();
  });

  it('returns unhealthy when HEC is unreachable', async () => {
    const s = scriptFetch(['throw']);
    globalThis.fetch = s.fn as typeof fetch;
    const client = new SplunkHecClient(makeConfig());
    const r = await client.healthCheck();
    expect(r.healthy).toBe(false);
    expect(r.message).toMatch(/unreachable/i);
    await client.shutdown();
  });

  it('computes average latency across batches', async () => {
    const s = scriptFetch(['ok', 'ok']);
    globalThis.fetch = s.fn as typeof fetch;
    const client = new SplunkHecClient(makeConfig({ batchSize: 100 }));
    client.enqueue({ event: { type: '1' } });
    await client.flush();
    client.enqueue({ event: { type: '2' } });
    await client.flush();
    expect(client.getStats().totalBatchesSent).toBe(2);
    expect(client.getStats().averageLatencyMs).toBeGreaterThanOrEqual(0);
    await client.shutdown();
  });
});
