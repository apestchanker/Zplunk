// =============================================================================
// ZKSplunk — Splunk HTTP Event Collector (HEC) Client
// =============================================================================
// Handles all communication with Splunk's HEC endpoint.
// Supports batching, retry with exponential backoff, and health checks.
//
// HEC is Splunk's recommended way to send data programmatically.
// It accepts JSON events over HTTPS and returns acknowledgments.
// Docs: https://docs.splunk.com/Documentation/Splunk/latest/Data/UsetheHTTPEventCollector
// =============================================================================


import type { ZKSplunkConfig } from './config';
import { JsonlSink } from './jsonl-sink';


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single event payload in Splunk HEC format.
 * See: https://docs.splunk.com/Documentation/Splunk/latest/Data/FormateventsforHTTPEventCollector
 */
export interface SplunkHecEvent {
  time?: number;              // Epoch time in seconds (with millisecond decimal). Splunk auto-assigns if omitted.
  host?: string;              // Hostname of the source machine
  source?: string;            // Source identifier (e.g., "zksplunk-connector")
  sourcetype?: string;        // Sourcetype (e.g., "midnight:vitals")
  index?: string;             // Target Splunk index
  event: Record<string, any>; // The actual event data (this is what gets searched in Splunk)
  fields?: Record<string, any>; // Additional indexed fields (bypass field extraction)
}

/**
 * Response from Splunk HEC after sending events.
 */
export interface SplunkHecResponse {
  text: string;               // "Success" or error message
  code: number;               // 0 = success, non-zero = error
  invalid_event_number?: number; // Index of the first invalid event (batch mode)
  ackId?: number;             // Acknowledgment ID (if ack is enabled)
}

/**
 * Callback for monitoring HEC client health and errors.
 */
export interface HecDeliveryInfo {
  batchEventCount: number;
  sendAttempt: number;
  sendStatus: 'success' | 'retry' | 'failed';
  hecResponseCode: number | null;
  responseTimeMs: number | null;
  errorName?: string | null;
  errorMessage?: string | null;
}

export interface HecClientCallbacks {
  onSendSuccess?: (eventCount: number, responseTimeMs: number) => void;
  onSendError?: (error: Error, eventCount: number, attempt: number) => void;
  onBatchFlushed?: (eventCount: number) => void;
  onQueueOverflow?: (droppedCount: number) => void;
  /** Per-attempt delivery telemetry, used to emit `zksplunk.hec.delivery`. */
  onDelivery?: (info: HecDeliveryInfo) => void;
}


// ---------------------------------------------------------------------------
// HEC Client Class
// ---------------------------------------------------------------------------

/**
 * HTTP Event Collector client for sending telemetry to Splunk.
 *
 * Features:
 *  - Batches events and flushes periodically or when batch is full
 *  - Retries failed sends with exponential backoff
 *  - Tracks send statistics (total sent, total failed, avg latency)
 *  - Graceful shutdown (flushes remaining events)
 */
export class SplunkHecClient {
  private config: ZKSplunkConfig;
  private callbacks: HecClientCallbacks;
  private eventQueue: SplunkHecEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isShuttingDown = false;

  // Stable per-client request channel. Required when the HEC token has indexer
  // acknowledgement enabled ("Data channel is missing" otherwise); harmless
  // when it's disabled. Generated once so all batches share one channel.
  private readonly requestChannel: string = newRequestChannel();

  // Statistics
  private totalEventsSent = 0;
  private totalEventsFailed = 0;
  private totalBatchesSent = 0;
  private totalLatencyMs = 0;

  // Optional local JSONL sink: mirrors every event and captures failed deliveries.
  private sink: JsonlSink | null = null;

