// =============================================================================
// ZKSplunk ai-agent — HTTP/HTTPS server
// =============================================================================
// Serves the analyst chat UI at http://localhost:8787 or https://localhost:8787
// when AI_AGENT_TLS_CERT + AI_AGENT_TLS_KEY are set, and exposes:
//   GET  /api/health  → analyst + Splunk reachability
//   POST /api/ask     → { question } -> { markdown, classification, ... }
//
// Dependency-free (node:http/node:https + global fetch). Run with: npm run start
// =============================================================================

import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SplunkMcpClient } from './splunk-mcp-client.ts';
import { SplunkRestClient } from './splunk-rest-client.ts';
import { LlmClient, loadLlmConfig } from './llm-client.ts';
import { SplunkAiToolkitClient } from './splunk-ai-toolkit-client.ts';
import { ZkZapAnalyst } from './zkzap-analyst.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

// --- Minimal .env loader (no dependency) -------------------------------------
function hydrateEnv(): void {
  for (const file of ['.env', '../.env']) {
    try {
      const raw = readFileSync(resolve(HERE, '..', file), 'utf8');
      for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq === -1) continue;
        const key = t.slice(0, eq).trim();
        if (process.env[key] === undefined) process.env[key] = t.slice(eq + 1).trim();
      }
    } catch {
      /* missing is fine */
    }
  }
}
hydrateEnv();

const PORT = parseInt(process.env.AI_AGENT_PORT || '8787', 10);
const env = process.env;

const restBase = env.SPLUNK_REST_URL || 'https://localhost:8089';
const insecure = env.SPLUNK_INSECURE
  ? env.SPLUNK_INSECURE === 'true'
  : /localhost|127\.0\.0\.1/.test(restBase);

const mcp = new SplunkMcpClient({
  endpoint: env.SPLUNK_MCP_ENDPOINT,
  token: env.SPLUNK_MCP_TOKEN,
  searchToolName: env.SPLUNK_MCP_SEARCH_TOOL,
});
const rest = new SplunkRestClient({
  baseUrl: restBase,
  token: env.SPLUNK_REST_TOKEN,
  username: env.SPLUNK_USERNAME,
  password: env.SPLUNK_PASSWORD,
  insecure,
});
const externalLlm = new LlmClient(loadLlmConfig(env));
const splunkAi = new SplunkAiToolkitClient(rest, {
  enabled: env.SPLUNK_AI_TOOLKIT_ENABLED === 'true',
  provider: env.SPLUNK_AI_TOOLKIT_PROVIDER,
  model: env.SPLUNK_AI_TOOLKIT_MODEL,
});
const phraser = splunkAi.available ? splunkAi : externalLlm;
const analyst = new ZkZapAnalyst(mcp, rest, phraser);

function send(res: import('node:http').ServerResponse, code: number, body: any, type = 'application/json'): void {
  const payload = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(code, {
    'content-type': type,
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(payload);
}

const INDEX_HTML = (() => {
  try {
    return readFileSync(resolve(HERE, '..', 'public', 'index.html'), 'utf8');
  } catch {
    return '<!doctype html><h1>ZKSplunk analyst</h1><p>public/index.html missing.</p>';
  }
})();

const handler = async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
  const url = req.url || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    return res.end();
  }

  if (req.method === 'GET' && (url === '/' || url.startsWith('/index.html'))) {
    return send(res, 200, INDEX_HTML, 'text/html; charset=utf-8');
  }

  if (req.method === 'GET' && url.startsWith('/api/health')) {
    const ping = await rest.ping().catch((e) => ({ ok: false, message: (e as Error).message }));
    return send(res, 200, {
      ok: true,
      splunk: ping,
      evidenceSource: mcp.configured ? 'mcp-or-rest' : 'rest',
      mcpConfigured: mcp.configured,
      splunkAiToolkit: splunkAi.available,
      llm: phraser.available,
      phrasingProvider: phraser.providerName,
    });
  }

  if (req.method === 'POST' && url.startsWith('/api/ask')) {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) req.destroy();
    });
    req.on('end', async () => {
      try {
        const { question } = JSON.parse(raw || '{}');
        if (!question || typeof question !== 'string') {
          return send(res, 400, { error: 'Body must be { "question": string }.' });
        }
        const answer = await analyst.ask(question);
        return send(res, 200, answer);
      } catch (err) {
        return send(res, 500, { error: (err as Error).message });
      }
    });
    return;
  }

  send(res, 404, { error: 'Not found' });
};

const tlsCertPath = env.AI_AGENT_TLS_CERT;
const tlsKeyPath = env.AI_AGENT_TLS_KEY;
const protocol = tlsCertPath && tlsKeyPath ? 'https' : 'http';
const server =
  protocol === 'https'
    ? createHttpsServer(
        {
          cert: readFileSync(resolve(HERE, '..', tlsCertPath!)),
          key: readFileSync(resolve(HERE, '..', tlsKeyPath!)),
        },
        handler,
      )
    : createHttpServer(handler);

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
      `ZKSplunk analyst on ${protocol}://localhost:${PORT}\n` +
      `  Splunk REST : ${restBase}${insecure ? ' (TLS verify off)' : ''}\n` +
      `  MCP         : ${mcp.configured ? env.SPLUNK_MCP_ENDPOINT : 'not configured (REST fallback)'}\n` +
      `  AI phrasing : ${phraser.available ? phraser.providerName : 'off (deterministic summaries)'}`,
  );
});
