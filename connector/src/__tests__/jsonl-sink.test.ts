// =============================================================================
// ZKSplunk — JSONL sink tests
// =============================================================================

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlSink } from '../jsonl-sink';
import type { SplunkHecEvent } from '../hec-client';

const dirs: string[] = [];
function tmpPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'zk-sink-'));
  dirs.push(dir);
  return join(dir, 'nested', name); // nested dir tests mkdir recursive
}
function ev(type: string): SplunkHecEvent {
  return { time: 1, event: { type, component: 'connector' } };
}
function flushTick(): Promise<void> {
  // Let the dynamic import('node:fs') + open settle, then the stream write.
  return new Promise((r) => setTimeout(r, 30));
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('JsonlSink', () => {
  it('creates parent directories and appends one JSON object per line', async () => {
    const path = tmpPath('events.jsonl');
    const sink = new JsonlSink(path);
    sink.write(ev('a'));
    sink.write(ev('b'));
    await flushTick();
    sink.close();
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).event.type).toBe('a');
    expect(JSON.parse(lines[1]).event.type).toBe('b');
  });

  it('buffers writes issued before the file opens, then flushes them', async () => {
    const path = tmpPath('buffered.jsonl');
    const sink = new JsonlSink(path);
    // These run synchronously before the async open() resolves.
    for (let i = 0; i < 5; i++) sink.write(ev(`e${i}`));
    await flushTick();
    sink.close();
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(5);
    expect(JSON.parse(lines[4]).event.type).toBe('e4');
  });

  it('writeBatch tags every event with the same meta', async () => {
    const path = tmpPath('batch.jsonl');
    const sink = new JsonlSink(path);
    sink.writeBatch([ev('x'), ev('y')], { delivery_status: 'failed', attempts: 3 });
    await flushTick();
    sink.close();
    const lines = readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]._sink).toEqual({ delivery_status: 'failed', attempts: 3 });
    expect(lines[1]._sink.delivery_status).toBe('failed');
  });
});
