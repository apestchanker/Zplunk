// =============================================================================
// ZKSplunk — Local JSONL Sink
// =============================================================================
// Optional development sink. When enabled, every event handed to the HEC
// pipeline (and every failed HEC delivery) is appended as one JSON object per
// line to a local file. Lets you inspect exactly what would be sent to Splunk
// without a running Splunk, and captures failed deliveries for replay.
//
// Node-only. Uses dynamic `import('node:fs')` so the module stays importable in
// browser builds; writes issued before fs resolves are buffered, then flushed.
// =============================================================================

import type { SplunkHecEvent } from './hec-client';

type WriteStream = import('node:fs').WriteStream;

export class JsonlSink {
  private stream: WriteStream | null = null;
  private buffer: string[] = [];
  private failed = false;
  private opening = false;

  constructor(private readonly path: string) {
    void this.open();
  }

  private async open(): Promise<void> {
    if (this.opening || this.failed || this.stream) return;
    this.opening = true;
    try {
      const fs = await import('node:fs');
      const pathMod = await import('node:path');
      fs.mkdirSync(pathMod.dirname(this.path), { recursive: true });
      this.stream = fs.createWriteStream(this.path, { flags: 'a' });
      // Flush anything buffered while we were opening.
      if (this.buffer.length) {
        this.stream.write(this.buffer.join(''));
        this.buffer = [];
      }
    } catch (err) {
      this.failed = true;
      // eslint-disable-next-line no-console
      console.warn(`[ZKSplunk] JSONL sink disabled (cannot open ${this.path}):`, (err as Error).message);
    } finally {
      this.opening = false;
    }
  }

  /** Append one event. `meta` lets callers tag delivery outcome, etc. */
  write(event: SplunkHecEvent, meta?: Record<string, unknown>): void {
    if (this.failed) return;
    const line = JSON.stringify(meta ? { ...event, _sink: meta } : event) + '\n';
    if (this.stream) {
      this.stream.write(line);
    } else {
      // Bound the buffer so a never-opening sink can't grow unbounded.
      if (this.buffer.length < 10_000) this.buffer.push(line);
    }
  }

  /** Append a batch of events sharing the same meta. */
  writeBatch(events: SplunkHecEvent[], meta?: Record<string, unknown>): void {
    for (const e of events) this.write(e, meta);
  }

  close(): void {
    this.stream?.end();
    this.stream = null;
  }
}
