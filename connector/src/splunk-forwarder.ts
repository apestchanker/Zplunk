// =============================================================================
// ZKSplunk — Splunk Event Forwarder
// =============================================================================
// The bridge between MidnightVitals events and Splunk ingestion.
//
// This class subscribes to vitals events (health checks, log entries,
// diagnostic reports) and forwards them to Splunk via the HEC client.
// It's designed to be plugged into the VitalsProvider as an event callback
// so the core vitals module doesn't need to know about Splunk at all.
//
// Usage:
//   const forwarder = new SplunkForwarder(config);
//   <VitalsProvider onVitalCheck={forwarder.handleVitalCheck}
//                   onLogEntry={forwarder.handleLogEntry}>
// =============================================================================


import { SplunkHecClient } from './hec-client';
import type { ZKSplunkConfig } from './config';
import {
  vitalCheckToSplunkEvent,
  chainBlockToSplunkEvent,
  componentVersionToSplunkEvent,
  contractMonitorabilityToSplunkEvent,
  walletBoundaryToSplunkEvent,
  hecDeliveryToSplunkEvent,
  logEntryToSplunkEvent,
  diagnosticReportToSplunkEvent,
  dependencyCheckToSplunkEvent,
  connectorStatusToSplunkEvent,
  attestationConfirmedToSplunkEvent,
  attestationFailedToSplunkEvent,
} from './vitals-adapter';
import type {
  AttestationClient,
  AttestationResult,
  CriticalIncident,
  IncidentClassName,
} from './attestation-client';
import { buildSnapshot, commitSnapshot } from './telemetry-commitment';
import type {
  VitalId,
  VitalStatus,
  VitalCheckResult,
  VitalsLogEntry,
  DependencyCheckResult,
  DiagnosticReport,
} from '../../vitals/types';


// ---------------------------------------------------------------------------
// Forwarder Status
// ---------------------------------------------------------------------------

export type ForwarderStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ForwarderState {
  status: ForwarderStatus;
  lastSendTimestamp: number | null;
  totalEventsForwarded: number;
  totalEventsFailed: number;
  errorMessage: string | null;
  splunkHealthy: boolean;
}


// ---------------------------------------------------------------------------
// Forwarder Class
// ---------------------------------------------------------------------------

/**
 * Bridges MidnightVitals events to Splunk HEC.
 *
 * Lifecycle:
 *   1. Create with config
 *   2. Call connect() to verify Splunk is reachable
 *   3. Pass handleVitalCheck / handleLogEntry as callbacks to VitalsProvider
 *   4. Events flow automatically: Vitals → Forwarder → HEC Client → Splunk
 *   5. Call shutdown() for graceful cleanup
 */
export class SplunkForwarder {
  private hecClient: SplunkHecClient;
  private config: ZKSplunkConfig;
  private state: ForwarderState;
  private statusHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private onStateChange: ((state: ForwarderState) => void) | null = null;

  // Optional on-chain attestation backend. When null, attestation is disabled
  // even if config.enableAttestation is true (we log a warning and proceed
  // without attestation).
  private attestationClient: AttestationClient | null = null;

  // Tracks the last-seen status per vital (for status-change detection) and
  // the timestamp of the most recent attestation submission per vital
  // (for min-interval rate limiting). Keys are VitalId.
  private lastStatusByVital: Map<VitalId, VitalStatus> = new Map();
  private lastAttestationAtByVital: Map<VitalId, number> = new Map();

  // Cumulative attestation counters (surfaced via getState()).
  private totalAttestationsSubmitted = 0;
  private totalAttestationsSkipped = 0;
  private totalAttestationsFailed = 0;

  // Whether the polling scheduler is currently active (surfaced in heartbeat).
  private schedulerActive = true;
  private lastHeartbeatFailedTotal = 0;

  // Metadata attached to every event sent to Splunk
  private metadata: {
    dappName: string;
    environment: string;
    hostname: string;
    networkId: string;
  };

