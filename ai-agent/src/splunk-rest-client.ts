// =============================================================================
// ZKSplunk ai-agent — Splunk REST client
// =============================================================================
// Fallback evidence source when the Splunk MCP Server is not configured.
// Runs SPL via the REST API (oneshot search jobs) and returns rows as JSON.
//
// Auth: prefer a Splunk REST auth token (SPLUNK_REST_TOKEN, sent as
// `Authorization: Bearer <token>`). Otherwise username/password against
// /services/auth/login to obtain a session key.
//
// Local Splunk uses a self-signed cert on :8089. Set SPLUNK_INSECURE=true
// (default for localhost) to skip TLS verification.
// =============================================================================

export interface SplunkRestConfig {
  baseUrl: string;        // https://localhost:8089
  token?: string;         // REST auth token (Bearer)
  username?: string;
  password?: string;
  insecure?: boolean;
}

export class SplunkRestClient {
  private sessionKey: string | null = null;

  constructor(private readonly cfg: SplunkRestConfig) {
    // Node's global fetch verifies TLS. For a local self-signed Splunk we opt
    // out explicitly and loudly, scoped to this process only.
    if (cfg.insecure) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
  }

  private async authHeader(): Promise<Record<string, string>> {
    if (this.cfg.token) return { Authorization: `Bearer ${this.cfg.token}` };
    if (!this.sessionKey) await this.login();
    return { Authorization: `Splunk ${this.sessionKey}` };
  }

  private async login(): Promise<void> {
    if (!this.cfg.username || !this.cfg.password) {
      throw new Error(
        'Splunk REST not authenticated: set SPLUNK_REST_TOKEN, or SPLUNK_USERNAME + SPLUNK_PASSWORD.',
      );
    }
    const body = new URLSearchParams({
      username: this.cfg.username,
      password: this.cfg.password,
      output_mode: 'json',
    });
    const res = await fetch(`${this.cfg.baseUrl}/services/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`Splunk login failed: HTTP ${res.status}`);
    const json = (await res.json()) as { sessionKey?: string };
    if (!json.sessionKey) throw new Error('Splunk login returned no sessionKey.');
    this.sessionKey = json.sessionKey;
  }

  /** Health probe so the analyst can report Splunk reachability honestly. */
  async ping(): Promise<{ ok: boolean; message: string }> {
    try {
      const headers = await this.authHeader();
      const res = await fetch(`${this.cfg.baseUrl}/services/server/info?output_mode=json`, { headers });
      return res.ok
        ? { ok: true, message: `Splunk REST reachable (HTTP ${res.status}).` }
        : { ok: false, message: `Splunk REST returned HTTP ${res.status}.` };
    } catch (err) {
      return { ok: false, message: `Splunk REST unreachable: ${(err as Error).message}` };
    }
  }

  /**
   * Run an SPL search and return result rows. Uses a oneshot job (synchronous),
   * which is enough for the deterministic evidence summaries we need.
   */
  async search(spl: string, earliest = '-15m', latest = 'now'): Promise<Record<string, any>[]> {
    const headers = await this.authHeader();
    const search = spl.trim().startsWith('|') || spl.trim().startsWith('search ')
      ? spl
      : `search ${spl}`;
    const body = new URLSearchParams({
      search,
      output_mode: 'json',
      earliest_time: earliest,
      latest_time: latest,
      exec_mode: 'oneshot',
    });
    const res = await fetch(`${this.cfg.baseUrl}/services/search/jobs`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      throw new Error(`Splunk search failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
    }
    const json = (await res.json()) as { results?: Record<string, any>[] };
    return json.results ?? [];
  }
}
