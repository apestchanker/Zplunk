// =============================================================================
// ZKSplunk ai-agent — zkZap analyst
// =============================================================================
// Answers operational questions strictly from Splunk evidence. Evidence comes
// from the Splunk MCP Server when configured, otherwise the Splunk REST API.
// Every answer follows the Required Evidence Contract from the spec:
//   Classification · Evidence · Time window · Confidence · Impact ·
//   Recommended action · Privacy boundary.
//
// The analyst NEVER claims visibility into private Midnight state, witness
// arguments, shielded parties, or shielded amounts.
// =============================================================================

import type { SplunkMcpClient } from './splunk-mcp-client';
import type { SplunkRestClient } from './splunk-rest-client';
import type { AssistantPhraser } from './splunk-ai-toolkit-client';

// --- Predefined query library (verbatim intent from the spec) ----------------

export const QUERIES = {
  currentHealth: `index=zksplunk (sourcetype="midnight:vitals" OR sourcetype="zksplunk:connector") earliest=-10m
| sort 0 -_time
| dedup component
| table _time component status severity response_time_ms message`,

  proofTrend: `index=zksplunk sourcetype="midnight:vitals" component="proof-server" type="midnight.vital.check" earliest=-30m
| timechart span=1m avg(response_time_ms) as avg_latency_ms perc95(response_time_ms) as p95_latency_ms count(eval(status="critical")) as critical_count`,

  indexerTrend: `index=zksplunk sourcetype="midnight:vitals" component="indexer" type="midnight.vital.check" earliest=-30m
| timechart span=1m avg(response_time_ms) as avg_latency_ms perc95(response_time_ms) as p95_latency_ms count(eval(status="critical")) as critical_count`,

  recentAlertable: `index=zksplunk earliest=-15m
| eval failed_events_since_last_heartbeat=coalesce(failed_events_since_last_heartbeat,0)
| where status="critical" OR severity="critical" OR failed_events_since_last_heartbeat>0 OR queued_events>0
| table _time sourcetype type component status severity response_time_ms message total_events_failed failed_events_since_last_heartbeat queued_events
| sort -_time`,

  connectorHealth: `index=zksplunk sourcetype="zksplunk:connector" type="zksplunk.connector.status" earliest=-15m
| stats latest(_time) as last_seen latest(total_events_sent) as total_events_sent latest(total_events_failed) as total_events_failed latest(failed_events_since_last_heartbeat) as failed_events_since_last_heartbeat latest(queued_events) as queued_events latest(average_latency_ms) as average_latency_ms
| eval seconds_since_heartbeat=now()-last_seen`,

  blockCadence: `index=zksplunk sourcetype="midnight:chain" type="midnight.chain.block_latest" earliest=-30m
| sort 0 _time
| streamstats current=f last(block_height) as prev_height last(_time) as prev_time
| eval height_delta=block_height-prev_height
| eval seconds_delta=_time-prev_time
| table _time block_height height_delta seconds_delta block_age_seconds`,

  // Lightweight "latest block" — gathered for EVERY question so block height is
  // always available, not just for block-focused intents.
  latestBlock: `index=zksplunk sourcetype="midnight:chain" type="midnight.chain.block_latest" earliest=-30m
| sort 0 -_time
| head 1
| table _time block_height block_age_seconds protocol_version`,
} as const;

export type QueryName = keyof typeof QUERIES;

const PRIVACY_BOUNDARY =
  'Privacy boundary: classified from public infrastructure metadata and volumes only. ' +
  'ZKSplunk does not observe private Midnight state, witness arguments, shielded parties, or shielded amounts.';