  constructor(
    config: ZKSplunkConfig,
    options?: {
      dappName?: string;
      environment?: string;
      hostname?: string;
      networkId?: string;
      onStateChange?: (state: ForwarderState) => void;
      attestationClient?: AttestationClient;
    },
  ) {
    this.config = config;
    this.onStateChange = options?.onStateChange || null;
    this.attestationClient = options?.attestationClient || null;
    this.metadata = {
      dappName: options?.dappName || 'unknown-dapp',
      environment: options?.environment || 'development',
      hostname: options?.hostname || config.splunkHost || (typeof window !== 'undefined' ? window.location.hostname : 'server'),
      networkId: options?.networkId || 'undeployed',
    };

    this.state = {
      status: 'disconnected',
      lastSendTimestamp: null,
      totalEventsForwarded: 0,
      totalEventsFailed: 0,
      errorMessage: null,
      splunkHealthy: false,
    };

    // Create the HEC client with callbacks that update our state
    this.hecClient = new SplunkHecClient(config, {
      onSendSuccess: (eventCount, _responseTimeMs) => {
        this.updateState({
          lastSendTimestamp: Date.now(),
          totalEventsForwarded: this.state.totalEventsForwarded + eventCount,
          status: 'connected',
          errorMessage: null,
          splunkHealthy: true,
        });
      },
      onSendError: (error, _eventCount, attempt) => {
        this.updateState({
          errorMessage: `Send failed (attempt ${attempt}): ${error.message}`,
          status: attempt >= config.retryAttempts ? 'error' : this.state.status,
        });
      },
      onDelivery: (info) => {
        // Emit a `zksplunk.hec.delivery` event ONLY for a recovered delivery
        // (`retry` = it eventually succeeded, so HEC is up and the event can be
        // sent without looping). We deliberately do NOT emit on `failed`: HEC is
        // down, so the event cannot be sent anyway, and re-enqueuing it would
        // generate another failed delivery → another event → an infinite loop.
        // Failed deliveries are captured by the client's JSONL sink and surfaced
        // as cumulative `total_events_failed` in the next connector heartbeat
        // (per ZKSPLUNK_MONITORING_AND_MCP_SPEC.md §9). `success` is omitted to
        // avoid doubling event volume; the heartbeat reports throughput.
        if (info.sendStatus !== 'retry' || this.emittingDelivery) return;
        this.emittingDelivery = true;
        try {
          this.hecClient.enqueue(
            hecDeliveryToSplunkEvent(
              { hecUrl: this.config.splunkHecUrl, ...info },
              this.metadata,
            ),
          );
        } finally {
          this.emittingDelivery = false;
        }
      },
    });
  }

  /** Re-entrancy guard so delivery events don't trigger delivery events. */
  private emittingDelivery = false;

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Verify Splunk HEC connectivity and start the connector heartbeat.
   */
  async connect(): Promise<boolean> {
    this.updateState({ status: 'connecting' });

    if (!this.config.enableSplunkForwarding) {
      this.updateState({
        status: 'disconnected',
        errorMessage: 'Splunk forwarding is disabled in config.',
      });
      return false;
    }

    if (!this.config.splunkHecToken) {
      this.updateState({
        status: 'error',
        errorMessage: 'No Splunk HEC token configured. Set SPLUNK_HEC_TOKEN in .env',
      });
      return false;
    }

    // Test connectivity
    const healthResult = await this.hecClient.healthCheck();

    if (healthResult.healthy) {
      this.updateState({
        status: 'connected',
        splunkHealthy: true,
        errorMessage: null,
      });

      // Start periodic connector heartbeat (configurable, default 60s)
      this.statusHeartbeatTimer = setInterval(() => {
        this.sendConnectorHeartbeat();
      }, this.config.connectorHeartbeatIntervalMs);

      return true;
    } else {
      this.updateState({
        status: 'error',
        splunkHealthy: false,
        errorMessage: healthResult.message,
      });
      return false;
    }
  }

  /**
   * Gracefully shut down: flush remaining events and stop timers.
   */
  async shutdown(): Promise<void> {
    if (this.statusHeartbeatTimer) {
      clearInterval(this.statusHeartbeatTimer);
      this.statusHeartbeatTimer = null;
    }

    await this.hecClient.shutdown();
    this.updateState({ status: 'disconnected' });
  }

  /**
   * Get the current forwarder state (for UI display).
   */
  getState(): ForwarderState {
    return { ...this.state };
  }

  // -----------------------------------------------------------------------
  // Event Handlers (these are the callbacks for VitalsProvider)
  // -----------------------------------------------------------------------

