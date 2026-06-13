// =============================================================================
// ZKSplunk ai-agent — Splunk AI Toolkit phrasing client
// =============================================================================
// Uses Splunk AI Toolkit's `| ai` ML-SPL command so final answer phrasing can
// run inside Splunk instead of an external chat endpoint. This keeps Splunk AI
// as the preferred runtime AI path when AI Toolkit is installed/configured.
// =============================================================================

import type { SplunkRestClient } from './splunk-rest-client';

export interface SplunkAiToolkitConfig {
  enabled?: boolean;
  provider?: string;
  model?: string;
}

export interface AssistantPhraser {
  readonly available: boolean;
  readonly providerName: string;
  complete(system: string, user: string): Promise<string | null>;
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function firstAiResult(row: Record<string, any> | undefined): string | null {
  if (!row) return null;
  for (const key of ['ai_result', 'ai_result_1', 'response', 'answer']) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith('ai_result') && typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

export class SplunkAiToolkitClient implements AssistantPhraser {
  constructor(
    private readonly rest: SplunkRestClient,
    private readonly cfg: SplunkAiToolkitConfig,
  ) {}

  get available(): boolean {
    return !!this.cfg.enabled;
  }

  get providerName(): string {
    return 'splunk-ai-toolkit';
  }

  async complete(system: string, user: string): Promise<string | null> {
    if (!this.available) return null;
    const prompt =
      `${system}\n\n${user}\n\n` +
      'Return only the final operator-facing markdown answer. Preserve the privacy boundary.';
    const provider = this.cfg.provider ? ` provider="${esc(this.cfg.provider)}"` : '';
    const model = this.cfg.model ? ` model="${esc(this.cfg.model)}"` : '';
    const spl =
      `| makeresults ` +
      `| eval zksplunk_prompt="${esc(prompt)}" ` +
      `| ai prompt="{zksplunk_prompt}"${provider}${model}`;
    try {
      const rows = await this.rest.search(spl, '-1m', 'now');
      return firstAiResult(rows[0]);
    } catch {
      return null;
    }
  }
}