// General-assistant policy: answer ANY question naturally, but treat Splunk
// evidence (when supplied) as the only authority on live infrastructure status.
const ASSISTANT_POLICY = `You are zkZap, the assistant for ZKSplunk — a privacy-preserving monitor for Midnight Network infrastructure.
Be a genuinely helpful, conversational assistant. Answer the user's ACTUAL question directly: status questions, conceptual/how-to questions, and casual ones alike. Match the user's tone and length; do not pad answers with boilerplate or fixed section headers unless they ask for a formal report.

GROUNDING: When a "Live Splunk evidence" block is included in the user message, it is the ONLY source of truth for current infrastructure status. Base every status, health, latency, or count claim strictly on it. Never invent components, metrics, or numbers that are not in it. If the evidence is missing or insufficient to answer a status question, say so plainly instead of guessing. If no evidence block is present, the question was judged not to be about live status — answer it from general knowledge and do not fabricate live readings.

PRIVACY (never violate): ZKSplunk observes only PUBLIC infrastructure metadata and volumes. Never claim to see private Midnight state, witness values, shielded parties, or shielded amounts. For wallet questions, note that shielded balances are private by design; only public unshielded activity (tx counts, UTXOs, unshielded balances) is observable.

When it fits, you can lean on the framing: "Metadata and volumes are public. Contents are private. ZKSplunk observes."`;

interface Evidence {
  source: 'mcp' | 'rest' | 'none';
  splunkReachable: boolean;
  reachabilityNote: string;
  currentHealth: Record<string, any>[];
  recentAlertable: Record<string, any>[];
  connectorHealth: Record<string, any>[];
  latestBlock: Record<string, any>[];
  focusName: QueryName | null;
  focus: Record<string, any>[];
  ranQueries: string[];
}

/** What the operator is actually asking about. */
type Intent =
  | 'alerts' | 'changed' | 'degraded'
  | 'proof' | 'indexer' | 'node' | 'block' | 'connector' | 'wallet' | 'contracts'
  | 'healthy';

/** Collapse a Splunk multivalue field (JS array, or "x,x,x") to one value. */
function sv(x: any): any {
  if (Array.isArray(x)) return x.length ? x[0] : null;
  if (typeof x === 'string' && x.includes(',')) {
    const parts = x.split(',');
    if (parts.every((p) => p === parts[0])) return parts[0];
  }
  return x;
}

function normalizeStatus(x: any): string {
  const s = String(x ?? 'unknown').toLowerCase();
  if (s === 'warn') return 'warning';
  if (s === 'error') return 'critical';
  return s;
}

const COMPONENT_WORDS: Array<[RegExp, Intent]> = [
  [/proof[\s-]?server|prover|\bproof\b/, 'proof'],
  [/indexer|graphql/, 'indexer'],
  [/\bnode\b/, 'node'],
  [/block|height|cadence|sync/, 'block'],
  [/connector|heartbeat|\bhec\b|delivery/, 'connector'],
  [/wallet/, 'wallet'],
  [/contract/, 'contracts'],
];

/** Classify the question into an intent. Clear intents win over component words. */
function detectIntent(q: string): Intent {
  const s = q.toLowerCase();
  if (/\balert|rule|condition|triggered|fir(e|ed|ing)|breach/.test(s)) return 'alerts';
  if (/chang|happen|recent|\bnew\b|last\s*\d*\s*min|past\s*\d*\s*min|over the last/.test(s)) return 'changed';
  if (/degrad|worst|most|why|slow|latency|problem|wrong|issue|fail|down|broken/.test(s)) return 'degraded';
  // Single explicit component focus (only when exactly one is mentioned).
  const hits = COMPONENT_WORDS.filter(([re]) => re.test(s)).map(([, i]) => i);
  if (hits.length === 1) return hits[0];
  return 'healthy';
}

/**
 * Is this a purely conceptual/educational question (answerable from general
 * knowledge, not live telemetry)? Conservative on purpose: we only skip
 * evidence gathering when the question both *asks for an explanation* and names
 * a Midnight/crypto concept, AND carries no live-status signal. Anything
 * ambiguous ("what's up?", "what should I do?") still gathers evidence so the
 * answer stays grounded.
 */
const CONCEPT_NOUNS =
  /\b(nullifier|zero[-\s]?knowledge|zk[-\s]?(proof|snark|circuit)?|commitment|merkle|compact|witness|shielded|unshielded|zswap|kachina|tokenomics|\bdust\b|night token|circuit|ledger|midnight (network|protocol|address)|what is midnight|how does midnight)\b/;
const EXPLAIN_VERBS = /\b(what|why|how|explain|define|meaning|difference|tell me about|works?|do(es)?)\b/;
const STATUS_SIGNALS =
  /\b(health|healthy|status|up|down|alive|reachable|latency|slow|error|fail|outage|degrad|alert|right now|currently|last\s*\d*\s*min|past\s*\d*\s*min|happen|wallet|balance|utxo|\btx\b|transaction|block|height|sync|heartbeat|queue)\b/;