  /**
   * Called when a vital health check completes.
   * Forward the result to Splunk as a structured event.
   *
   * Bind this to VitalsProvider's `onVitalCheck` prop:
   *   <VitalsProvider onVitalCheck={forwarder.handleVitalCheck}>
   */
  handleVitalCheck = (vitalId: VitalId, result: VitalCheckResult): void => {
    if (!this.shouldForward()) return;

    // Decide whether to anchor this check on-chain. The commitment is always
    // computed so it appears in the Splunk event (commitments are cheap);
    // only the on-chain submission is gated.
    const attestationDecision = this.decideAttestation(vitalId, result);

    const splunkEvent = vitalCheckToSplunkEvent(vitalId, result, this.metadata, {
      commitmentHex: attestationDecision.commitmentHex,
      status: attestationDecision.shouldSubmit ? 'pending' : 'skipped',
      skipReason: attestationDecision.skipReason,
    });
    this.hecClient.enqueue(splunkEvent);

    // Update status tracker AFTER the decision so the comparison used the
    // prior status; this lets the first check per vital always attest.
    this.lastStatusByVital.set(vitalId, result.status);

    if (attestationDecision.shouldSubmit) {
      // Fire-and-forget: don't block the HEC pipeline waiting for the chain.
      void this.submitAttestation(vitalId, attestationDecision.commitmentHex, result);
    } else {
      this.totalAttestationsSkipped++;
    }

    if (this.config.enableConsoleLogging) {
      console.log(
        `[ZKSplunk] Vital check: ${vitalId} → ${result.status}` +
          (attestationDecision.shouldSubmit
            ? ` (attesting commitment=${attestationDecision.commitmentHex.slice(0, 12)}…)`
            : ` (attestation skipped: ${attestationDecision.skipReason})`),
      );
    }
  };

  /**
   * Called when a new log entry is added to the vitals console.
   * Forward it to Splunk for centralized log aggregation.
   *
   * Bind this to VitalsProvider's `onLogEntry` prop:
   *   <VitalsProvider onLogEntry={forwarder.handleLogEntry}>
   */
  handleLogEntry = (entry: VitalsLogEntry): void => {
    if (!this.shouldForward()) return;

    const splunkEvent = logEntryToSplunkEvent(entry, this.metadata);
    this.hecClient.enqueue(splunkEvent);

    if (this.config.enableConsoleLogging) {
      console.log(`[ZKSplunk] Log entry: [${entry.level}] ${entry.message}`);
    }
  };

  /**
   * Called when a full diagnostic report completes.
   * Forward the aggregate report to Splunk.
   */
  handleDiagnosticReport = (report: DiagnosticReport): void => {
    if (!this.shouldForward()) return;

    const splunkEvent = diagnosticReportToSplunkEvent(report, this.metadata);
    this.hecClient.enqueue(splunkEvent);

    // Also send individual dependency checks
    report.dependencies.forEach((dep: DependencyCheckResult) => {
      const depEvent = dependencyCheckToSplunkEvent(dep);
      this.hecClient.enqueue(depEvent);
    });

    if (this.config.enableConsoleLogging) {
      console.log(`[ZKSplunk] Diagnostic report: ${report.healthyCount}/${report.totalChecks} healthy`);
    }
  };

  /**
   * Latest-block / chain cadence probe result → `midnight.chain.block_latest`.
   */
  handleChainBlock = (result: VitalCheckResult): void => {
    if (!this.shouldForward()) return;
    this.hecClient.enqueue(chainBlockToSplunkEvent(result, this.metadata));
    if (this.config.enableConsoleLogging) {
      console.log(`[ZKSplunk] Chain block: #${result.blockHeight ?? '?'} → ${result.status}`);
    }
  };

  /**
   * Component version probe result → `midnight.component.version`.
   */
  handleVersion = (component: string, result: VitalCheckResult): void => {
    if (!this.shouldForward()) return;
    this.hecClient.enqueue(componentVersionToSplunkEvent(component, result, this.metadata));
    if (this.config.enableConsoleLogging) {
      console.log(`[ZKSplunk] Version (${component}): ${result.detailLine}`);
    }
  };

  /**
   * Contract monitorability probe result → `midnight.contract.monitorability`.
   */
  handleContractMonitorability = (result: VitalCheckResult): void => {
    if (!this.shouldForward()) return;
    this.hecClient.enqueue(contractMonitorabilityToSplunkEvent(result, this.metadata));
    if (this.config.enableConsoleLogging) {
      console.log(`[ZKSplunk] Contract monitorability → ${result.status}`);
    }
  };

