// =============================================================================
// ZKSplunk ai-agent — Splunk MCP client tests
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SplunkMcpClient } from '../splunk-mcp-client';

let originalFetch: typeof globalThis.fetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

function mockRpc(handler: (method: string, params: any) => { ok?: boolean; status?: number; text: string }) {
  globalThis.fetch = (async (_url: unknown, init?: unknown) => {
    const body = JSON.parse((init as { body: string }).body);
    const r = handler(body.method, body.params);
    return { ok: r.ok ?? true, status: r.status ?? 200, text: async () => r.text } as unknown as Response;
  }) as typeof fetch;
}

const ENDPOINT = 'http://localhost:8000/mcp';

describe('configured', () => {
  it('is false without an endpoint and true with one', () => {
    expect(new SplunkMcpClient({}).configured).toBe(false);
    expect(new SplunkMcpClient({ endpoint: ENDPOINT }).configured).toBe(true);
  });
});

describe('available', () => {
  it('returns false when not configured (no fetch)', async () => {
    expect(await new SplunkMcpClient({}).available()).toBe(false);
  });

  it('returns true when tools/list succeeds', async () => {
    mockRpc((method) => {
      expect(method).toBe('tools/list');
      return { text: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }) };
    });
    expect(await new SplunkMcpClient({ endpoint: ENDPOINT }).available()).toBe(true);
  });

  it('returns false when the endpoint errors', async () => {
    mockRpc(() => ({ ok: false, status: 500, text: '' }));
    expect(await new SplunkMcpClient({ endpoint: ENDPOINT }).available()).toBe(false);
  });
});

describe('search', () => {
  it('parses a JSON array returned in text content', async () => {
    mockRpc((method, params) => {
      expect(method).toBe('tools/call');
      expect(params.name).toBe('splunk_run_query');
      return {
        text: JSON.stringify({
          result: { content: [{ type: 'text', text: JSON.stringify([{ component: 'node', status: 'healthy' }]) }] },
        }),
      };
    });
    const rows = await new SplunkMcpClient({ endpoint: ENDPOINT }).search('index=zksplunk');
    expect(rows).toEqual([{ component: 'node', status: 'healthy' }]);
  });

  it('unwraps a { results: [...] } object in text content', async () => {
    mockRpc(() => ({
      text: JSON.stringify({ result: { content: [{ type: 'text', text: JSON.stringify({ results: [{ a: 1 }] }) }] } }),
    }));
    expect(await new SplunkMcpClient({ endpoint: ENDPOINT }).search('q')).toEqual([{ a: 1 }]);
  });

  it('parses SSE-framed (data:) JSON-RPC responses', async () => {
    mockRpc(() => ({
      text: 'event: message\ndata: ' + JSON.stringify({ result: { content: [{ type: 'text', text: '[]' }] } }) + '\n\n',
    }));
    expect(await new SplunkMcpClient({ endpoint: ENDPOINT }).search('q')).toEqual([]);
  });

  it('falls back to raw text when content is not JSON', async () => {
    mockRpc(() => ({ text: JSON.stringify({ result: { content: [{ type: 'text', text: 'plain output' }] } }) }));
    expect(await new SplunkMcpClient({ endpoint: ENDPOINT }).search('q')).toEqual([{ raw: 'plain output' }]);
  });

  it('honors a custom search tool name', async () => {
    mockRpc((_m, params) => {
      expect(params.name).toBe('my_search');
      return { text: JSON.stringify({ result: { content: [{ type: 'text', text: '[]' }] } }) };
    });
    await new SplunkMcpClient({ endpoint: ENDPOINT, searchToolName: 'my_search' }).search('q');
  });

  it('throws when the RPC returns an error', async () => {
    mockRpc(() => ({ text: JSON.stringify({ error: { message: 'tool missing' } }) }));
    await expect(new SplunkMcpClient({ endpoint: ENDPOINT }).search('q')).rejects.toThrow(/tool missing/);
  });
});