function isConceptual(q: string): boolean {
  const s = q.toLowerCase();
  if (STATUS_SIGNALS.test(s)) return false;
  return CONCEPT_NOUNS.test(s) && EXPLAIN_VERBS.test(s);
}

/** Alert rule names that map to derivable conditions, per the Splunk app. */
const COMPONENT_OUTAGE: Record<string, string> = {
  'proof-server': 'ZKSplunk - Proof Server Outage',
  indexer: 'ZKSplunk - Indexer Outage',
  node: 'ZKSplunk - Node Outage',
};

export interface AnalystAnswer {
  markdown: string;
  classification: 'healthy' | 'degraded' | 'critical' | 'unknown';
  evidenceSource: 'mcp' | 'rest' | 'none';
  phrasedByLlm: boolean;
}

export class ZkZapAnalyst {
  constructor(
    private readonly mcp: SplunkMcpClient,
    private readonly rest: SplunkRestClient,
    private readonly llm: AssistantPhraser,
  ) {}

  /** Run a single named query through MCP (preferred) then REST. */
  private async run(name: QueryName, earliest = '-15m'): Promise<Record<string, any>[]> {
    const spl = QUERIES[name];
    if (this.mcp.configured) {
      try {
        if (await this.mcp.available()) return await this.mcp.search(spl, earliest);
      } catch {
        /* fall through to REST */
      }
    }
    return this.rest.search(spl, earliest);
  }

  /** Pick an extra "focus" query to enrich a component/block-specific answer. */
  private focusQueryFor(intent: Intent): QueryName | null {
    switch (intent) {
      case 'proof': return 'proofTrend';
      case 'indexer': return 'indexerTrend';
      case 'block': return 'blockCadence';
      default: return null;
    }
  }

  private async gather(intent: Intent): Promise<Evidence> {
    const usingMcp = this.mcp.configured && (await this.mcp.available().catch(() => false));
    const source: Evidence['source'] = usingMcp ? 'mcp' : 'rest';
    const ranQueries: string[] = [];
    const ping = await this.rest.ping().catch((e) => ({ ok: false, message: (e as Error).message }));

    const safe = async (name: QueryName): Promise<Record<string, any>[]> => {
      try {
        const rows = await this.run(name, '-15m');
        ranQueries.push(name);
        return rows;
      } catch {
        return [];
      }
    };

    const focusName = this.focusQueryFor(intent);
    // Don't double-fetch the chain block when the focus is already block cadence.
    const wantLatestBlock = focusName !== 'blockCadence';
    const [currentHealth, recentAlertable, connectorHealth, latestBlock, focus] = await Promise.all([
      safe('currentHealth'),
      safe('recentAlertable'),
      safe('connectorHealth'),
      wantLatestBlock ? safe('latestBlock') : Promise.resolve([] as Record<string, any>[]),
      focusName ? safe(focusName) : Promise.resolve([] as Record<string, any>[]),
    ]);

    return {
      source,
      splunkReachable: ping.ok,
      reachabilityNote: ping.message,
      currentHealth,
      recentAlertable,
      connectorHealth,
      latestBlock,
      focusName,
      focus,
      ranQueries,
    };
  }

  /** Latest block height (and age) from baseline or block-focus evidence, or null. */
  private latestBlockInfo(ev: Evidence): { height: string; ageSeconds: any } | null {
    const row = ev.latestBlock[0]
      ?? (ev.focusName === 'blockCadence' ? ev.focus[ev.focus.length - 1] : undefined);
    const height = row ? sv(row.block_height) : null;
    if (height == null || height === '') return null;
    return { height: String(height), ageSeconds: row ? sv(row.block_age_seconds) : null };
  }

  /** Normalised {component -> {status, severity, response_time_ms, message}}. */
  private healthByComponent(ev: Evidence): Map<string, { status: string; severity: string; rt: any; message: string }> {
    const m = new Map<string, { status: string; severity: string; rt: any; message: string }>();
    for (const r of ev.currentHealth) {
      const comp = String(sv(r.component) ?? '');
      if (!comp) continue;
      const status = normalizeStatus(sv(r.status) ?? sv(r.severity) ?? 'unknown');
      m.set(comp, { status, severity: String(sv(r.severity) ?? ''), rt: sv(r.response_time_ms), message: String(sv(r.message) ?? '') });
    }
    return m;
  }

