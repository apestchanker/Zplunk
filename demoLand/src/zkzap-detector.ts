// =============================================================================
// ZKSplunk demoLand — zkZap Detector (demo edition)
// =============================================================================
// The "decide" half of zkZap's observe → decide → act loop, in its simplest
// honest form: a per-vital sliding window that trips an INCIDENT when a vital
// stays non-healthy for N consecutive checks. A healthy reading resets the
// window (so a single blip doesn't page anyone).
//
// In zkMonitor this logic is expressed as Splunk SPL saved searches + the AI
// agent; here it runs locally so the demo needs no Splunk account.
//
// See docs/ZKZAP_SECURITY_PROTOCOL.md §2 for the threat taxonomy this maps to.
// =============================================================================

import type { VitalId, VitalCheckResult, VitalStatus } from '../../vitals/types.ts';

/** Mirrors the Severity enum in contract/src/zksplunk.compact. */
export type Severity = 'info' | 'warning' | 'degraded' | 'critical' | 'outage';

export interface ZkZapIncident {
  /** Stable id for this episode (threat + vital + first-seen second). */
  incidentId: string;
  vitalId: VitalId;
  /** The zkZap threat-taxonomy label (e.g. "proof-flood"). */
  threatLabel: string;
  severity: Severity;
  firstSeenTs: number;
  consecutiveCount: number;
  message: string;
}

const STATUS_TO_SEVERITY: Record<VitalStatus, Severity> = {
  healthy: 'info',
  warning: 'degraded',
  critical: 'critical',
  unknown: 'warning',
  tracked: 'info',
};

interface WindowState {
  consecutive: number;
  firstSeenTs: number;
  tripped: boolean;
}

export class ZkZapDetector {
  private windows = new Map<VitalId, WindowState>();

  /**
   * @param tripAfter  number of consecutive non-healthy checks before an
   *                   incident fires (default 2 — fast enough for a demo).
   */
  constructor(private readonly tripAfter = 2) {}

  /**
   * Feed one reading. Returns a freshly-tripped incident the moment the window
   * crosses the threshold, otherwise null. Healthy readings clear the window.
   */
  observe(
    vitalId: VitalId,
    result: VitalCheckResult,
    threatLabel: string,
  ): ZkZapIncident | null {
    const now = Date.now();

    if (result.status === 'healthy') {
      this.windows.delete(vitalId);
      return null;
    }

    const w = this.windows.get(vitalId) ?? {
      consecutive: 0,
      firstSeenTs: now,
      tripped: false,
    };
    w.consecutive += 1;
    this.windows.set(vitalId, w);

    if (w.consecutive >= this.tripAfter && !w.tripped) {
      w.tripped = true;
      return {
        incidentId: `${threatLabel}:${vitalId}:${Math.floor(w.firstSeenTs / 1000)}`,
        vitalId,
        threatLabel,
        severity: STATUS_TO_SEVERITY[result.status],
        firstSeenTs: w.firstSeenTs,
        consecutiveCount: w.consecutive,
        message:
          `zkZap detected "${threatLabel}" on ${vitalId}: ` +
          `${w.consecutive} consecutive ${result.status} checks — ${result.message}`,
      };
    }

    return null;
  }

  /** Clear all windows (between scenarios). */
  reset(): void {
    this.windows.clear();
  }
}
