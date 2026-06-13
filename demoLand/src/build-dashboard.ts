// =============================================================================
// ZKSplunk demoLand — Dashboard Generator
// =============================================================================
// Reads out/events.jsonl (produced by `npm run demo`) and emits a single,
// self-contained out/dashboard.html with Splunk-app parity views plus protocol
// metrics:
//
//   1. Overview            — mirrors the Splunk Overview field contract
//   2. Component Detail    — mirrors component drilldown fields
//   3. AI Toolkit Evidence — mirrors evidence sent to Splunk AI Toolkit
//   4. Proof Latency       — proof-server response_time_ms over time
//   5. zkZap Incidents     — incidents grouped by threat type
//   6. Vital Health        — status mix per vital + overall health %
//   7. Attestations        — on-chain commitments over time + latency
//
// No external CDNs or dependencies — charts are hand-rendered as inline SVG so
// the page works fully offline (safe to open during a recorded demo).
// =============================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = resolve(HERE, '..', process.env.ZKSPLUNK_DEMO_OUT || 'out/events.jsonl');
const OUT = resolve(HERE, '..', 'out/dashboard.html');
// Also emit index.html so the dashboard loads at the server root (no path needed).
const OUT_INDEX = resolve(HERE, '..', 'out/index.html');

interface RawEvent {
  time: number;
  event: Record<string, any>;
  fields?: Record<string, any>;
}

function loadEvents(): RawEvent[] {
  let raw: string;
  try {
    raw = readFileSync(IN, 'utf8');
  } catch {
    console.error(`No events file at ${IN}. Run \`npm run demo\` first.`);
    process.exit(1);
  }
  return raw
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as RawEvent);
}

const events = loadEvents();