  /**
   * Transient critical/warning events that occurred in the window, grouped by
   * component. `currentHealth` is deduped to the latest row per component, so a
   * component that spiked critical and recovered shows as healthy there — this
   * is the only place those recovered-but-real events survive. Essential for
   * "what happened?" questions; without it the analyst reports "no changes"
   * when a component blipped critical and recovered inside the window.
   */
  private recentTransients(
    ev: Evidence,
  ): Map<string, { count: number; worst: 'warning' | 'critical' }> {
    const byComp = new Map<string, { count: number; worst: 'warning' | 'critical' }>();
    for (const r of ev.recentAlertable) {
      const comp = String(sv(r.component) ?? '');
      if (!comp) continue;
      const status = normalizeStatus(sv(r.status) ?? sv(r.severity));
      if (status !== 'critical' && status !== 'warning') continue;
      const cur = byComp.get(comp) ?? { count: 0, worst: 'warning' as const };
      cur.count += 1;
      if (status === 'critical') cur.worst = 'critical';
      byComp.set(comp, cur);
    }
    return byComp;
  }

  /** One-line operator summary of recovered/ongoing transient events, or ''. */
  private transientSummary(ev: Evidence): string {
    const events = this.recentTransients(ev);
    if (!events.size) return '';
    const health = this.healthByComponent(ev);
    const parts: string[] = [];
    for (const [comp, info] of events) {
      const now = health.get(comp)?.status ?? 'unknown';
      const tail = now === 'healthy' ? 'since recovered, now healthy' : `now ${now}`;
      parts.push(`${comp} had ${info.count} ${info.worst} event(s) (${tail})`);
    }
    return parts.join('; ') + '.';
  }

  /** Alert rule conditions currently true, derived from the evidence. */
  private deriveActiveAlerts(ev: Evidence): string[] {
    const alerts: string[] = [];
    const health = this.healthByComponent(ev);
    for (const [comp, h] of health) {
      if (h.status === 'critical' && COMPONENT_OUTAGE[comp]) alerts.push(COMPONENT_OUTAGE[comp]);
    }
    const c = ev.connectorHealth[0];
    if (c) {
      if (Number(sv(c.failed_events_since_last_heartbeat)) > 0) alerts.push('ZKSplunk - HEC Delivery Failures');
      if (Number(sv(c.seconds_since_heartbeat)) > 120) alerts.push('ZKSplunk - Connector Silence');
    }
    if (ev.recentAlertable.some((r) => /block/i.test(String(sv(r.message) ?? '')))) {
      alerts.push('ZKSplunk - Block Height Stalled');
    }
    return [...new Set(alerts)];
  }

  private classify(ev: Evidence): AnalystAnswer['classification'] {
    if (!ev.splunkReachable && ev.currentHealth.length === 0) return 'unknown';
    const statuses = [...this.healthByComponent(ev).values()].map((h) => h.status);
    const anyCritical =
      statuses.includes('critical') ||
      this.deriveActiveAlerts(ev).length > 0 ||
      ev.connectorHealth.some((c) => Number(sv(c.failed_events_since_last_heartbeat)) > 0);
    if (anyCritical) return 'critical';
    if (statuses.includes('warning')) return 'degraded';
    if (statuses.length === 0) return 'unknown';
    return 'healthy';
  }

