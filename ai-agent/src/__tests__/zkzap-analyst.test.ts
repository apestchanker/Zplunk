// =============================================================================
// ZKSplunk ai-agent — zkZap analyst tests
// =============================================================================
// Uses lightweight fakes for the MCP / REST / LLM clients so we test the
// analyst's classification, evidence contract, and fallback logic in isolation.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { ZkZapAnalyst, QUERIES } from '../zkzap-analyst';
import type { SplunkMcpClient } from '../splunk-mcp-client';
import type { SplunkRestClient } from '../splunk-rest-client';
import type { LlmClient } from '../llm-client';

type Rows = Record<string, any>[];

function fakeMcp(opts: { configured?: boolean; available?: boolean } = {}): SplunkMcpClient {
  return {
    configured: opts.configured ?? false,
    available: async () => opts.available ?? false,
    search: async () => [],
  } as unknown as SplunkMcpClient;
}

function fakeRest(opts: {
  ok?: boolean;
  byQuery?: Partial<Record<keyof typeof QUERIES, Rows>>;
}): SplunkRestClient {
  return {
    ping: async () => ({ ok: opts.ok ?? true, message: opts.ok ? 'reachable' : 'down' }),
    search: async (spl: string) => {
      const name = (Object.keys(QUERIES) as (keyof typeof QUERIES)[]).find((k) => QUERIES[k] === spl);
      return (name && opts.byQuery?.[name]) || [];
    },
  } as unknown as SplunkRestClient;
}

function fakeLlm(opts: { available?: boolean; reply?: string | null } = {}): LlmClient {
  return {
    available: opts.available ?? false,
    complete: async () => opts.reply ?? null,
  } as unknown as LlmClient;
}

const SECTIONS = [
  'Classification',
  'Evidence',
  'Time window',
  'Confidence',
  'Impact',
  'Recommended action',
  'Privacy boundary',
];

function hasAllSections(md: string): boolean {
  return SECTIONS.every((s) => new RegExp(s, 'i').test(md));
}

