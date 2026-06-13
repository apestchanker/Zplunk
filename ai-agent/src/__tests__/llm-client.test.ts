// =============================================================================
// ZKSplunk ai-agent — LLM client tests
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LlmClient, loadLlmConfig } from '../llm-client';

let originalFetch: typeof globalThis.fetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

describe('loadLlmConfig', () => {
  it('prefers NVIDIA when NVIDIA_API_KEY is set', () => {
    const c = loadLlmConfig({ NVIDIA_API_KEY: 'nv' } as NodeJS.ProcessEnv);
    expect(c.apiKey).toBe('nv');
    expect(c.baseUrl).toContain('nvidia');
    expect(c.model).toBeTruthy();
  });

  it('uses OpenAI defaults when only OPENAI_API_KEY is set', () => {
    const c = loadLlmConfig({ OPENAI_API_KEY: 'oa' } as NodeJS.ProcessEnv);
    expect(c.apiKey).toBe('oa');
    expect(c.baseUrl).toContain('openai');
  });

  it('honors explicit base URL and model overrides', () => {
    const c = loadLlmConfig({ LLM_API_KEY: 'k', LLM_BASE_URL: 'https://x/v1', LLM_MODEL: 'm' } as NodeJS.ProcessEnv);
    expect(c.baseUrl).toBe('https://x/v1');
    expect(c.model).toBe('m');
  });

  it('reads the full NVIDIA config (base url, model, fallback, effort, timeout, retries)', () => {
    const c = loadLlmConfig({
      NVIDIA_API_KEY: 'nv',
      NVIDIA_BASE_URL: 'https://integrate.api.nvidia.com/v1',
      NVIDIA_MODEL: 'deepseek-ai/deepseek-v4-flash',
      NVIDIA_FALLBACK_MODEL: 'openai/gpt-oss-20b',
      NVIDIA_REASONING_EFFORT: 'none',
      NVIDIA_REQUEST_TIMEOUT_MS: '30000',
      NVIDIA_RETRY_COUNT: '1',
    } as NodeJS.ProcessEnv);
    expect(c.model).toBe('deepseek-ai/deepseek-v4-flash');
    expect(c.fallbackModel).toBe('openai/gpt-oss-20b');
    expect(c.reasoningEffort).toBe('none');
    expect(c.requestTimeoutMs).toBe(30000);
    expect(c.retryCount).toBe(1);
  });
});

describe('available', () => {
  it('is false without a key, true with one', () => {
    expect(new LlmClient({}).available).toBe(false);
    expect(new LlmClient({ apiKey: 'k', baseUrl: 'https://x/v1', model: 'm' }).available).toBe(true);
  });
});

describe('complete', () => {
  const cfg = { apiKey: 'k', baseUrl: 'https://x/v1', model: 'm' };

  it('returns null immediately when no key is configured (no fetch)', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const out = await new LlmClient({}).complete('sys', 'user');
    expect(out).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns the assistant content on success', async () => {
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ choices: [{ message: { content: 'phrased answer' } }] }) }) as unknown as Response) as typeof fetch;
    expect(await new LlmClient(cfg).complete('sys', 'user')).toBe('phrased answer');
  });

  it('returns null on a non-2xx response', async () => {
    globalThis.fetch = (async () => ({ ok: false, json: async () => ({}) }) as unknown as Response) as typeof fetch;
    expect(await new LlmClient(cfg).complete('sys', 'user')).toBeNull();
  });

  it('returns null when the request throws', async () => {
    globalThis.fetch = (async () => { throw new Error('boom'); }) as typeof fetch;
    expect(await new LlmClient(cfg).complete('sys', 'user')).toBeNull();
  });

  it('falls back to the secondary model when the primary keeps failing', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (_url: unknown, init: any) => {
      const model = JSON.parse(init.body).model;
      seen.push(model);
      if (model === 'primary') return { ok: false, status: 503, text: async () => 'busy', json: async () => ({}) } as unknown as Response;
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'from fallback' } }] }) } as unknown as Response;
    }) as typeof fetch;
    const out = await new LlmClient({ apiKey: 'k', baseUrl: 'https://x/v1', model: 'primary', fallbackModel: 'fallback', retryCount: 1 }).complete('s', 'u');
    expect(out).toBe('from fallback');
    expect(seen).toContain('primary');
    expect(seen).toContain('fallback');
  });

  it('retries without reasoning_effort when a model rejects it (HTTP 400)', async () => {
    const efforts: (string | undefined)[] = [];
    globalThis.fetch = (async (_url: unknown, init: any) => {
      const body = JSON.parse(init.body);
      efforts.push(body.reasoning_effort);
      if (body.reasoning_effort === 'none') {
        return { ok: false, status: 400, text: async () => "Input should be 'low', 'medium' or 'high'; got reasoning_effort", json: async () => ({}) } as unknown as Response;
      }
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok without effort' } }] }) } as unknown as Response;
    }) as typeof fetch;
    const out = await new LlmClient({ apiKey: 'k', baseUrl: 'https://x/v1', model: 'm', reasoningEffort: 'none' }).complete('s', 'u');
    expect(out).toBe('ok without effort');
    expect(efforts[0]).toBe('none');       // first attempt sent it
    expect(efforts).toContain(undefined);  // retry omitted it
  });
});