  /** A direct one-paragraph answer to the operator's actual question. */
  private answerLead(intent: Intent, ev: Evidence, cls: AnalystAnswer['classification'], activeAlerts: string[]): string {
    if (!ev.splunkReachable && ev.currentHealth.length === 0) {
      return 'I cannot answer right now — Splunk returned no evidence (REST unreachable or the agent is not sending data).';
    }
    const health = this.healthByComponent(ev);
    const critical = [...health].filter(([, h]) => h.status === 'critical').map(([c]) => c);
    const warning = [...health].filter(([, h]) => h.status === 'warning').map(([c]) => c);
    const fmt = (c: string) => {
      const h = health.get(c);
      return h ? `${c} is **${h.status}**${h.rt != null && h.rt !== '-' ? ` (${h.rt}ms)` : ''}` : `${c} (no data)`;
    };

    switch (intent) {
      case 'alerts':
        return activeAlerts.length
          ? `**Yes** — ${activeAlerts.length} alert condition(s) are currently true: ${activeAlerts.join(', ')}.`
          : '**No** alert rule conditions are currently true in the last 15 minutes.';
      case 'changed': {
        const transient = this.transientSummary(ev);
        if (critical.length || warning.length) {
          return `In the last 15 minutes the degraded components are: ${[...critical.map((c) => c + ' (critical)'), ...warning.map((c) => c + ' (warning)')].join(', ')}. Healthy: ${[...health].filter(([, h]) => h.status === 'healthy').map(([c]) => c).join(', ') || 'none'}.${transient ? ` Earlier in the window: ${transient}` : ''}`;
        }
        return transient
          ? `Current state is steady, but events did occur in the window: ${transient} All components have since returned to their current state shown below.`
          : 'No critical/warning changes in the last 15 minutes; all monitored components are steady.';
      }
      case 'degraded':
        return critical.length
          ? `Most degraded: **${critical.join(', ')}** (critical)${warning.length ? `, plus ${warning.join(', ')} (warning)` : ''}. ${this.recommendation(critical.concat(warning), ev)}`
          : warning.length
            ? `Degraded (warning): ${warning.join(', ')}. ${this.recommendation(warning, ev)}`
            : 'Nothing is degraded right now — all components are healthy.';
      case 'wallet': {
        const h = health.get('wallet');
        return (
          `**No — wallet balances are not observable.** Midnight wallet balances are shielded; ` +
          `the indexer only exposes them via a private viewing key, which ZKSplunk never uses. ` +
          (h?.message ? `Status: ${h.message}` : `Wallet health is ${h?.status ?? 'unknown'} (headless).`)
        );
      }
      case 'proof': case 'indexer': case 'node': case 'connector': case 'contracts': {
        const comp = intent === 'proof' ? 'proof-server' : intent;
        const focus = this.focusSummary(ev);
        return `${fmt(comp)}.${focus ? ' ' + focus : ''}`;
      }
      case 'block': {
        const focus = this.focusSummary(ev);
        return focus || 'No block/cadence data available — the indexer is not reporting blocks (indexer may be down or not deployed).';
      }
      case 'healthy':
      default:
        return critical.length
          ? `Not fully healthy: ${critical.map((c) => c + ' critical').join(', ')}${warning.length ? `; ${warning.join(', ')} warning` : ''}. Healthy: ${[...health].filter(([, h]) => h.status === 'healthy').map(([c]) => c).join(', ') || 'none'}.`
          : `All monitored components are healthy: ${[...health].filter(([, h]) => h.status === 'healthy').map(([c]) => c).join(', ')}.`;
    }
  }

  /** One-line summary of the focus query (latency trend / block cadence). */
  private focusSummary(ev: Evidence): string {
    if (!ev.focusName || !ev.focus.length) return '';
    if (ev.focusName === 'blockCadence') {
      const last = ev.focus[ev.focus.length - 1];
      const h = sv(last?.block_height);
      return h != null ? `Latest block height ${h}.` : '';
    }
    // proof/indexer trend: average the p95 column across buckets.
    const p95s = ev.focus.map((r) => Number(sv(r.p95_latency_ms))).filter((n) => !isNaN(n));
    if (!p95s.length) return '';
    const avg = Math.round(p95s.reduce((a, b) => a + b, 0) / p95s.length);
    return `p95 latency ~${avg}ms over the last 30m.`;
  }