describe('classification', () => {
  it('healthy when all components are healthy and nothing alertable', async () => {
    const rest = fakeRest({
      ok: true,
      byQuery: {
        currentHealth: [
          { component: 'proof-server', status: 'healthy', response_time_ms: 40 },
          { component: 'indexer', status: 'healthy', response_time_ms: 80 },
          { component: 'node', status: 'healthy', response_time_ms: 12 },
        ],
        connectorHealth: [{ total_events_failed: 0, queued_events: 0, seconds_since_heartbeat: 5 }],
      },
    });
    const a = new ZkZapAnalyst(fakeMcp(), rest, fakeLlm());
    const ans = await a.ask('healthy now?');
    expect(ans.classification).toBe('healthy');
    expect(ans.evidenceSource).toBe('rest');
  });

  it('degraded when a component is in warning', async () => {
    const rest = fakeRest({
      ok: true,
      byQuery: {
        currentHealth: [
          { component: 'proof-server', status: 'warning', response_time_ms: 2200 },
          { component: 'indexer', status: 'healthy' },
        ],
      },
    });
    const ans = await new ZkZapAnalyst(fakeMcp(), rest, fakeLlm()).ask('status?');
    expect(ans.classification).toBe('degraded');
  });

  it('critical when a component is critical', async () => {
    const rest = fakeRest({
      ok: true,
      byQuery: { currentHealth: [{ component: 'indexer', status: 'critical' }] },
    });
    const ans = await new ZkZapAnalyst(fakeMcp(), rest, fakeLlm()).ask('status?');
    expect(ans.classification).toBe('critical');
  });

  it('healthy when only historical recentAlertable rows exist but current state is ok', async () => {
    const rest = fakeRest({
      ok: true,
      byQuery: {
        currentHealth: [
          { component: 'proof-server', status: 'healthy' },
          { component: 'indexer', status: 'healthy' },
          { component: 'node', status: 'healthy' },
          { component: 'wallet', status: 'tracked' },
          { component: 'connector', severity: 'info' },
        ],
        recentAlertable: [{ component: 'proof-server', status: 'critical', message: 'blip' }],
        connectorHealth: [{ total_events_failed: 0, queued_events: 0, seconds_since_heartbeat: 5 }],
      },
    });
    const ans = await new ZkZapAnalyst(fakeMcp(), rest, fakeLlm()).ask('status?');
    // Current state is healthy — a recovered blip is not a current outage.
    expect(ans.classification).toBe('healthy');
    expect(ans.markdown).toMatch(/No alert rule conditions are currently true/);
    // ...but the recovered critical must still be surfaced as a transient event,
    // never silently dropped just because current health deduped it away.
    expect(ans.markdown).toMatch(/proof-server had 1 critical event/i);
    expect(ans.markdown).toMatch(/recovered/i);
  });

  it('"what happened?" reports a recovered critical event even when current state is healthy', async () => {
    // Reproduces the field report: proof-server spiked CRITICAL and recovered to
    // healthy (7ms). currentHealth is deduped to the latest row, so only
    // recentAlertable preserves the event. The "changed" intent must report it.
    const rest = fakeRest({
      ok: true,
      byQuery: {
        currentHealth: [
          { component: 'proof-server', status: 'healthy', response_time_ms: 7 },
          { component: 'indexer', status: 'healthy', response_time_ms: 702 },
          { component: 'node', status: 'healthy', response_time_ms: 904 },
        ],
        recentAlertable: [
          { component: 'proof-server', status: 'critical', response_time_ms: 9000, message: 'Proof server timeout' },
        ],
        connectorHealth: [{ total_events_sent: 66, total_events_failed: 0, failed_events_since_last_heartbeat: 0, queued_events: 0, seconds_since_heartbeat: 22 }],
      },
    });
    const ans = await new ZkZapAnalyst(fakeMcp(), rest, fakeLlm()).ask('What happened in the last 10 minutes?');
    expect(ans.markdown).toMatch(/events did occur in the window/i);
    expect(ans.markdown).toMatch(/proof-server had 1 critical event/i);
    // The old buggy phrasing must be gone.
    expect(ans.markdown).not.toMatch(/No critical\/warning changes in the last 15 minutes/);
  });

  it('critical when the connector reports failed events', async () => {
    const rest = fakeRest({
      ok: true,
      byQuery: {
        currentHealth: [{ component: 'proof-server', status: 'healthy' }],
        connectorHealth: [{ total_events_failed: 4, failed_events_since_last_heartbeat: 4, queued_events: 0 }],
      },
    });
    const ans = await new ZkZapAnalyst(fakeMcp(), rest, fakeLlm()).ask('status?');
    expect(ans.classification).toBe('critical');
  });

  it('does not treat historical connector failures as an active critical condition', async () => {
    const rest = fakeRest({
      ok: true,
      byQuery: {
        currentHealth: [{ component: 'proof-server', status: 'healthy' }],
        connectorHealth: [{ total_events_failed: 4, failed_events_since_last_heartbeat: 0, queued_events: 0 }],
      },
    });
    const ans = await new ZkZapAnalyst(fakeMcp(), rest, fakeLlm()).ask('status?');
    expect(ans.classification).toBe('healthy');
  });

  it('unknown when Splunk is unreachable and there is no evidence', async () => {
    const rest = fakeRest({ ok: false, byQuery: {} });
    const ans = await new ZkZapAnalyst(fakeMcp(), rest, fakeLlm()).ask('status?');
    expect(ans.classification).toBe('unknown');
  });
});

describe('evidence contract', () => {
  it('always includes all seven labelled sections + privacy boundary', async () => {
    const rest = fakeRest({ ok: true, byQuery: { currentHealth: [{ component: 'node', status: 'healthy' }] } });
    const ans = await new ZkZapAnalyst(fakeMcp(), rest, fakeLlm()).ask('what is up?');
    expect(hasAllSections(ans.markdown)).toBe(true);
    expect(ans.markdown).toMatch(/does not observe private Midnight state/i);
  });

  it('keeps the contract even in the unknown / no-Splunk case', async () => {
    const rest = fakeRest({ ok: false, byQuery: {} });
    const ans = await new ZkZapAnalyst(fakeMcp(), rest, fakeLlm()).ask('what is up?');
    expect(hasAllSections(ans.markdown)).toBe(true);
  });

  it('tailors the recommendation to the degraded component', async () => {
    const rest = fakeRest({
      ok: true,
      byQuery: { currentHealth: [{ component: 'proof-server', status: 'critical' }] },
    });
    const ans = await new ZkZapAnalyst(fakeMcp(), rest, fakeLlm()).ask('what should I do?');
    expect(ans.markdown).toMatch(/proof server/i);
    expect(ans.markdown).toMatch(/6300/);
  });
});

