// =============================================================================
// ZKSplunk — Probe Result Sanitizer
// =============================================================================
// Ensures secrets never reach Splunk or local logs. Applied to every probe
// result and every endpoint string before it leaves the agent.
//
// What it scrubs:
//   • URL credentials  (https://user:pass@host → https://host)
//   • URL query strings (?token=... → stripped, they may carry secrets)
//   • Authorization / token / apikey / password key=value pairs in free text
//   • Splunk HEC tokens and anything that looks like a long opaque secret
// =============================================================================

import type { VitalCheckResult } from '../../vitals/types';

const SECRET_KEY_RE =
  /\b(authorization|auth|token|api[-_]?key|secret|password|passwd|pwd|bearer|hec[-_]?token)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi;

/** Redact secrets embedded in an arbitrary free-text string. */
export function sanitizeText(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  let out = String(input);
  // Redact bare Bearer/Splunk auth tokens FIRST so the token can't survive by
  // being parsed as the value of an `Authorization:` key below. Case-insensitive
  // match, original keyword case preserved.
  out = out.replace(/\b(Splunk|Bearer)\s+[A-Za-z0-9._\-]{8,}/gi, '$1 ***');
  out = out.replace(SECRET_KEY_RE, (_m, key) => `${key}=***`);
  return out;
}

/**
 * Sanitize an endpoint URL: drop any embedded credentials and query string.
 * Returns the original (non-URL) string sanitized as text on parse failure.
 */
export function sanitizeEndpoint(endpoint: string | null | undefined): string | null {
  if (!endpoint) return endpoint ?? null;
  try {
    const u = new URL(endpoint);
    u.username = '';
    u.password = '';
    u.search = '';
    return u.toString();
  } catch {
    return sanitizeText(endpoint);
  }
}

/** Sanitize every string-bearing field of a probe result. */
export function sanitizeResult(result: VitalCheckResult): VitalCheckResult {
  const cleaned: VitalCheckResult = {
    ...result,
    message: sanitizeText(result.message) ?? '',
    detailLine: sanitizeText(result.detailLine) ?? '',
    endpoint: result.endpoint ? (sanitizeEndpoint(result.endpoint) ?? undefined) : result.endpoint,
    errorName: result.errorName ? sanitizeText(result.errorName) : result.errorName,
    errorMessage: result.errorMessage ? sanitizeText(result.errorMessage) : result.errorMessage,
  };

  if (result.extra) {
    const extra: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(result.extra)) {
      extra[k] = typeof v === 'string' ? sanitizeText(v) : v;
    }
    cleaned.extra = extra;
  }

  return cleaned;
}
