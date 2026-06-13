// =============================================================================
// ZKSplunk ai-agent — Splunk REST client tests
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SplunkRestClient } from '../splunk-rest-client';

let originalFetch: typeof globalThis.fetch;
let originalTls: string | undefined;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  else process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTls;
  vi.restoreAllMocks();
});

function captureFetch(response: { ok?: boolean; status?: number; json?: any; text?: string }) {
  const calls: Array<{ url: string; init: any }> = [];
  globalThis.fetch = (async (url: unknown, init?: unknown) => {
    calls.push({ url: String(url), init });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.json ?? {},
      text: async () => response.text ?? '',
    } as unknown as Response;
  }) as typeof fetch;
  return calls;
}

const cfg = { baseUrl: 'https://localhost:8089', token: 'rest-token' };

describe('constructor', () => {
  it('disables TLS verification when insecure', () => {
    new SplunkRestClient({ ...cfg, insecure: true });
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe('0');
  });
});

describe('ping', () => {
  it('returns ok when server/info responds', async () => {
    captureFetch({ ok: true, status: 200 });
    const r = await new SplunkRestClient(cfg).ping();
    expect(r.ok).toBe(true);
  });
  it('returns not ok on HTTP error', async () => {
    captureFetch({ ok: false, status: 401 });
    const r = await new SplunkRestClient(cfg).ping();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/401/);
  });
});

describe('auth', () => {
  it('sends a Bearer token header', async () => {
    const calls = captureFetch({ ok: true, json: { results: [] } });
    await new SplunkRestClient(cfg).search('index=zksplunk');
    expect(calls[0].init.headers.Authorization).toBe('Bearer rest-token');
  });

  it('throws when no token and no username/password', async () => {
    captureFetch({ ok: true, json: {} });
    await expect(new SplunkRestClient({ baseUrl: cfg.baseUrl }).search('index=zksplunk')).rejects.toThrow(
      /not authenticated/i,
    );
  });

  it('logs in with username/password to obtain a session key', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    let call = 0;
    globalThis.fetch = (async (url: unknown, init?: unknown) => {
      calls.push({ url: String(url), init });
      const n = call++;
      // first call = login, second = search
      const json = n === 0 ? { sessionKey: 'sess-123' } : { results: [{ a: 1 }] };
      return { ok: true, status: 200, json: async () => json, text: async () => '' } as unknown as Response;
    }) as typeof fetch;
    const client = new SplunkRestClient({ baseUrl: cfg.baseUrl, username: 'admin', password: 'pw' });
    const rows = await client.search('index=zksplunk');
    expect(calls[0].url).toMatch(/\/services\/auth\/login$/);
    expect(calls[1].init.headers.Authorization).toBe('Splunk sess-123');
    expect(rows).toEqual([{ a: 1 }]);
  });
});

describe('search', () => {
  it('prepends "search " to a bare index= query and uses oneshot', async () => {
    const calls = captureFetch({ ok: true, json: { results: [{ x: 1 }] } });
    const rows = await new SplunkRestClient(cfg).search('index=zksplunk status=critical', '-30m', 'now');
    const body = calls[0].init.body as URLSearchParams;
    expect(body.get('search')).toBe('search index=zksplunk status=critical');
    expect(body.get('exec_mode')).toBe('oneshot');
    expect(body.get('earliest_time')).toBe('-30m');
    expect(rows).toEqual([{ x: 1 }]);
  });

  it('does not double-prefix a query that already starts with search/pipe', async () => {
    const calls = captureFetch({ ok: true, json: { results: [] } });
    const client = new SplunkRestClient(cfg);
    await client.search('search index=zksplunk');
    await client.search('| makeresults');
    expect((calls[0].init.body as URLSearchParams).get('search')).toBe('search index=zksplunk');
    expect((calls[1].init.body as URLSearchParams).get('search')).toBe('| makeresults');
  });

  it('throws on a non-2xx search response', async () => {
    captureFetch({ ok: false, status: 400, text: 'bad search' });
    await expect(new SplunkRestClient(cfg).search('index=zksplunk')).rejects.toThrow(/HTTP 400/);
  });

  it('returns [] when results are absent', async () => {
    captureFetch({ ok: true, json: {} });
    expect(await new SplunkRestClient(cfg).search('index=zksplunk')).toEqual([]);
  });
});