describe('evidence source selection', () => {
  it('uses MCP when configured and available', async () => {
    const mcp = fakeMcp({ configured: true, available: true });
    const ans = await new ZkZapAnalyst(mcp, fakeRest({ ok: true, byQuery: {} }), fakeLlm()).ask('q');
    expect(ans.evidenceSource).toBe('mcp');
  });

  it('falls back to REST when MCP is configured but unavailable', async () => {
    const mcp = fakeMcp({ configured: true, available: false });
    const ans = await new ZkZapAnalyst(mcp, fakeRest({ ok: true, byQuery: {} }), fakeLlm()).ask('q');
    expect(ans.evidenceSource).toBe('rest');
  });
});

describe('intent-aware answers (different questions → different leads)', () => {
  it('"Did any alert rule condition become true?" → Yes + named alerts when components are critical', async () => {
    const rest = fakeRest({
      ok: true,
      byQuery: {
        currentHealth: [
          { component: 'indexer', status: 'critical' },
          { component: 'node', status: 'critical' },
          { component: 'proof-server', status: 'healthy', response_time_ms: 7 },
        ],
      },
    });
    const ans = await new ZkZapAnalyst(fakeMcp(), rest, fakeLlm()).ask('Did any alert rule condition become true?');
    expect(ans.markdown).toMatch(/\*\*Answer:\*\*\s*\*\*Yes\*\*/);
    expect(ans.markdown).toMatch(/Indexer Outage/);
    expect(ans.markdown).toMatch(/Node Outage/);
  });

  it('alert question → No when everything is healthy', async () => {
    const rest = fakeRest({
      ok: true,
      byQuery: {
        currentHealth: [{ component: 'proof-server', status: 'healthy' }, { component: 'indexer', status: 'healthy' }],
        connectorHealth: [{ total_events_failed: 0, queued_events: 0, seconds_since_heartbeat: 5 }],
      },
    });
    const ans = await new ZkZapAnalyst(fakeMcp(), rest, fakeLlm()).ask('did any alert fire?');
    expect(ans.markdown).toMatch(/\*\*No\*\* alert rule conditions/i);
  });

  it('"which component is most degraded and why?" → degraded lead names the component', async () => {
    const rest = fakeRest({ ok: true, byQuery: { currentHealth: [{ component: 'indexer', status: 'critical' }, { component: 'proof-server', status: 'healthy' }] } });
    const ans = await new ZkZapAnalyst(fakeMcp(), rest, fakeLlm()).ask('which component is most degraded and why?');
    expect(ans.markdown).toMatch(/Most degraded:\s*\*\*indexer\*\*/);
  });

  it('a wallet question makes the privacy boundary explicit (no balance observable)', async () => {
    const rest = fakeRest({
      ok: true,
      byQuery: {
        currentHealth: [
          { component: 'proof-server', status: 'healthy' },
          { component: 'wallet', status: 'unknown', message: 'Tracking wallet mn_addr_preview1… on preview. Balance is shielded (private by design); ZKSplunk does not read it.' },
        ],
      },
    });
    const ans = await new ZkZapAnalyst(fakeMcp(), rest, fakeLlm()).ask('can you see the wallet balance?');
    expect(ans.markdown).toMatch(/not observable/i);
    expect(ans.markdown).toMatch(/shielded/i);
    expect(ans.markdown).toMatch(/viewing key/i);
  });

  it('a multi-topic question ("block height AND latency") carries block height even though "latency" routes to the degraded intent', async () => {
    const rest = fakeRest({
      ok: true,
      byQuery: {
        currentHealth: [{ component: 'proof-server', status: 'healthy', response_time_ms: 6 }],
        latestBlock: [{ block_height: '1131754', block_age_seconds: '27' }],
      },
    });
    const ans = await new ZkZapAnalyst(fakeMcp(), rest, fakeLlm()).ask('What is the latest block height and the proof-server latency?');
    // Block height is baseline evidence now, available regardless of intent.
    expect(ans.markdown).toMatch(/Latest block height:\s*1131754/);
    expect(ans.markdown).toMatch(/\b6ms\b/);
  });

  it('a healthy-status question leads with an all-healthy statement', async () => {
    const rest = fakeRest({ ok: true, byQuery: { currentHealth: [{ component: 'proof-server', status: 'healthy' }, { component: 'indexer', status: 'healthy' }] } });
    const ans = await new ZkZapAnalyst(fakeMcp(), rest, fakeLlm()).ask('are the proof server and indexer healthy right now?');
    expect(ans.markdown).toMatch(/All monitored components are healthy/);
  });
});

