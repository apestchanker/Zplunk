// =============================================================================
// ZKSplunk — Sanitizer tests
// =============================================================================

import { describe, it, expect } from 'vitest';
import { sanitizeText, sanitizeEndpoint, sanitizeResult } from '../sanitize';
import type { VitalCheckResult } from '../../../vitals/types';

describe('sanitizeText', () => {
  it('returns null/undefined unchanged', () => {
    expect(sanitizeText(null)).toBeNull();
    expect(sanitizeText(undefined)).toBeNull();
  });

  it('redacts token/secret/password key=value pairs', () => {
    expect(sanitizeText('token=abc123secret')).toBe('token=***');
    expect(sanitizeText('password: hunter2')).toBe('password=***');
    expect(sanitizeText('api_key=XYZ apikey=ABC')).toBe('api_key=*** apikey=***');
  });

  it('redacts bare Splunk / Bearer auth values (token never survives)', () => {
    expect(sanitizeText('Authorization: Splunk 1a2b3c4d5e6f')).not.toContain('1a2b3c4d5e6f');
    expect(sanitizeText('Bearer abcdef123456')).toBe('Bearer ***');
    expect(sanitizeText('bearer abcdef123456 rejected')).toBe('bearer *** rejected');
  });

  it('leaves clean text untouched', () => {
    expect(sanitizeText('Proof server healthy (42ms).')).toBe('Proof server healthy (42ms).');
  });
});

describe('sanitizeEndpoint', () => {
  it('strips embedded credentials', () => {
    expect(sanitizeEndpoint('https://user:pass@host:8090/path')).toBe('https://host:8090/path');
  });

  it('strips the query string (may carry secrets)', () => {
    expect(sanitizeEndpoint('http://localhost:6300/health?token=abc')).toBe(
      'http://localhost:6300/health',
    );
  });

  it('passes through clean URLs', () => {
    expect(sanitizeEndpoint('http://localhost:8088/api/v4/graphql')).toBe(
      'http://localhost:8088/api/v4/graphql',
    );
  });

  it('falls back to text sanitization for non-URLs', () => {
    expect(sanitizeEndpoint('not a url token=secret')).toBe('not a url token=***');
  });

  it('handles null/undefined', () => {
    expect(sanitizeEndpoint(null)).toBeNull();
    expect(sanitizeEndpoint(undefined)).toBeNull();
  });
});

describe('sanitizeResult', () => {
  it('scrubs message, detailLine, endpoint, error fields, and string extras', () => {
    const dirty: VitalCheckResult = {
      status: 'critical',
      message: 'failed with token=leak',
      detailLine: 'auth=leak',
      responseTimeMs: null,
      endpoint: 'https://u:p@host:8090/x?token=abc',
      errorName: 'Error',
      errorMessage: 'bearer abcdef123456 rejected',
      extra: { note: 'apikey=zzz', count: 3, flag: true, nothing: null },
    };
    const clean = sanitizeResult(dirty);
    expect(clean.message).toBe('failed with token=***');
    expect(clean.detailLine).toBe('auth=***');
    expect(clean.endpoint).toBe('https://host:8090/x');
    expect(clean.errorMessage).toContain('bearer ***');
    expect(clean.extra).toEqual({ note: 'apikey=***', count: 3, flag: true, nothing: null });
  });

  it('preserves non-string fields and does not invent endpoint', () => {
    const r: VitalCheckResult = {
      status: 'healthy',
      message: 'ok',
      detailLine: '200 · 10ms',
      responseTimeMs: 10,
    };
    const clean = sanitizeResult(r);
    expect(clean.endpoint).toBeUndefined();
    expect(clean.responseTimeMs).toBe(10);
    expect(clean.status).toBe('healthy');
  });
});
