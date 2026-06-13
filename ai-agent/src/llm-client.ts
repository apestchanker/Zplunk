// =============================================================================
// ZKSplunk ai-agent — LLM client (OpenAI-compatible)
// =============================================================================
// Used to answer/phrase the chat assistant's replies. Evidence is always
// gathered from Splunk first; the model never invents telemetry.
//
// Prefers an NVIDIA-hosted OpenAI-compatible endpoint when configured, then a
// generic OpenAI-compatible base URL. Supports a primary model with an optional
// fallback model, a per-request timeout, retries, and a `reasoning_effort`
// knob (passed through; auto-stripped for models that reject it).
// =============================================================================

export interface LlmConfig {
  apiKey?: string;
  baseUrl?: string;        // e.g. https://integrate.api.nvidia.com/v1
  model?: string;          // primary model, e.g. openai/gpt-oss-20b
  fallbackModel?: string;  // tried if the primary fails / times out / is empty
  reasoningEffort?: string; // '', 'none', 'low', 'medium', 'high'
  requestTimeoutMs?: number; // per-request abort timeout (default 30000)
  retryCount?: number;       // extra attempts per model on transient failure (default 1)
  maxTokens?: number;        // completion budget; reasoning models need headroom (default 1024)
}

export function loadLlmConfig(env: NodeJS.ProcessEnv): LlmConfig {
  const apiKey = env.NVIDIA_API_KEY || env.OPENAI_API_KEY || env.LLM_API_KEY;
  const isNvidia = !!env.NVIDIA_API_KEY;
  const baseUrl =
    env.NVIDIA_BASE_URL ||
    env.LLM_BASE_URL ||
    (isNvidia ? 'https://integrate.api.nvidia.com/v1' : 'https://api.openai.com/v1');
  const model =
    env.NVIDIA_MODEL || env.LLM_MODEL || (isNvidia ? 'openai/gpt-oss-20b' : 'gpt-4o-mini');
  const fallbackModel = env.NVIDIA_FALLBACK_MODEL || env.LLM_FALLBACK_MODEL || undefined;
  const reasoningEffort = (env.NVIDIA_REASONING_EFFORT || env.LLM_REASONING_EFFORT || '').trim();

  const num = (v: string | undefined, dflt: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : dflt;
  };
  const requestTimeoutMs = num(env.NVIDIA_REQUEST_TIMEOUT_MS || env.LLM_REQUEST_TIMEOUT_MS, 30_000);
  const retryCount = num(env.NVIDIA_RETRY_COUNT ?? env.LLM_RETRY_COUNT, 1);
  const maxTokens = num(env.NVIDIA_MAX_TOKENS || env.LLM_MAX_TOKENS, 1024);

  return { apiKey, baseUrl, model, fallbackModel, reasoningEffort, requestTimeoutMs, retryCount, maxTokens };
}

type CallOutcome =
  | { kind: 'ok'; content: string }
  | { kind: 'empty' }              // 2xx but no usable content → try a different model
  | { kind: 'reasoning_rejected' } // 400 specifically on reasoning_effort → retry without it
  | { kind: 'transient' };         // timeout / network / 5xx / other → worth a retry or fallback

export class LlmClient {
  constructor(private readonly cfg: LlmConfig) {}

  get providerName(): string {
    if (!this.cfg.apiKey) return 'none';
    if (this.cfg.baseUrl?.includes('integrate.api.nvidia.com')) return 'nvidia';
    if (this.cfg.baseUrl?.includes('api.openai.com')) return 'openai';
    return 'openai-compatible';
  }

  get available(): boolean {
    return !!this.cfg.apiKey;
  }

  /**
   * Produce a completion. Tries the primary model (with retries on transient
   * failures), then the fallback model. Returns null if everything fails so the
   * caller can fall back to its deterministic answer.
   */
  async complete(system: string, user: string): Promise<string | null> {
    if (!this.cfg.apiKey) return null;

    const models = [this.cfg.model, this.cfg.fallbackModel]
      .filter((m): m is string => !!m)
      .filter((m, i, a) => a.indexOf(m) === i);
    if (models.length === 0) return null;

    const maxAttempts = Math.max(1, (this.cfg.retryCount ?? 1) + 1);

    for (const model of models) {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let r = await this.callOnce(model, system, user, true);
        if (r.kind === 'reasoning_rejected') {
          // This model doesn't accept our reasoning_effort value — retry without it.
          r = await this.callOnce(model, system, user, false);
        }
        if (r.kind === 'ok') return r.content;
        // 2xx-but-empty won't improve on retry — move to the next model.
        if (r.kind === 'empty') break;
        // 'transient' falls through to the retry loop, then to the next model.
      }
    }
    return null;
  }

  /** A single chat-completions call against one model. */
  private async callOnce(
    model: string,
    system: string,
    user: string,
    sendReasoningEffort: boolean,
  ): Promise<CallOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.requestTimeoutMs ?? 30_000);
    try {
      const body: Record<string, unknown> = {
        model,
        temperature: 0.3,
        max_tokens: this.cfg.maxTokens ?? 1024,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      };
      if (sendReasoningEffort && this.cfg.reasoningEffort) {
        body.reasoning_effort = this.cfg.reasoningEffort;
      }

      const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (res.status === 400 && /reasoning_effort/i.test(text) && sendReasoningEffort) {
          return { kind: 'reasoning_rejected' };
        }
        // 5xx and 429 are worth a retry / fallback; other 4xx usually aren't,
        // but trying the fallback model is still useful, so treat all as transient.
        return { kind: 'transient' };
      }

      const json = (await res.json()) as any;
      const content = json?.choices?.[0]?.message?.content;
      return typeof content === 'string' && content.trim()
        ? { kind: 'ok', content }
        : { kind: 'empty' };
    } catch {
      // Abort (timeout) or network error.
      return { kind: 'transient' };
    } finally {
      clearTimeout(timer);
    }
  }
}