describe('robustness: multivalue + connector coalesce', () => {
  it('collapses multivalue fields (no "critical,critical,critical" in output)', async () => {
    const rest = fakeRest({
      ok: true,
      byQuery: {
        currentHealth: [
          { component: ['indexer', 'indexer', 'indexer'], status: ['critical', 'critical', 'critical'], response_time_ms: ['5', '5'] },
        ],
      },
    });
    const ans = await new ZkZapAnalyst(fakeMcp(), rest, fakeLlm()).ask('status?');
    expect(ans.markdown).not.toMatch(/critical,critical/);
    expect(ans.markdown).not.toMatch(/indexer,indexer/);
    expect(ans.markdown).toMatch(/`indexer`: \*\*critical\*\*/);
  });

  it('shows and normalizes connector severity instead of "undefined" when it has no status field', async () => {
    const rest = fakeRest({
      ok: true,
      byQuery: {
        currentHealth: [
          { component: 'proof-server', status: 'healthy' },
          { component: 'connector', severity: 'warn' }, // heartbeat events carry severity, not status
        ],
      },
    });
    const ans = await new ZkZapAnalyst(fakeMcp(), rest, fakeLlm()).ask('status?');
    expect(ans.markdown).not.toMatch(/undefined/);
    expect(ans.classification).toBe('degraded');
    expect(ans.markdown).toMatch(/`connector`: \*\*warning\*\*/);
  });
});

describe('LLM phrasing', () => {
  const rest = () => fakeRest({ ok: true, byQuery: { currentHealth: [{ component: 'node', status: 'healthy' }] } });

  it('uses deterministic markdown when no LLM is available', async () => {
    const ans = await new ZkZapAnalyst(fakeMcp(), rest(), fakeLlm({ available: false })).ask('q');
    expect(ans.phrasedByLlm).toBe(false);
  });

  it('uses the LLM answer verbatim when one is returned (general-assistant mode)', async () => {
    const reply = 'The proof server briefly blipped critical and has recovered — now ~7ms. Nothing else changed.';
    const ans = await new ZkZapAnalyst(fakeMcp(), rest(), fakeLlm({ available: true, reply })).ask('q');
    expect(ans.phrasedByLlm).toBe(true);
    expect(ans.markdown).toBe(reply);
  });

  it('falls back to the deterministic grounded answer when the LLM returns nothing', async () => {
    const ans = await new ZkZapAnalyst(fakeMcp(), rest(), fakeLlm({ available: true, reply: null })).ask('q');
    expect(ans.phrasedByLlm).toBe(false);
    expect(ans.markdown).toMatch(/Privacy boundary/i); // deterministic fallback kept
  });

  it('answers a conceptual question without gathering Splunk evidence', async () => {
    let searched = false;
    const tracking = {
      ping: async () => ({ ok: true, message: 'reachable' }),
      search: async () => { searched = true; return []; },
    } as unknown as SplunkRestClient;
    const reply = 'A nullifier is a one-time value that marks a note as spent without revealing which note it was.';
    const ans = await new ZkZapAnalyst(fakeMcp(), tracking, fakeLlm({ available: true, reply })).ask('what does a nullifier do?');
    expect(ans.phrasedByLlm).toBe(true);
    expect(ans.evidenceSource).toBe('none');
    expect(searched).toBe(false); // no live queries for a purely conceptual question
  });
});
