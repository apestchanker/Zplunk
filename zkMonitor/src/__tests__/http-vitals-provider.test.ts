// =============================================================================
// ZKSplunk zkMonitor — HttpVitalsProvider probe tests
// =============================================================================
// Mocks global fetch to exercise every probe's status logic and structured
// fields without touching live infrastructure.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpVitalsProvider, accumulateUnshielded } from '../http-vitals-provider';

const OPTS = {
  proofServerUrl: 'http://localhost:6300',
  indexerUrl: 'http://localhost:8088/api/v4/graphql',
  nodeUrl: 'http://localhost:9944',
  timeoutMs: 200,
};

interface MockResponse {
  ok?: boolean;
  status?: number;
  body?: string;
  delayMs?: number;
  throw?: 'network' | 'abort';
}

/** Queue of responses keyed by a matcher on the URL; falls back to default. */
function mockFetch(handler: (url: string, init: any) => MockResponse) {
  globalThis.fetch = (async (url: unknown, init?: unknown) => {
    const r = handler(String(url), init);
    if (r.throw === 'network') throw new Error('fetch failed');
    if (r.throw === 'abort') {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }
    if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      text: async () => r.body ?? '',
    } as unknown as Response;
  }) as typeof fetch;
}

let originalFetch: typeof globalThis.fetch;
let originalWebSocket: typeof globalThis.WebSocket;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalWebSocket = globalThis.WebSocket;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
  vi.restoreAllMocks();
});

function provider() { return new HttpVitalsProvider(OPTS); }

// ---------------------------------------------------------------------------
// 1. Proof server reachability
// ---------------------------------------------------------------------------
describe('checkProofServer', () => {
  it('healthy on 2xx fast response with probe fields', async () => {
    mockFetch(() => ({ ok: true, status: 200 }));
    const r = await provider().checkProofServer();
    expect(r.status).toBe('healthy');
    expect(r.probeName).toBe('proof_server_health');
    expect(r.endpoint).toBe('http://localhost:6300/health');
    expect(r.httpStatus).toBe(200);
    expect(r.extra?.proof_server_health_path).toBe('/health');
  });

  it('warning when slow (>=2000ms)', async () => {
    mockFetch(() => ({ ok: true, status: 200, delayMs: 30 }));
    const slow = new HttpVitalsProvider({ ...OPTS, timeoutMs: 5000 });
    // Force latency by stubbing Date.now via delay — simulate via a long delay.
    // Use a real delay just above threshold is impractical; instead assert the
    // boundary logic by mocking a slow fetch through delayMs with a high cap.
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)       // start
      .mockReturnValueOnce(2500);   // end → 2500ms
    const r = await slow.checkProofServer();
    expect(r.status).toBe('warning');
    expect(r.message).toMatch(/slow/i);
  });

  it('falls back to /version on 404 and reports warning', async () => {
    mockFetch((url) =>
      url.endsWith('/health') ? { ok: false, status: 404 } : { ok: true, status: 200, body: '8.0.3' },
    );
    const r = await provider().checkProofServer();
    expect(r.status).toBe('warning');
    expect(r.endpoint).toBe('http://localhost:6300/version');
    expect(r.extra?.proof_server_health_path).toBe('/version');
  });

  it('critical on HTTP 5xx', async () => {
    mockFetch(() => ({ ok: false, status: 503 }));
    const r = await provider().checkProofServer();
    expect(r.status).toBe('critical');
    expect(r.httpStatus).toBe(503);
    expect(r.errorName).toBe('HttpError');
  });

  it('critical on network failure', async () => {
    mockFetch(() => ({ throw: 'network' }));
    const r = await provider().checkProofServer();
    expect(r.status).toBe('critical');
    expect(r.responseTimeMs).toBeNull();
    expect(r.errorMessage).toMatch(/fetch failed/);
  });

  it('critical with TimeoutError on abort', async () => {
    mockFetch(() => ({ throw: 'abort' }));
    const r = await provider().checkProofServer();
    expect(r.status).toBe('critical');
    expect(r.errorName).toBe('TimeoutError');
  });
});