  constructor(config: ZKSplunkConfig, callbacks: HecClientCallbacks = {}) {
    this.config = config;
    this.callbacks = callbacks;

    if (config.enableLocalJsonlSink) {
      this.sink = new JsonlSink(config.localJsonlPath);
    }

    // Start the periodic flush timer
    if (config.batchFlushIntervalMs > 0) {
      this.flushTimer = setInterval(() => {
        this.flush();
      }, config.batchFlushIntervalMs);
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Queue a single event for sending to Splunk.
   * The event will be batched and sent when the batch is full
   * or the flush interval fires.
   */
  enqueue(event: SplunkHecEvent): void {
    if (this.isShuttingDown) return;

    // Apply defaults from config if not set on the event
    const enrichedEvent: SplunkHecEvent = {
      time: event.time || (Date.now() / 1000),  // Splunk wants epoch seconds
      host: event.host || this.config.splunkHost,
      source: event.source || this.config.splunkSource,
      sourcetype: event.sourcetype || this.config.splunkSourcetype,
      index: event.index || this.config.splunkIndex,
      ...event,
    };
    // Re-apply the resolved host since the spread above restores event.host.
    enrichedEvent.host = event.host || this.config.splunkHost;

    this.eventQueue.push(enrichedEvent);

    // Mirror to local JSONL sink (development visibility).
    this.sink?.write(enrichedEvent);

    // Flush immediately if batch is full
    if (this.eventQueue.length >= this.config.batchSize) {
      this.flush();
    }
  }

  /**
   * Immediately flush all queued events to Splunk.
   * Returns a promise that resolves when the batch has been sent (or failed).
   */
  async flush(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    // Grab all queued events and clear the queue
    const eventsToSend = [...this.eventQueue];
    this.eventQueue = [];

    await this.sendBatch(eventsToSend);
    this.callbacks.onBatchFlushed?.(eventsToSend.length);
  }

  /**
   * Gracefully shut down: flush remaining events and stop the timer.
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Final flush
    await this.flush();
    this.sink?.close();
  }

  /**
   * Check if the Splunk HEC endpoint is reachable and the token is valid.
   * Sends a test event with minimal data.
   */
  async healthCheck(): Promise<{ healthy: boolean; message: string; responseTimeMs: number }> {
    const startTime = Date.now();

    try {
      const testEvent: SplunkHecEvent = {
        time: Date.now() / 1000,
        source: this.config.splunkSource,
        sourcetype: this.config.splunkSourcetype,
        index: this.config.splunkIndex,
        event: {
          type: 'zksplunk.health_check',
          message: 'ZKSplunk HEC connectivity test',
          connector_version: '0.1.0',
        },
      };

      const response = await this.sendToHec([testEvent]);
      const responseTimeMs = Date.now() - startTime;

      if (response.code === 0) {
        return {
          healthy: true,
          message: `Splunk HEC is reachable and accepting events (${responseTimeMs}ms).`,
          responseTimeMs,
        };
      } else {
        return {
          healthy: false,
          message: `Splunk HEC returned error code ${response.code}: ${response.text}`,
          responseTimeMs,
        };
      }
    } catch (error) {
      const responseTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        healthy: false,
        message: `Splunk HEC unreachable: ${errorMessage}`,
        responseTimeMs,
      };
    }
  }

  /**
   * Get current client statistics.
   */
  getStats() {
    return {
      totalEventsSent: this.totalEventsSent,
      totalEventsFailed: this.totalEventsFailed,
      totalBatchesSent: this.totalBatchesSent,
      averageLatencyMs: this.totalBatchesSent > 0
        ? Math.round(this.totalLatencyMs / this.totalBatchesSent)
        : 0,
      queuedEvents: this.eventQueue.length,
      isShuttingDown: this.isShuttingDown,
    };
  }

  // -----------------------------------------------------------------------
  // Private: Send batch with retry
  // -----------------------------------------------------------------------

  private async sendBatch(events: SplunkHecEvent[]): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const startTime = Date.now();
        const response = await this.sendToHec(events);
        const responseTimeMs = Date.now() - startTime;

        if (response.code === 0) {
          // Success
          this.totalEventsSent += events.length;
          this.totalBatchesSent += 1;
          this.totalLatencyMs += responseTimeMs;
          this.callbacks.onSendSuccess?.(events.length, responseTimeMs);
          this.callbacks.onDelivery?.({
            batchEventCount: events.length,
            sendAttempt: attempt,
            sendStatus: attempt === 1 ? 'success' : 'retry',
            hecResponseCode: response.code,
            responseTimeMs,
          });
          return;
        } else {
          // Splunk returned an error code but HTTP was successful
          lastError = new Error(`HEC error code ${response.code}: ${response.text}`);
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      // Notify about the failed attempt
      this.callbacks.onSendError?.(lastError!, events.length, attempt);

      // Don't delay after the last attempt
      if (attempt < this.config.retryAttempts) {
        const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
        await this.sleep(delay);
      }
    }

    // All retries exhausted
    this.totalEventsFailed += events.length;
    // HEC is unreachable, so the delivery-failure event cannot be sent to HEC.
    // Capture it locally (JSONL) and surface counts in the next heartbeat.
    this.sink?.writeBatch(events, {
      delivery_status: 'failed',
      attempts: this.config.retryAttempts,
      error: lastError?.message ?? null,
    });
    this.callbacks.onDelivery?.({
      batchEventCount: events.length,
      sendAttempt: this.config.retryAttempts,
      sendStatus: 'failed',
      hecResponseCode: null,
      responseTimeMs: null,
      errorName: lastError?.name ?? 'HecDeliveryError',
      errorMessage: lastError?.message ?? 'unknown',
    });
    console.error(
      `[ZKSplunk] Failed to send ${events.length} events after ${this.config.retryAttempts} attempts:`,
      lastError?.message,
    );
  }

  // -----------------------------------------------------------------------
  // Private: Raw HTTP request to Splunk HEC
  // -----------------------------------------------------------------------

  /**
   * Send one or more events to the Splunk HEC /services/collector endpoint.
   * Events are sent as newline-delimited JSON (NDJSON) for batch efficiency.
   */
  private async sendToHec(events: SplunkHecEvent[]): Promise<SplunkHecResponse> {
    // Splunk HEC batch format: one JSON object per line (no array wrapper)
    const body = events.map((e) => JSON.stringify(e)).join('\n');

    // Bounded timeout so a firewalled/slow HEC (packets dropped → would hang
    // indefinitely) can't block startup or the flush loop.
    const response = await fetch(`${this.config.splunkHecUrl}/services/collector`, {
      method: 'POST',
      headers: {
        'Authorization': `Splunk ${this.config.splunkHecToken}`,
        'Content-Type': 'application/json',
        'X-Splunk-Request-Channel': this.requestChannel,
      },
      body,
      signal: AbortSignal.timeout(this.config.hecRequestTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return (await response.json()) as SplunkHecResponse;
  }

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}


/**
 * Generate a request-channel GUID. Prefers the platform crypto (Node 19+ and
 * all browsers); falls back to a non-cryptographic UUIDv4 shape so the client
 * still works on older runtimes without importing node:crypto.
 */
function newRequestChannel(): string {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