  /**
   * Wallet boundary probe result → `midnight.wallet.boundary`.
   */
  handleWalletBoundary = (result: VitalCheckResult): void => {
    if (!this.shouldForward()) return;
    this.hecClient.enqueue(walletBoundaryToSplunkEvent(result, this.metadata));
  };

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Check if we should be forwarding events right now.
   */
  private shouldForward(): boolean {
    return this.config.enableSplunkForwarding && this.state.status !== 'disconnected';
  }

  /**
   * Send a connector heartbeat event so Splunk knows ZKSplunk is alive.
   */
  private sendConnectorHeartbeat(): void {
    const stats = this.hecClient.getStats();
    const failedEventsSinceLastHeartbeat = Math.max(0, stats.totalEventsFailed - this.lastHeartbeatFailedTotal);
    this.lastHeartbeatFailedTotal = stats.totalEventsFailed;
    const heartbeatEvent = connectorStatusToSplunkEvent(
      { ...stats, schedulerActive: this.schedulerActive, failedEventsSinceLastHeartbeat },
      this.metadata,
    );
    this.hecClient.enqueue(heartbeatEvent);
  }

  /** Let the orchestrator report whether its polling loop is running. */
  setSchedulerActive(active: boolean): void {
    this.schedulerActive = active;
  }

  /**
   * Update internal state and notify listeners.
   */
  private updateState(partial: Partial<ForwarderState>): void {
    this.state = { ...this.state, ...partial };
    this.onStateChange?.(this.state);
  }

  // -----------------------------------------------------------------------
  // On-Chain Attestation
  // -----------------------------------------------------------------------

  /**
   * Get cumulative attestation counters plus the most recent attestation
   * timestamp per vital. Useful for dashboards and debugging.
   */
  getAttestationStats() {
    return {
      enabled: this.isAttestationEnabled(),
      backend: this.attestationClient?.backendName ?? 'none',
      totalSubmitted: this.totalAttestationsSubmitted,
      totalSkipped: this.totalAttestationsSkipped,
      totalFailed: this.totalAttestationsFailed,
      lastAttestationAt: Object.fromEntries(this.lastAttestationAtByVital),
    };
  }

  /** Whether attestation is both configured and has a usable backend. */
  private isAttestationEnabled(): boolean {
    return (
      this.config.enableAttestation &&
      !!this.config.attestationContractAddress &&
      !!this.attestationClient
    );
  }

  /**
   * Decide whether to submit an on-chain attestation for this vital check.
   * Always returns the computed commitment (cheap to derive) so the Splunk
   * event can carry it regardless of submission.
   */
  private decideAttestation(
    vitalId: VitalId,
    result: VitalCheckResult,
  ): {
    commitmentHex: string;
    shouldSubmit: boolean;
    skipReason: string | null;
  } {
    const snapshot = buildSnapshot(
      this.vitalIdToComponent(vitalId),
      this.config.attestationNetwork,
      null, // block height is populated by providers that know it
      {
        vitalId,
        status: result.status,
        message: result.message,
        detailLine: result.detailLine,
        responseTimeMs: result.responseTimeMs,
        dappName: this.metadata.dappName,
        environment: this.metadata.environment,
      },
    );
    const commitmentHex = commitSnapshot(snapshot);

    if (!this.isAttestationEnabled()) {
      return { commitmentHex, shouldSubmit: false, skipReason: 'disabled' };
    }

    // Critical-only gate: the attestCriticalIncident circuit is exclusively
    // for CRITICAL alarms. Healthy, warning, degraded, unknown, and tracked
    // vitals are never submitted on-chain — only status === 'critical' triggers
    // an anonymous ZK attestation. This avoids polluting the on-chain incident
    // log with routine noise and matches the contract's intended semantics.
    if (result.status !== 'critical') {
      return { commitmentHex, shouldSubmit: false, skipReason: 'unchanged' };
    }

    // Only-on-status-change gate
    if (this.config.attestOnlyOnStatusChange) {
      const priorStatus = this.lastStatusByVital.get(vitalId);
      if (priorStatus !== undefined && priorStatus === result.status) {
        return { commitmentHex, shouldSubmit: false, skipReason: 'unchanged' };
      }
    }

    // Min-interval rate limit per vital
    const lastAt = this.lastAttestationAtByVital.get(vitalId) ?? 0;
    const sinceLast = Date.now() - lastAt;
    if (sinceLast < this.config.attestationMinIntervalMs) {
      return { commitmentHex, shouldSubmit: false, skipReason: 'rate_limited' };
    }

    // Probabilistic sampling (skipped if we're attesting on every status change
    // since status changes are already rare). A rate of 1.0 always submits.
    if (
      !this.config.attestOnlyOnStatusChange &&
      this.config.attestationSamplingRate < 1 &&
      Math.random() >= this.config.attestationSamplingRate
    ) {
      return { commitmentHex, shouldSubmit: false, skipReason: 'sampled_out' };
    }

    return { commitmentHex, shouldSubmit: true, skipReason: null };
  }