  /** Deterministic markdown built straight from evidence (no LLM needed). */
  private renderDeterministic(question: string, intent: Intent, ev: Evidence, cls: AnalystAnswer['classification']): string {
    const window = 'last 15 minutes';
    const health = this.healthByComponent(ev);
    const activeAlerts = this.deriveActiveAlerts(ev);
    const lines: string[] = [];

    lines.push(`**Answer:** ${this.answerLead(intent, ev, cls, activeAlerts)}`);
    lines.push(`\n**Classification:** ${cls.toUpperCase()}`);

    lines.push(`\n**Evidence:**`);
    if (!ev.splunkReachable && ev.currentHealth.length === 0) {
      lines.push(`- Splunk not reachable for evidence: ${ev.reachabilityNote}`);
    } else {
      lines.push(`- Source: ${ev.source.toUpperCase()} (${ev.reachabilityNote}); queries: ${ev.ranQueries.join(', ') || 'none'}`);
      if (health.size) {
        lines.push(`- Current component health:`);
        for (const [comp, h] of health) {
          lines.push(`  - \`${comp}\`: **${h.status}**${h.rt != null && h.rt !== '-' ? ` (${h.rt}ms)` : ''}${h.message ? ` — ${h.message}` : ''}`);
        }
      } else {
        lines.push(`- No vitals in the ${window}. The connector may be down or not started.`);
      }
      if (activeAlerts.length) {
        lines.push(`- Alert conditions currently true: ${activeAlerts.join(', ')}.`);
      } else {
        lines.push(`- No alert rule conditions are currently true.`);
      }
      const transient = this.transientSummary(ev);
      if (transient) {
        lines.push(`- Transient events earlier in the window (recovered, not in current health): ${transient}`);
      }
      const block = this.latestBlockInfo(ev);
      if (block) {
        lines.push(`- Latest block height: ${block.height}${block.ageSeconds != null ? ` (block age ${block.ageSeconds}s)` : ''}.`);
      }
      const c = ev.connectorHealth[0];
      if (c) {
        lines.push(
          `- Connector: ${sv(c.total_events_sent) ?? 0} sent, ${sv(c.total_events_failed) ?? 0} failed total ` +
            `(${sv(c.failed_events_since_last_heartbeat) ?? 0} since last heartbeat), ` +
            `queue ${sv(c.queued_events) ?? 0}, ${Math.round(Number(sv(c.seconds_since_heartbeat) ?? 0))}s since heartbeat.`,
        );
      }
      const focus = this.focusSummary(ev);
      if (focus) lines.push(`- Focus (${ev.focusName}): ${focus}`);
    }

    lines.push(`\n**Time window:** ${window}.`);

    const confidence =
      !ev.splunkReachable && ev.currentHealth.length === 0
        ? 'Low (no Splunk evidence available)'
        : health.size >= 3 ? 'High' : 'Medium';
    lines.push(`\n**Confidence:** ${confidence}.`);

    const degraded = [...health].filter(([, h]) => ['critical', 'warning'].includes(h.status)).map(([c]) => c);
    lines.push(
      `\n**Impact:** ` +
        (cls === 'healthy'
          ? 'No operational impact observed; monitored Midnight infrastructure is responsive.'
          : cls === 'unknown'
            ? 'Cannot determine impact without Splunk evidence.'
            : `${degraded.join(', ') || 'one or more components'} degraded/critical, which can slow or block ZK operations (proofs, indexing, block sync).`),
    );

    lines.push(
      `\n**Recommended action:** ` +
        (cls === 'healthy'
          ? 'No action required. Keep monitoring.'
          : cls === 'unknown'
            ? 'Start/verify the ZKSplunk agent and confirm Splunk HEC + REST are reachable, then re-ask.'
            : this.recommendation(degraded, ev)),
    );

    lines.push(`\n*${PRIVACY_BOUNDARY}*`);
    return lines.join('\n');
  }

  private recommendation(degradedComponents: string[], ev: Evidence): string {
    const comps = new Set(degradedComponents);
    const tips: string[] = [];
    if (comps.has('proof-server')) tips.push('Check the proof server process/container on :6300 and its latency trend.');
    if (comps.has('indexer')) tips.push('Check the indexer GraphQL endpoint on :8088/api/v4/graphql and recent GraphQL errors.');
    if (comps.has('node')) tips.push('Verify node block production via `curl http://localhost:9944/health`.');
    if (comps.has('connector') || ev.connectorHealth.some((c) => Number(sv(c.failed_events_since_last_heartbeat)) > 0))
      tips.push('Inspect the ZKSplunk connector: HEC token, queue depth, and failed batches.');
    if (tips.length === 0) tips.push('Review the Recent Alertable Conditions panel and the affected component trend.');
    return tips.join(' ');
  }