// The page does all charting from the embedded data so it stays interactive
// and offline. We just hand it the raw events.
const PAYLOAD = JSON.stringify(events);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ZKSplunk — Protocol Metrics (demoLand)</title>
<style>
  :root {
    --bg: #0b0f1a; --panel: #131a2b; --panel2: #0e1422; --ink: #e6edf7;
    --muted: #8aa0c0; --line: #233049; --accent: #6C3FC5; --green: #10b981;
    --amber: #f59e0b; --red: #ef4444; --cyan: #22d3ee;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  header { padding: 20px 24px; border-bottom: 1px solid var(--line);
    display: flex; align-items: baseline; gap: 14px; }
  header h1 { margin: 0; font-size: 18px; letter-spacing: .3px; }
  header .sub { color: var(--muted); font-size: 13px; }
  header .badge { margin-left: auto; color: var(--muted); font-size: 12px; }
  .tabs { display: flex; gap: 4px; padding: 0 16px; border-bottom: 1px solid var(--line);
    background: var(--panel2); }
  .tab { padding: 12px 16px; cursor: pointer; color: var(--muted);
    border-bottom: 2px solid transparent; user-select: none; font-weight: 600; }
  .tab:hover { color: var(--ink); }
  .tab.active { color: var(--ink); border-bottom-color: var(--accent); }
  .views { padding: 24px; }
  .view { display: none; }
  .view.active { display: block; }
  .cards { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 20px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    padding: 16px 18px; min-width: 150px; }
  .card .k { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .5px; }
  .card .v { font-size: 26px; font-weight: 700; margin-top: 4px; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    padding: 18px; }
  .panel h2 { margin: 0 0 12px; font-size: 14px; color: var(--muted); font-weight: 600; }
  svg { width: 100%; height: auto; display: block; }
  .legend { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 10px; color: var(--muted); font-size: 12px; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { width: 11px; height: 11px; border-radius: 3px; display: inline-block; }
  .empty { color: var(--muted); padding: 30px; text-align: center; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 9px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
  th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  td { color: var(--ink); }
  .status { display: inline-block; min-width: 72px; padding: 2px 7px; border-radius: 4px; color: #07120a; font-weight: 700; font-size: 12px; text-align: center; }
  .status.healthy, .status.info { background: var(--green); }
  .status.warning, .status.warn { background: var(--amber); }
  .status.critical, .status.error { background: var(--red); color: #fff; }
  .status.unknown, .status.tracked { background: var(--muted); }
  select { background: var(--panel2); color: var(--ink); border: 1px solid var(--line); padding: 8px 10px; border-radius: 4px; }
  .prompt { white-space: pre-wrap; color: var(--muted); }
</style>
</head>
<body>
<header>
  <h1>ZKSplunk · Protocol Metrics</h1>
  <span class="sub">demoLand · zkZap observability</span>
  <span class="badge" id="meta"></span>
</header>

<div class="tabs" id="tabs">
  <div class="tab active" data-view="overview">Overview</div>
  <div class="tab" data-view="detail">Component Detail</div>
  <div class="tab" data-view="aiEvidence">AI Toolkit Evidence</div>
  <div class="tab" data-view="latency">Proof Latency</div>
  <div class="tab" data-view="incidents">zkZap Incidents</div>
  <div class="tab" data-view="health">Vital Health</div>
  <div class="tab" data-view="attest">Attestations</div>
</div>

<div class="views">
  <section class="view active" id="overview"></section>
  <section class="view" id="detail"></section>
  <section class="view" id="aiEvidence"></section>
  <section class="view" id="latency"></section>
  <section class="view" id="incidents"></section>
  <section class="view" id="health"></section>
  <section class="view" id="attest"></section>
</div>

<script>
const EVENTS = ${PAYLOAD};
const C = { green:'#10b981', amber:'#f59e0b', red:'#ef4444', cyan:'#22d3ee',
  accent:'#6C3FC5', muted:'#8aa0c0', line:'#233049', ink:'#e6edf7' };
const STATUS_COLOR = { healthy:C.green, warning:C.amber, critical:C.red, unknown:C.muted, tracked:C.cyan };

const ev = (e) => e.event || {};
const byType = (t) => EVENTS.filter(e => ev(e).type === t);
const componentOf = (r) => r.component || (r.vital_id === 'network' ? 'indexer' : r.vital_id) || 'global';
const sourcetypeOf = (e) => {
  if (e.sourcetype) return e.sourcetype;
  const t = ev(e).type || '';
  if (t.startsWith('midnight.chain.')) return 'midnight:chain';
  if (t.startsWith('midnight.contract.')) return 'midnight:contracts';
  if (t.startsWith('zksplunk.connector.')) return 'zksplunk:connector';
  if (t.startsWith('zksplunk.')) return 'zksplunk:connector';
  return 'midnight:vitals';
};
const ROWS = EVENTS.map((e, i) => ({ _i:i, _time:e.time, sourcetype:sourcetypeOf(e), ...ev(e) }))
  .map(r => ({ ...r, component: componentOf(r) }));
const splunkRows = ROWS.filter(r => ['midnight:vitals','midnight:chain','midnight:contracts','zksplunk:connector'].includes(r.sourcetype));

// ---------- tiny SVG helpers ----------
function el(tag, attrs, children) {
  const ns = 'http://www.w3.org/2000/svg';
  const n = document.createElementNS(ns, tag);
  for (const k in (attrs||{})) n.setAttribute(k, attrs[k]);
  (children||[]).forEach(c => n.appendChild(c));
  return n;
}
function text(x, y, s, attrs) {
  const t = el('text', Object.assign({ x, y, fill: C.muted, 'font-size': 11 }, attrs||{}));
  t.textContent = s; return t;
}
function svg(w, h) { return el('svg', { viewBox: '0 0 '+w+' '+h, preserveAspectRatio:'xMidYMid meet' }); }

function card(k, v) {
  const d = document.createElement('div'); d.className = 'card';
  d.innerHTML = '<div class="k">'+k+'</div><div class="v">'+v+'</div>';
  return d;
}
function panel(title) {
  const p = document.createElement('div'); p.className = 'panel';
  const h = document.createElement('h2'); h.textContent = title; p.appendChild(h);
  return p;
}
function cards(view, items) {
  const wrap = document.createElement('div'); wrap.className = 'cards';
  items.forEach(([k,v]) => wrap.appendChild(card(k, v)));
  view.appendChild(wrap);
}
function legend(view, items) {
  const l = document.createElement('div'); l.className = 'legend';
  items.forEach(([label,color]) => {
    const s = document.createElement('span');
    s.innerHTML = '<i class="swatch" style="background:'+color+'"></i>'+label;
    l.appendChild(s);
  });
  view.lastChild.appendChild(l);
}
function fmtTime(ts) { return new Date(ts * 1000).toLocaleTimeString(); }
function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function statusPill(v) {
  const s = String(v || 'unknown');
  return '<span class="status '+escapeHtml(s)+'">'+escapeHtml(s)+'</span>';
}
function simpleTable(headers, rows) {
  const table = document.createElement('table');
  table.innerHTML =
    '<thead><tr>'+headers.map(h => '<th>'+escapeHtml(h.label)+'</th>').join('')+'</tr></thead>' +
    '<tbody>'+rows.map(row => '<tr>'+headers.map(h => '<td>'+(h.html ? h.html(row) : escapeHtml(row[h.key]))+'</td>').join('')+'</tr>').join('')+'</tbody>';
  return table;
}
function latestBy(rows, keyFn) {
  const m = new Map();
  rows.forEach(r => {
    const k = keyFn(r);
    if (!m.has(k) || r._time >= m.get(k)._time) m.set(k, r);
  });
  return [...m.values()];
}

// ---------- Splunk-app parity: Overview ----------
function renderOverview(view) {
  const current = latestBy(
    splunkRows.filter(r => ['midnight:vitals','zksplunk:connector','midnight:contracts'].includes(r.sourcetype)),
    r => r.component,
  ).sort((a,b) => a.component.localeCompare(b.component));
  const critical = current.filter(r => ['critical','error'].includes(String(r.status || r.severity))).length;
  const warnings = current.filter(r => ['warning','warn'].includes(String(r.status || r.severity))).length;
  const proof = splunkRows.filter(r => r.sourcetype === 'midnight:vitals' && r.component === 'proof-server' && r.type === 'midnight.vital.check' && r.response_time_ms != null);
  const sortedProof = proof.map(r => Number(r.response_time_ms)).sort((a,b)=>a-b);
  const p95 = sortedProof.length ? sortedProof[Math.min(sortedProof.length-1, Math.floor(sortedProof.length * 0.95))] : '-';
  const chain = latestBy(splunkRows.filter(r => r.sourcetype === 'midnight:chain' && r.block_height != null), r => 'chain')[0];
  const connector = latestBy(splunkRows.filter(r => r.sourcetype === 'zksplunk:connector' && r.type === 'zksplunk.connector.status'), r => 'connector')[0];
  cards(view, [
    ['Components', current.length],
    ['Warnings', warnings],
    ['Critical', critical],
    ['Proof p95', p95 === '-' ? '-' : p95 + ' ms'],
    ['Latest block', chain?.block_height ?? '-'],
    ['Connector failures', connector?.failed_events_since_last_heartbeat ?? 0],
  ]);
  const p = panel('Current Component Health — same fields as zksplunk_overview'); view.appendChild(p);
  p.appendChild(simpleTable([
    {label:'component', key:'component'},
    {label:'status', html:r => statusPill(r.status || r.severity)},
    {label:'severity', html:r => statusPill(r.severity || 'info')},
    {label:'response_time_ms', key:'response_time_ms'},
    {label:'last_update', html:r => escapeHtml(fmtTime(r._time))},
    {label:'message', key:'message'},
  ], current));

  const alerts = splunkRows.filter(r => ['critical','error'].includes(String(r.status || r.severity)) || r.send_status === 'failed')
    .sort((a,b)=>b._time-a._time).slice(0,12);
  const p2 = panel('Recent alertable conditions'); view.appendChild(p2);
  p2.appendChild(simpleTable([
    {label:'t', html:r => escapeHtml(fmtTime(r._time))},
    {label:'component', key:'component'},
    {label:'type', key:'type'},
    {label:'status', html:r => statusPill(r.status || r.severity)},
    {label:'response_time_ms', key:'response_time_ms'},
    {label:'message', key:'message'},
  ], alerts));
}

// ---------- Splunk-app parity: Component Detail ----------
function renderDetail(view) {
  const components = [...new Set(splunkRows.map(r => r.component))].filter(Boolean).sort();
  const controls = document.createElement('div');
  controls.className = 'cards';
  controls.innerHTML = '<div class="card"><div class="k">Component</div><select id="componentSelect">'+
    components.map(c => '<option value="'+escapeHtml(c)+'">'+escapeHtml(c)+'</option>').join('')+
    '</select></div>';
  view.appendChild(controls);
  const target = document.createElement('div'); view.appendChild(target);
  const draw = () => {
    target.innerHTML = '';
    const selected = document.getElementById('componentSelect').value;
    const rows = splunkRows.filter(r => r.component === selected).sort((a,b)=>b._time-a._time);
    const latest = rows[0] || {};
    cards(target, [
      ['Current status', latest.status || latest.severity || 'unknown'],
      ['Latest latency', latest.response_time_ms == null ? '-' : latest.response_time_ms + ' ms'],
      ['Events', rows.length],
    ]);
    const p = panel('Latest component facts — same columns as zksplunk_component_detail'); target.appendChild(p);
    p.appendChild(simpleTable([
      {label:'t', html:r => escapeHtml(fmtTime(r._time))},
      {label:'sourcetype', key:'sourcetype'},
      {label:'type', key:'type'},
      {label:'status', html:r => statusPill(r.status || r.severity)},
      {label:'severity', html:r => statusPill(r.severity || 'info')},
      {label:'response_time_ms', key:'response_time_ms'},
      {label:'probe_name', key:'probe_name'},
      {label:'endpoint', key:'endpoint'},
      {label:'message', key:'message'},
    ], rows.slice(0,20)));
  };
  document.getElementById('componentSelect').addEventListener('change', draw);
  draw();
}

// ---------- Splunk-app parity: AI Toolkit Evidence ----------
function renderAiEvidence(view) {
  const latest = latestBy(splunkRows, r => r.sourcetype + '|' + r.component + '|' + (r.type || 'event'))
    .sort((a,b) => a.sourcetype.localeCompare(b.sourcetype) || a.component.localeCompare(b.component));
  const evidence = latest.map(r => {
    if (r.sourcetype === 'midnight:vitals') return r.component + ': status=' + (r.status || 'unknown') + ', severity=' + (r.severity || 'unknown') + ', latency_ms=' + (r.response_time_ms ?? '-') + ', message=' + (r.message || '');
    if (r.sourcetype === 'midnight:chain') return 'chain: block_height=' + (r.block_height ?? '-') + ', block_age_seconds=' + (r.block_age_seconds ?? '-') + ', protocol=' + (r.protocol_version ?? '-');
    if (r.sourcetype === 'zksplunk:connector') return 'connector: sent=' + (r.total_events_sent ?? '-') + ', failed=' + (r.total_events_failed ?? '-') + ', failed_since_heartbeat=' + (r.failed_events_since_last_heartbeat ?? '-') + ', queue=' + (r.queued_events ?? '-');
    if (r.sourcetype === 'midnight:contracts') return 'contracts: ' + (r.type || 'event') + ', status=' + (r.status || 'unknown') + ', message=' + (r.message || '');
    return r.sourcetype + ': ' + (r.type || 'event');
  });
  cards(view, [['Evidence rows', latest.length], ['Sourcetypes', new Set(latest.map(r => r.sourcetype)).size], ['AI command', '| ai']]);
  const p = panel('Evidence Sent To AI Toolkit — mirrors ZKSplunk AI Toolkit Analyst'); view.appendChild(p);
  p.appendChild(simpleTable([
    {label:'last_seen', html:r => escapeHtml(fmtTime(r._time))},
    {label:'sourcetype', key:'sourcetype'},
    {label:'component', key:'component'},
    {label:'type', key:'type'},
    {label:'latest_evidence', html:r => escapeHtml(evidence[latest.indexOf(r)])},
  ], latest));
  const p2 = panel('Prompt shape used by the Splunk tab'); view.appendChild(p2);
  const pre = document.createElement('div'); pre.className = 'prompt';
  pre.textContent = 'You are zkZap, the ZKSplunk analyst. Answer the operator question using only the live Splunk evidence below. Do not claim visibility into private Midnight state, witness values, shielded parties, or shielded amounts. Include classification, evidence, impact, and recommended action. Evidence: ' + evidence.join('; ') + '\\n\\n| ai prompt="{prompt}" provider=Gemini model=gemini-3.5-flash';
  p2.appendChild(pre);
}

// ---------- 1. Proof latency line chart ----------
function renderLatency(view) {
  const pts = byType('midnight.vital.check')
    .filter(e => ev(e).vital_id === 'proof-server' && ev(e).response_time_ms != null)
    .map((e,i) => ({ i, ms: ev(e).response_time_ms, status: ev(e).status }));
  const peak = pts.reduce((m,p) => Math.max(m, p.ms), 0);
  const avg = pts.length ? Math.round(pts.reduce((s,p)=>s+p.ms,0)/pts.length) : 0;
  cards(view, [['Readings', pts.length], ['Avg latency', avg+' ms'], ['Peak', peak+' ms'],
    ['Threshold', '2000 ms']]);
  const p = panel('Proof-server response time (ms) — threshold 2000 ms'); view.appendChild(p);
  if (!pts.length) { p.innerHTML += '<div class="empty">No proof-server readings.</div>'; return; }

  const W=900,H=320,pad=44, yMax=Math.max(peak*1.15, 2200);
  const s = svg(W,H);
  const x = (i)=> pad + (i/(Math.max(pts.length-1,1)))*(W-pad*2);
  const y = (v)=> H-pad - (v/yMax)*(H-pad*2);
  // grid + y labels
  for (let g=0; g<=4; g++){ const v=Math.round(yMax*g/4); const yy=y(v);
    s.appendChild(el('line',{x1:pad,y1:yy,x2:W-pad,y2:yy,stroke:C.line}));
    s.appendChild(text(6,yy+3,String(v))); }
  // threshold line
  s.appendChild(el('line',{x1:pad,y1:y(2000),x2:W-pad,y2:y(2000),stroke:C.amber,'stroke-dasharray':'5 4'}));
  // path
  let d=''; pts.forEach((p2,i)=> d += (i?'L':'M')+x(i)+' '+y(p2.ms)+' ');
  s.appendChild(el('path',{d, fill:'none', stroke:C.cyan, 'stroke-width':2}));
  // dots colored by status
  pts.forEach((p2,i)=> s.appendChild(el('circle',{cx:x(i),cy:y(p2.ms),r:3.5,
    fill: STATUS_COLOR[p2.status]||C.cyan})));
  p.appendChild(s);
  legend(view, [['healthy',C.green],['warning',C.amber],['critical',C.red],['latency',C.cyan]]);
}

// ---------- 2. zkZap incidents bar chart ----------
function renderIncidents(view) {
  const inc = byType('zkzap.incident.opened');
  const counts = {};
  inc.forEach(e => { const t = ev(e).threat || 'unknown'; counts[t]=(counts[t]||0)+1; });
  const rows = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  cards(view, [['Incidents', inc.length], ['Threat types', rows.length],
    ['Critical', inc.filter(e=>ev(e).severity==='critical').length]]);
  const p = panel('zkZap incidents by threat type'); view.appendChild(p);
  if (!rows.length) { p.innerHTML += '<div class="empty">No incidents detected.</div>'; return; }

  const W=900, rowH=46, pad=160, max=Math.max(...rows.map(r=>r[1]));
  const H = rows.length*rowH + 20; const s = svg(W,H);
  rows.forEach((r,i)=>{
    const yy = 16 + i*rowH;
    const bw = (r[1]/max)*(W-pad-60);
    s.appendChild(text(8, yy+20, r[0], {fill:C.ink,'font-size':13}));
    s.appendChild(el('rect',{x:pad,y:yy,width:bw,height:24,rx:5,fill:C.accent}));
    s.appendChild(text(pad+bw+8, yy+18, String(r[1]), {fill:C.ink,'font-size':13}));
  });
  p.appendChild(s);
}

// ---------- 3. Vital health stacked bars + overall % ----------
function renderHealth(view) {
  const checks = byType('midnight.vital.check');
  const vitals = ['proof-server','network','wallet','contracts'];
  const tally = {}; vitals.forEach(v=> tally[v]={healthy:0,warning:0,critical:0,unknown:0,tracked:0});
  let healthy=0, total=0;
  checks.forEach(e=>{ const v=ev(e).vital_id, st=ev(e).status;
    if(tally[v] && tally[v][st]!=null){ tally[v][st]++; total++; if(st==='healthy') healthy++; }});
  const pct = total ? Math.round(healthy/total*100) : 0;
  cards(view, [['Checks', total], ['Overall health', pct+'%'],
    ['Critical checks', checks.filter(e=>ev(e).status==='critical').length]]);
  const p = panel('Status mix per vital (share of checks)'); view.appendChild(p);
  if (!total) { p.innerHTML += '<div class="empty">No vital checks.</div>'; return; }

  const W=900, rowH=54, pad=130; const H = vitals.length*rowH + 16; const s = svg(W,H);
  vitals.forEach((v,i)=>{
    const yy = 12 + i*rowH; const t = tally[v];
    const sum = t.healthy+t.warning+t.critical+t.unknown+t.tracked || 1;
    const barW = W-pad-30; let cx = pad;
    s.appendChild(text(8, yy+22, v, {fill:C.ink,'font-size':13}));
    ['healthy','warning','critical','unknown','tracked'].forEach(st=>{
      const w = (t[st]/sum)*barW; if(w<=0) return;
      s.appendChild(el('rect',{x:cx,y:yy,width:w,height:26,fill:STATUS_COLOR[st]}));
      cx += w;
    });
  });
  p.appendChild(s);
  legend(view, [['healthy',C.green],['warning',C.amber],['critical',C.red],['unknown',C.muted]]);
}

// ---------- 4. Attestations over time + latency ----------
function renderAttest(view) {
  const att = byType('midnight.attestation.confirmed');
  const lat = att.map(e=> ev(e).attestation_latency_ms).filter(v=> v!=null);
  const avg = lat.length ? Math.round(lat.reduce((a,b)=>a+b,0)/lat.length) : 0;
  cards(view, [['Commitments anchored', att.length], ['Avg attest latency', avg+' ms'],
    ['Pending (incident)', byType('zkzap.incident.opened').length]]);
  const p = panel('On-chain attestations — cumulative commitments'); view.appendChild(p);
  if (!att.length) { p.innerHTML += '<div class="empty">No attestations.</div>'; return; }

  const W=900,H=300,pad=44, n=att.length;
  const s = svg(W,H);
  const x=(i)=> pad + (i/Math.max(n-1,1))*(W-pad*2);
  const y=(v)=> H-pad - (v/n)*(H-pad*2);
  for(let g=0; g<=4; g++){ const v=Math.round(n*g/4); const yy=y(v);
    s.appendChild(el('line',{x1:pad,y1:yy,x2:W-pad,y2:yy,stroke:C.line}));
    s.appendChild(text(6,yy+3,String(v))); }
  let d=''; att.forEach((_,i)=> d += (i?'L':'M')+x(i)+' '+y(i+1)+' ');
  s.appendChild(el('path',{d,fill:'none',stroke:C.green,'stroke-width':2}));
  att.forEach((_,i)=> s.appendChild(el('circle',{cx:x(i),cy:y(i+1),r:3.5,fill:C.green})));
  p.appendChild(s);
  legend(view, [['cumulative commitments',C.green]]);
}

// ---------- wire tabs ----------
document.getElementById('meta').textContent =
  EVENTS.length + ' events · ' + (ev(EVENTS[0]||{}).dapp_name || 'dapp');
renderOverview(document.getElementById('overview'));
renderDetail(document.getElementById('detail'));
renderAiEvidence(document.getElementById('aiEvidence'));
renderLatency(document.getElementById('latency'));
renderIncidents(document.getElementById('incidents'));
renderHealth(document.getElementById('health'));
renderAttest(document.getElementById('attest'));

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.view).classList.add('active');
  });
});
</script>
</body>
</html>
`;

writeFileSync(OUT, html);
writeFileSync(OUT_INDEX, html);
console.log(`Dashboard written → ${OUT}`);
console.log(`              and → ${OUT_INDEX} (served at root)`);
console.log(`  events: ${events.length}`);
console.log(`Open it in a browser (offline-safe, no CDNs).`);