  /**
   * Map a VitalId to an IncidentClassName for the attestCriticalIncident circuit.
   *
   * Vitals that do not map cleanly to a specific class default to 'block-stall'
   * as a catch-all infrastructure anomaly. This is conservative — operators can
   * refine the map as new vital categories are added.
   */
  private vitalIdToIncidentClass(vitalId: VitalId): IncidentClassName {
    switch (vitalId) {
      case 'proof-server': return 'proof-server-outage';
      case 'indexer':      return 'block-stall';   // indexer outage blocks chain data
      case 'network':      return 'block-stall';   // legacy combined vital
      case 'node':         return 'block-stall';
      case 'contracts':    return 'block-stall';
      case 'wallet':       return 'wallet-drain';
      default:             return 'block-stall';
    }
  }

  /**
   * Submit a critical-incident attestation to the on-chain zksplunk contract
   * and emit the resulting confirmation / failure event to Splunk.
   * Never throws — all errors are captured as `midnight.attestation.failed`.
   *
   * Only called when result.status === 'critical' and attestation is enabled.
   */
  private async submitAttestation(
    vitalId: VitalId,
    commitmentHex: string,
    result: VitalCheckResult,
  ): Promise<void> {
    if (!this.attestationClient) {
      // Defensive — decideAttestation should have short-circuited already.
      return;
    }

    // Record submission time BEFORE the network call so rapid successive
    // checks don't pile up parallel txs.
    this.lastAttestationAtByVital.set(vitalId, Date.now());

    // Build the structured incident input — uses the new circuit interface.
    const incidentInput: CriticalIncident = {
      incidentClass: this.vitalIdToIncidentClass(vitalId),
      severity: 'critical',
      payloadCommitmentHex: commitmentHex,
    };

    try {
      const attestResult: AttestationResult =
        await this.attestationClient.attestCriticalIncident(incidentInput);
      this.totalAttestationsSubmitted++;

      const confirmedEvent = attestationConfirmedToSplunkEvent(vitalId, attestResult, {
        dappName: this.metadata.dappName,
        environment: this.metadata.environment,
        network: this.config.attestationNetwork,
        contractAddress: this.config.attestationContractAddress,
      });
      this.hecClient.enqueue(confirmedEvent);

      if (this.config.enableConsoleLogging) {
        console.log(
          `[ZKSplunk] Attestation confirmed: vital=${vitalId} seq=${attestResult.sequence} ` +
            `tx=${attestResult.txHash.slice(0, 16)}… incidentClass=${incidentInput.incidentClass}`,
        );
      }
    } catch (error) {
      this.totalAttestationsFailed++;
      const err = error instanceof Error ? error : new Error(String(error));

      const failedEvent = attestationFailedToSplunkEvent(vitalId, commitmentHex, err, {
        dappName: this.metadata.dappName,
        environment: this.metadata.environment,
        network: this.config.attestationNetwork,
      });
      this.hecClient.enqueue(failedEvent);

      if (this.config.enableConsoleLogging) {
        console.warn(
          `[ZKSplunk] Attestation FAILED: vital=${vitalId} commitment=${commitmentHex.slice(0, 12)}… — ${err.message}`,
        );
      }
    }
  }

  /**
   * Map VitalId to the telemetry-commitment `component` discriminator.
   * Any unknown vital (from extensions like attack-signal VitalIds) is
   * classified as 'composite' so auditors can still reconcile.
   */
  private vitalIdToComponent(
    vitalId: VitalId,
  ): 'proof-server' | 'network' | 'wallet' | 'contracts' | 'composite' {
    switch (vitalId) {
      case 'proof-server':
      case 'network':
      case 'wallet':
      case 'contracts':
        return vitalId;
      default:
        return 'composite';
    }
  }
}