  /** Compact, neutral fact list for the LLM — evidence without the report framing. */
  private renderEvidenceFacts(ev: Evidence, cls: AnalystAnswer['classification']): string {
    const health = this.healthByComponent(ev);
    const lines: string[] = [];
    lines.push(`Window: last 15 minutes. Source: ${ev.source}. Splunk reachable: ${ev.splunkReachable ? 'yes' : 'no'} (${ev.reachabilityNote}).`);
    lines.push(`Overall classification (current state): ${cls}.`);
    if (health.size) {
      lines.push('Current component health (latest reading per component):');
      for (const [comp, h] of health) {
        lines.push(`  - ${comp}: ${h.status}${h.rt != null && h.rt !== '-' ? ` (${h.rt}ms)` : ''}${h.message ? ` — ${h.message}` : ''}`);
      }
    } else {
      lines.push('No component vitals in the window (the connector may be down or not started).');
    }
    const transient = this.transientSummary(ev);
    if (transient) lines.push(`Transient events earlier in the window (recovered, NOT reflected in current health above): ${transient}`);
    const activeAlerts = this.deriveActiveAlerts(ev);
    lines.push(activeAlerts.length ? `Active alert conditions: ${activeAlerts.join(', ')}.` : 'No alert rule conditions are currently true.');
    const block = this.latestBlockInfo(ev);
    if (block) {
      lines.push(`Latest block height: ${block.height}${block.ageSeconds != null ? ` (block age ${block.ageSeconds}s)` : ''}.`);
    }
    const c = ev.connectorHealth[0];
    if (c) {
      lines.push(
        `Connector: ${sv(c.total_events_sent) ?? 0} sent, ${sv(c.total_events_failed) ?? 0} failed total ` +
          `(${sv(c.failed_events_since_last_heartbeat) ?? 0} since last heartbeat), queue ${sv(c.queued_events) ?? 0}, ` +
          `${Math.round(Number(sv(c.seconds_since_heartbeat) ?? 0))}s since heartbeat.`,
      );
    }
    const focus = this.focusSummary(ev);
    if (focus) lines.push(`Focus (${ev.focusName}): ${focus}`);
    return lines.join('\n');
  }

  async ask(question: string): Promise<AnalystAnswer> {
    const intent = detectIntent(question);
    // Gather live evidence by default so any infra question stays grounded;
    // skip only for clearly conceptual questions (e.g. "what is a nullifier?").
    const conceptual = isConceptual(question);
    const ev = conceptual ? null : await this.gather(intent);
    const cls = ev ? this.classify(ev) : 'unknown';

    // Deterministic, grounded fallback used whenever the LLM is unavailable.
    const deterministic = ev
      ? this.renderDeterministic(question, intent, ev, cls)
      : `I'm running in evidence-only mode (no assistant LLM configured), so I answer from live Splunk data rather than general knowledge. ` +
        `Ask me about infrastructure status — e.g. the proof server, indexer, node, connector, wallet activity, or recent blocks — and I'll pull the evidence.\n\n` +
        `*${PRIVACY_BOUNDARY}*`;

    if (!this.llm.available) {
      return { markdown: deterministic, classification: cls, evidenceSource: ev?.source ?? 'none', phrasedByLlm: false };
    }

    // General-assistant phrasing. The model answers the actual question; when
    // evidence is present it is the sole authority for status claims. Privacy is
    // enforced by ASSISTANT_POLICY, not by an output-format gate.
    const user = ev
      ? `User question: ${question}\n\n` +
        `Live Splunk evidence (the ONLY source of truth for current infrastructure status — do not invent beyond it):\n${this.renderEvidenceFacts(ev, cls)}\n\n` +
        `Answer the question directly and conversationally, grounded in this evidence. Note recovered/transient events if they're relevant to what was asked.`
      : `User question: ${question}\n\n` +
        `(This was judged to be a general/conceptual question, so no live Splunk evidence was gathered.) ` +
        `Answer helpfully from general knowledge. Do not fabricate live infrastructure readings; if live status is actually needed, say so and invite the user to ask about a specific component.`;

    const phrased = await this.llm.complete(ASSISTANT_POLICY, user);
    if (phrased && phrased.trim()) {
      return { markdown: phrased, classification: cls, evidenceSource: ev?.source ?? 'none', phrasedByLlm: true };
    }
    return { markdown: deterministic, classification: cls, evidenceSource: ev?.source ?? 'none', phrasedByLlm: false };
  }
}
