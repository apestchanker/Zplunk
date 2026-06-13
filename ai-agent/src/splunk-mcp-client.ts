// =============================================================================
// ZKSplunk ai-agent — Splunk MCP Server client (preferred evidence path)
// =============================================================================
// Thin client for the Splunk MCP Server (Splunkbase app 7931). When
// SPLUNK_MCP_ENDPOINT is configured we call its JSON-RPC `tools/call` to run a
// search; otherwise the analyst falls back to the REST client.
//
// MCP endpoint/auth details vary by install, so this client is intentionally
// defensive: any failure surfaces as `available=false` and the analyst falls
// back to REST. It speaks the MCP Streamable HTTP JSON-RPC shape.
// =============================================================================

export interface SplunkMcpConfig {
  endpoint?: string;       // e.g. http://localhost:8000/en-US/.../mcp  or dedicated MCP URL
  token?: string;          // optional bearer token for the MCP endpoint
  searchToolName?: string; // tool that runs SPL; default "run_splunk_search"
}

export class SplunkMcpClient {
  private id = 0;
  constructor(private readonly cfg: SplunkMcpConfig) {}

  get configured(): boolean {
    return !!this.cfg.endpoint;
  }

  private async rpc(method: string, params: Record<string, any>): Promise<any> {
    if (!this.cfg.endpoint) throw new Error('MCP endpoint not configured');
    const res = await fetch(this.cfg.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(this.cfg.token ? { Authorization: `Bearer ${this.cfg.token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
    });
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);
    const text = await res.text();
    // MCP Streamable HTTP may return SSE; extract the JSON data line if so.
    const jsonText = text.includes('data:')
      ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')
      : text;
    const parsed = JSON.parse(jsonText);
    if (parsed.error) throw new Error(`MCP error: ${parsed.error.message ?? 'unknown'}`);
    return parsed.result;
  }

  /** Probe the MCP server by listing tools. */
  async available(): Promise<boolean> {
    if (!this.configured) return false;
    try {
      await this.rpc('tools/list', {});
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Run SPL through the MCP search tool. Returns parsed rows when the tool
   * returns JSON text content; otherwise returns the raw text in one row.
   */
  async search(spl: string, earliest = '-15m', latest = 'now'): Promise<Record<string, any>[]> {
    // Splunk MCP Server (app 7931) exposes `splunk_run_query` taking
    // { query, earliest_time, latest_time, row_limit }.
    const tool = this.cfg.searchToolName || 'splunk_run_query';
    const result = await this.rpc('tools/call', {
      name: tool,
      arguments: { query: spl, earliest_time: earliest, latest_time: latest, row_limit: 200 },
    });
    const content = Array.isArray(result?.content) ? result.content : [];
    const textPart = content.find((c: any) => c.type === 'text')?.text ?? '';
    try {
      const parsed = JSON.parse(textPart);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed?.results)) return parsed.results;
      return [parsed];
    } catch {
      return textPart ? [{ raw: textPart }] : [];
    }
  }
}