// ---------------------------------------------------------------------------
// 5. Proof server version
// ---------------------------------------------------------------------------
describe('checkProofServerVersion', () => {
  it('extracts a version from a JSON body', async () => {
    mockFetch(() => ({ ok: true, status: 200, body: JSON.stringify({ version: '8.0.3' }) }));
    const r = await provider().checkProofServerVersion();
    expect(r.status).toBe('healthy');
    expect(r.extra?.component_version).toBe('8.0.3');
    expect(String(r.extra?.version_raw_hash)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('extracts a semver from a plain-text body', async () => {
    mockFetch(() => ({ ok: true, status: 200, body: 'proof-server v1.2.3 build xyz' }));
    const r = await provider().checkProofServerVersion();
    expect(r.extra?.component_version).toBe('1.2.3');
  });

  it('warning + unsupportedProbe on 404 (not critical)', async () => {
    mockFetch(() => ({ ok: false, status: 404 }));
    const r = await provider().checkProofServerVersion();
    expect(r.status).toBe('warning');
    expect(r.unsupportedProbe).toBe(true);
  });

  it('warning on network failure (reachability owns critical)', async () => {
    mockFetch(() => ({ throw: 'network' }));
    const r = await provider().checkProofServerVersion();
    expect(r.status).toBe('warning');
  });
});

// ---------------------------------------------------------------------------
// 2. Indexer GraphQL reachability
// ---------------------------------------------------------------------------
describe('checkIndexer', () => {
  it('healthy on 2xx + valid JSON + no errors', async () => {
    mockFetch(() => ({ ok: true, status: 200, body: JSON.stringify({ data: { __typename: 'Query' } }) }));
    const r = await provider().checkIndexer();
    expect(r.status).toBe('healthy');
    expect(r.probeName).toBe('indexer_graphql_typename');
    expect(r.graphqlErrorsCount).toBe(0);
  });

  it('critical on invalid JSON', async () => {
    mockFetch(() => ({ ok: true, status: 200, body: 'not json' }));
    const r = await provider().checkIndexer();
    expect(r.status).toBe('critical');
    expect(r.errorName).toBe('ParseError');
  });

  it('critical on GraphQL errors with no data', async () => {
    mockFetch(() => ({ ok: true, status: 200, body: JSON.stringify({ errors: [{ message: 'boom' }] }) }));
    const r = await provider().checkIndexer();
    expect(r.status).toBe('critical');
    expect(r.graphqlErrorsCount).toBe(1);
    expect(r.errorMessage).toBe('boom');
  });

  it('warning on GraphQL errors that still return data', async () => {
    mockFetch(() => ({ ok: true, status: 200, body: JSON.stringify({ data: { __typename: 'Q' }, errors: [{ message: 'partial' }] }) }));
    const r = await provider().checkIndexer();
    expect(r.status).toBe('warning');
  });

  it('critical on HTTP 5xx', async () => {
    mockFetch(() => ({ ok: false, status: 502, body: '' }));
    const r = await provider().checkIndexer();
    expect(r.status).toBe('critical');
  });

  it('checkNetwork is an alias of checkIndexer', async () => {
    mockFetch(() => ({ ok: true, status: 200, body: JSON.stringify({ data: {} }) }));
    const r = await provider().checkNetwork();
    expect(r.probeName).toBe('indexer_graphql_typename');
  });
});

// ---------------------------------------------------------------------------
// 3. Latest block
// ---------------------------------------------------------------------------
describe('checkLatestBlock', () => {
  const block = (height: number, tsSec: number) =>
    JSON.stringify({ data: { block: { height, hash: 'abcd', protocolVersion: 8, timestamp: tsSec, author: 'auth' } } });

  it('healthy when block is fresh and advancing', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockFetch(() => ({ ok: true, status: 200, body: block(100, now - 2) }));
    const r = await provider().checkLatestBlock();
    expect(r.status).toBe('healthy');
    expect(r.blockHeight).toBe(100);
    expect(r.blockAgeSeconds).toBeLessThanOrEqual(3);
    expect(r.extra?.protocol_version).toBe(8);
  });

  it('warning when block age exceeds 30s', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockFetch(() => ({ ok: true, status: 200, body: block(101, now - 45) }));
    const r = await provider().checkLatestBlock();
    expect(r.status).toBe('warning');
  });

  it('critical when block age exceeds 60s', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockFetch(() => ({ ok: true, status: 200, body: block(102, now - 90) }));
    const r = await provider().checkLatestBlock();
    expect(r.status).toBe('critical');
  });

  it('warning when height is unchanged across samples', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockFetch(() => ({ ok: true, status: 200, body: block(200, now) }));
    const p = provider();
    await p.checkLatestBlock();                 // first sample
    const r = await p.checkLatestBlock();        // same height
    expect(r.status).toBe('warning');
    expect(r.extra?.height_unchanged).toBe(true);
  });

  it('normalises millisecond timestamps to seconds', async () => {
    const nowMs = Date.now();
    mockFetch(() => ({ ok: true, status: 200, body: block(300, nowMs) }));
    const r = await provider().checkLatestBlock();
    expect(r.blockAgeSeconds).toBeLessThanOrEqual(3); // not a huge ms-derived age
  });

  it('unknown (not failed) when reachable but no block yet', async () => {
    mockFetch(() => ({ ok: true, status: 200, body: JSON.stringify({ data: { block: null } }) }));
    const r = await provider().checkLatestBlock();
    expect(r.status).toBe('unknown');
    expect(r.blockHeight).toBeNull();
  });

  it('critical on query/network failure', async () => {
    mockFetch(() => ({ throw: 'network' }));
    const r = await provider().checkLatestBlock();
    expect(r.status).toBe('critical');
    expect(r.probeName).toBe('indexer_latest_block');
  });
});

