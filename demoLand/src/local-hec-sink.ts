// =============================================================================
// ZKSplunk demoLand — Local HEC Sink
// =============================================================================
// A stand-in for the real Splunk HTTP Event Collector. Instead of POSTing
// events over HTTPS to Splunk Cloud, it pretty-prints them to the console and
// appends them (one JSON object per line) to a local .jsonl file.
//
// The event shape is the SAME `SplunkHecEvent` the real connector produces, so
// what you see here is exactly what Splunk would index in zkMonitor.
// =============================================================================

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SplunkHecEvent } from '../../connector/src/hec-client.ts';

// ANSI colors for readable console output (no dependency needed).
const COLOR: Record<string, string> = {
  info: '\x1b[36m', // cyan
  warn: '\x1b[33m', // yellow
  warning: '\x1b[33m',
  error: '\x1b[31m', // red
  critical: '\x1b[41m\x1b[37m', // white on red
  reset: '\x1b[0m',
  dim: '\x1b[2m',
};

export class LocalHecSink {
  private count = 0;

  constructor(private readonly outFile: string) {
    mkdirSync(dirname(outFile), { recursive: true });
    // Truncate any previous run so each demo starts clean.
    writeFileSync(outFile, '');
  }

  /** Accept a batch of events, exactly like the real HEC client would. */
  send(events: SplunkHecEvent[]): void {
    for (const ev of events) {
      this.count += 1;
      const e = ev.event as Record<string, unknown>;
      const severity = String(e.severity ?? 'info');
      const color = COLOR[severity] ?? COLOR.info;
      const type = String(e.type ?? 'event');
      const headline =
        (e.message as string) ||
        (e.summary as string) ||
        type;
      const commitment = e.attestation_commitment
        ? `${COLOR.dim} commit=${String(e.attestation_commitment).slice(0, 12)}…${COLOR.reset}`
        : '';

      // eslint-disable-next-line no-console
      console.log(
        `${color} ${severity.toUpperCase().padEnd(8)}${COLOR.reset} ` +
          `${COLOR.dim}${type.padEnd(28)}${COLOR.reset} ${headline}${commitment}`,
      );

      appendFileSync(this.outFile, JSON.stringify(ev) + '\n');
    }
  }

  get totalSent(): number {
    return this.count;
  }
}
