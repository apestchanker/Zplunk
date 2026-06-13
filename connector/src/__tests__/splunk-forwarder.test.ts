// =============================================================================
// ZKSplunk — SplunkForwarder handler tests (new probe event types)
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SplunkForwarder } from '../splunk-forwarder';
import { DEFAULT_CONFIG, type ZKSplunkConfig } from '../config';
import type { SplunkHecEvent } from '../hec-client';
import type { VitalCheckResult } from '../../../vitals/types';

function makeConfig(overrides: Partial<ZKSplunkConfig> = {}): ZKSplunkConfig {
  return {
    ...DEFAULT_CONFIG,
    splunkHecUrl: 'https://mock-splunk.local:8090',
    splunkHecToken: 'mock-token',
    enableConsoleLogging: false,
    enableAttestation: false,
    batchSize: 1,
    retryAttempts: 2,
    retryDelayMs: 1,
    ...overrides,
  };
}

/** Fetch spy that records bodies; outcome of the Nth call is scriptable. */
function installFetchSpy(failCalls: Set<number> = new Set()) {
  const bodies: string[] = [];
  const original = globalThis.fetch;
  let call = 0;
  globalThis.fetch = (async (_url: unknown, init?: unknown) => {
    const n = call++;
    const body = (init as { body?: string } | undefined)?.body;
    if (typeof body === 'string') bodies.push(body);
    if (failCalls.has(n)) {
      return { ok: false, status: 503, statusText: 'fail', json: async () => ({}) } as unknown as Response;
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({ text: 'Success', code: 0 }) } as unknown as Response;
  }) as typeof fetch;
  return {
    bodies,
    events: () => {
      const out: SplunkHecEvent[] = [];
      for (const b of bodies) for (const l of b.split('\n')) if (l.trim()) out.push(JSON.parse(l));
      return out;
    },
    restore: () => { globalThis.fetch = original; },
  };
}

const META = { dappName: 'd', environment: 'local', networkId: 'undeployed' } as const;

function res(overrides: Partial<VitalCheckResult>): VitalCheckResult {
  return { status: 'healthy', message: 'ok', detailLine: '-', responseTimeMs: 10, ...overrides };
}

let spy: ReturnType<typeof installFetchSpy>;
afterEach(() => spy?.restore());

describe('new probe handlers emit the right event type + sourcetype', () => {
  beforeEach(() => { spy = installFetchSpy(); });

  it('handleChainBlock → midnight.chain.block_latest on midnight:chain', async () => {
    const fwd = new SplunkForwarder(makeConfig(), META);
    await fwd.connect();
    fwd.handleChainBlock(res({ probeName: 'indexer_latest_block', blockHeight: 42, blockAgeSeconds: 5 }));
    await fwd.shutdown();
    const e = spy.events().find((x) => x.event.type === 'midnight.chain.block_latest');
    expect(e).toBeTruthy();
    expect(e!.sourcetype).toBe('midnight:chain');
    expect(e!.event.block_height).toBe(42);
    expect(e!.event.network_id).toBe('undeployed');
  });

  it('handleVersion → midnight.component.version', async () => {
    const fwd = new SplunkForwarder(makeConfig(), META);
    await fwd.connect();
    fwd.handleVersion('proof-server', res({ extra: { component_version: '8.0.3' } }));
    await fwd.shutdown();
    const e = spy.events().find((x) => x.event.type === 'midnight.component.version');
    expect(e).toBeTruthy();
    expect(e!.event.component).toBe('proof-server');
    expect(e!.event.component_version).toBe('8.0.3');
  });

  it('handleContractMonitorability → midnight.contract.monitorability on midnight:contracts', async () => {
    const fwd = new SplunkForwarder(makeConfig(), META);
    await fwd.connect();
    fwd.handleContractMonitorability(res({ status: 'warning', extra: { contract_found: false } }));
    await fwd.shutdown();
    const e = spy.events().find((x) => x.event.type === 'midnight.contract.monitorability');
    expect(e).toBeTruthy();
    expect(e!.sourcetype).toBe('midnight:contracts');
    expect(e!.event.component).toBe('contracts');
  });

  it('handleWalletBoundary → midnight.wallet.boundary (unknown, info severity)', async () => {
    const fwd = new SplunkForwarder(makeConfig(), META);
    await fwd.connect();
    fwd.handleWalletBoundary(res({ status: 'unknown', extra: { headless_mode: true } }));
    await fwd.shutdown();
    const e = spy.events().find((x) => x.event.type === 'midnight.wallet.boundary');
    expect(e).toBeTruthy();
    expect(e!.event.status).toBe('unknown');
    expect(e!.event.severity).toBe('info');
  });
});

describe('forwarding gate', () => {
  beforeEach(() => { spy = installFetchSpy(); });

  it('drops events when never connected (disconnected state)', async () => {
    const fwd = new SplunkForwarder(makeConfig(), META);
    // No connect() → state stays 'disconnected' → shouldForward() is false.
    fwd.handleChainBlock(res({ blockHeight: 1 }));
    fwd.handleVitalCheck('node', res({ status: 'critical' }));
    await fwd.shutdown();
    expect(spy.events().filter((e) => e.event.type?.startsWith('midnight.'))).toHaveLength(0);
  });
});

describe('HEC delivery telemetry', () => {
  it('does NOT emit a hec.delivery event on clean success', async () => {
    spy = installFetchSpy(); // every call ok
    const fwd = new SplunkForwarder(makeConfig(), META);
    await fwd.connect();
    fwd.handleVitalCheck('proof-server', res({}));
    await fwd.shutdown();
    expect(spy.events().some((e) => e.event.type === 'zksplunk.hec.delivery')).toBe(false);
  });

  it('emits a retry hec.delivery event when a batch recovers after one failure', async () => {
    // call 0 = connect healthCheck (ok); call 1 = first batch attempt (fail);
    // call 2 = retry (ok). batchSize 1 so the vital check is its own batch.
    spy = installFetchSpy(new Set([1]));
    const fwd = new SplunkForwarder(makeConfig(), META);
    await fwd.connect();
    fwd.handleVitalCheck('indexer', res({ status: 'healthy' }));
    await new Promise((r) => setTimeout(r, 20));
    await fwd.shutdown();
    const delivery = spy.events().find((e) => e.event.type === 'zksplunk.hec.delivery');
    expect(delivery).toBeTruthy();
    expect(delivery!.event.send_status).toBe('retry');
    expect(delivery!.event.severity).toBe('warn');
  });
});

describe('scheduler flag', () => {
  beforeEach(() => { spy = installFetchSpy(); });
  it('setSchedulerActive(false) is reflected in the next heartbeat', async () => {
    const fwd = new SplunkForwarder(makeConfig({ connectorHeartbeatIntervalMs: 10 }), META);
    await fwd.connect();
    fwd.setSchedulerActive(false);
    await new Promise((r) => setTimeout(r, 25)); // let a heartbeat fire
    await fwd.shutdown();
    const hb = spy.events().find((e) => e.event.type === 'zksplunk.connector.status');
    expect(hb).toBeTruthy();
    expect(hb!.event.scheduler_active).toBe(false);
  });
});