// ---------------------------------------------------------------------------
// 4. Node health
// ---------------------------------------------------------------------------
describe('checkNode', () => {
  it('healthy on 2xx', async () => {
    mockFetch(() => ({ ok: true, status: 200 }));
    const r = await provider().checkNode();
    expect(r.status).toBe('healthy');
    expect(r.endpoint).toBe('http://localhost:9944/health');
    expect(r.extra?.unsupported_probe).toBe(false);
  });

  it('unknown + unsupportedProbe on 404', async () => {
    mockFetch(() => ({ ok: false, status: 404 }));
    const r = await provider().checkNode();
    expect(r.status).toBe('unknown');
    expect(r.unsupportedProbe).toBe(true);
  });

  it('critical on 5xx', async () => {
    mockFetch(() => ({ ok: false, status: 500 }));
    const r = await provider().checkNode();
    expect(r.status).toBe('critical');
  });

  it('critical on network failure', async () => {
    mockFetch(() => ({ throw: 'network' }));
    const r = await provider().checkNode();
    expect(r.status).toBe('critical');
    expect(r.probeName).toBe('node_health');
  });
});

// ---------------------------------------------------------------------------
// 7. Wallet boundary
// ---------------------------------------------------------------------------
describe('checkWallet', () => {
  it('is always unknown with headless flags (no network call)', async () => {
    const r = await provider().checkWallet();
    expect(r.status).toBe('unknown');
    expect(r.probeName).toBe('wallet_boundary');
    expect(r.extra?.headless_mode).toBe(true);
    expect(r.extra?.wallet_monitoring_configured).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Contract monitorability
// ---------------------------------------------------------------------------
describe('checkContractMonitorability', () => {
  const contracts = [{ id: 'zksplunk-attest', name: 'ZKSplunk', address: 'abc123' }];

  it('warning when no contracts configured', async () => {
    const r = await provider().checkContractMonitorability([]);
    expect(r.status).toBe('warning');
    expect(r.extra?.contract_found).toBe(false);
  });

  it('healthy when the contract is found', async () => {
    mockFetch(() => ({
      ok: true, status: 200,
      body: JSON.stringify({ data: { contractAction: { __typename: 'ContractDeploy', unshieldedBalances: [{ tokenType: 't', amount: '1' }] } } }),
    }));
    const r = await provider().checkContractMonitorability(contracts);
    expect(r.status).toBe('healthy');
    expect(r.extra?.contract_found).toBe(true);
    expect(r.extra?.unshielded_balance_count).toBe(1);
  });

  it('warning when configured but not found', async () => {
    mockFetch(() => ({ ok: true, status: 200, body: JSON.stringify({ data: { contractAction: null } }) }));
    const r = await provider().checkContractMonitorability(contracts);
    expect(r.status).toBe('warning');
    expect(r.extra?.contract_found).toBe(false);
  });

  it('warning when the query is unsupported (GraphQL errors)', async () => {
    mockFetch(() => ({ ok: true, status: 200, body: JSON.stringify({ errors: [{ message: 'unknown field' }] }) }));
    const r = await provider().checkContractMonitorability(contracts);
    expect(r.status).toBe('warning');
    expect(r.extra?.contract_query_supported).toBe(false);
  });

  it('critical on HTTP error while configured', async () => {
    mockFetch(() => ({ ok: false, status: 500, body: '' }));
    const r = await provider().checkContractMonitorability(contracts);
    expect(r.status).toBe('critical');
  });

});

// ---------------------------------------------------------------------------
// Unshielded wallet accumulation (pure)
// ---------------------------------------------------------------------------
describe('accumulateUnshielded', () => {
  const ADDR = 'mn_addr_preview1abc';
  const OTHER = 'mn_addr_preview1zzz';

  it('returns zeros for an address with no activity (only a progress marker)', () => {
    const acc = accumulateUnshielded(
      [{ __typename: 'UnshieldedTransactionsProgress', highestTransactionId: 2343 }],
      ADDR,
    );
    expect(acc).toEqual({ txCount: 0, createdUtxos: 0, spentUtxos: 0, balances: {}, highestTxId: 2343 });
  });

  it('computes net balance per token = created − spent for owned UTXOs', () => {
    const acc = accumulateUnshielded(
      [
        {
          __typename: 'UnshieldedTransaction',
          createdUtxos: [
            { tokenType: 'NIGHT', value: '100', owner: ADDR },
            { tokenType: 'NIGHT', value: '50', owner: ADDR },
            { tokenType: 'NIGHT', value: '999', owner: OTHER }, // not ours → ignored
          ],
          spentUtxos: [{ tokenType: 'NIGHT', value: '30', owner: ADDR }],
        },
        { __typename: 'UnshieldedTransactionsProgress', highestTransactionId: 10 },
      ],
      ADDR,
    );
    expect(acc.txCount).toBe(1);
    expect(acc.createdUtxos).toBe(2);
    expect(acc.spentUtxos).toBe(1);
    expect(acc.balances).toEqual({ NIGHT: '120' }); // 100 + 50 − 30
    expect(acc.highestTxId).toBe(10);
  });

  it('tracks multiple token types independently', () => {
    const acc = accumulateUnshielded(
      [
        {
          __typename: 'UnshieldedTransaction',
          createdUtxos: [
            { tokenType: 'NIGHT', value: '5', owner: ADDR },
            { tokenType: 'DUST', value: '7', owner: ADDR },
          ],
          spentUtxos: [],
        },
      ],
      ADDR,
    );
    expect(acc.balances).toEqual({ NIGHT: '5', DUST: '7' });
    expect(acc.txCount).toBe(1);
  });
});

describe('checkWalletUnshielded', () => {
  it('subscribes to public unshielded activity and returns tracked telemetry', async () => {
    const sent: string[] = [];
    class MockWebSocket {
      onopen: (() => void) | null = null;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;

      constructor(
        readonly url: string,
        readonly protocol: string,
      ) {
        setTimeout(() => this.onopen?.(), 0);
      }

      send(raw: string) {
        sent.push(raw);
        const msg = JSON.parse(raw);
        if (msg.type === 'connection_init') {
          setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'connection_ack' }) } as MessageEvent), 0);
        }
        if (msg.type === 'subscribe') {
          // Mirror the REAL indexer ordering: a Progress marker FIRST, then the
          // replayed transactions. The old code bailed on this first Progress
          // and reported 0 activity; the drain must now keep reading past it.
          setTimeout(() => {
            this.onmessage?.({
              data: JSON.stringify({
                type: 'next',
                payload: {
                  data: {
                    unshieldedTransactions: {
                      __typename: 'UnshieldedTransactionsProgress',
                      highestTransactionId: 2343,
                    },
                  },
                },
              }),
            } as MessageEvent);
            this.onmessage?.({
              data: JSON.stringify({
                type: 'next',
                payload: {
                  data: {
                    unshieldedTransactions: {
                      __typename: 'UnshieldedTransaction',
                      createdUtxos: [{ tokenType: 'NIGHT', value: '11', owner: 'mn_addr_preview1abc' }],
                      spentUtxos: [],
                    },
                  },
                },
              }),
            } as MessageEvent);
          }, 0);
        }
      }

      close() {
        this.onclose?.();
      }
    }

    globalThis.WebSocket = MockWebSocket as any;

    const r = await provider().checkWalletUnshielded('mn_addr_preview1abc');
    expect(r.status).toBe('tracked');
    expect(r.probeName).toBe('wallet_unshielded');
    expect(r.endpoint).toBe('ws://localhost:8088/api/v4/graphql/ws');
    expect(r.extra?.unshielded_tx_count).toBe(1);
    expect(r.extra?.unshielded_primary_balance).toBe('11');
    expect(r.extra?.indexer_highest_tx_id).toBe(2343);
    expect(r.extra?.wallet_balance_shielded_private).toBe(true);
    expect(sent.some((raw) => raw.includes('unshieldedTransactions'))).toBe(true);
  });
});

describe('checkContractMonitorability (alias)', () => {
  const contracts = [{ id: 'zksplunk-attest', name: 'ZKSplunk', address: 'abc123' }];
  it('checkContracts is an alias', async () => {
    mockFetch(() => ({ ok: true, status: 200, body: JSON.stringify({ data: { contractAction: { __typename: 'ContractCall', unshieldedBalances: [] } } }) }));
    const r = await provider().checkContracts(contracts);
    expect(r.probeName).toBe('contract_monitorability');
  });
});
