// =============================================================================
// ZKSplunk — Vitals-to-Splunk Event Adapter
// =============================================================================
// Transforms MidnightVitals internal types (VitalCheckResult, VitalsLogEntry,
// DiagnosticReport) into Splunk HEC event format with ZK-specific fields.
//
// This is where domain knowledge lives: it knows what a "proof server" is,
// what latency thresholds matter for ZK proofs, and how to enrich events
// with blockchain-specific metadata that Splunk dashboards can query.
// =============================================================================


import type { SplunkHecEvent } from './hec-client';
import type { AttestationResult } from './attestation-client';
import type {
  VitalId,
  VitalStatus,
  VitalCheckResult,
  VitalsLogEntry,
  DependencyCheckResult,
  DiagnosticReport,
  VitalMonitor,
} from '../../vitals/types';


// ---------------------------------------------------------------------------
// Event Type Constants
// ---------------------------------------------------------------------------
// These become the `event.type` field in Splunk, enabling filtered searches
// like: `sourcetype="midnight:vitals" event.type="vital.check"`

export const SPLUNK_EVENT_TYPES = {
  VITAL_CHECK: 'midnight.vital.check',
  CHAIN_BLOCK_LATEST: 'midnight.chain.block_latest',
  COMPONENT_VERSION: 'midnight.component.version',
  CONTRACT_MONITORABILITY: 'midnight.contract.monitorability',
  WALLET_BOUNDARY: 'midnight.wallet.boundary',
  LOG_ENTRY: 'midnight.vital.log',
  DIAGNOSTIC_REPORT: 'midnight.diagnostic.report',
  DEPENDENCY_CHECK: 'midnight.dependency.check',
  CONNECTOR_STATUS: 'zksplunk.connector.status',
  HEC_DELIVERY: 'zksplunk.hec.delivery',
  ATTESTATION_PENDING: 'midnight.attestation.pending',
  ATTESTATION_CONFIRMED: 'midnight.attestation.confirmed',
  ATTESTATION_FAILED: 'midnight.attestation.failed',
} as const;

/** Recommended sourcetypes (ZKSPLUNK_MONITORING_AND_MCP_SPEC.md). */
export const SPLUNK_SOURCETYPES = {
  VITALS: 'midnight:vitals',
  CHAIN: 'midnight:chain',
  CONNECTOR: 'zksplunk:connector',
  CONTRACTS: 'midnight:contracts',
} as const;

/**
 * Shared event metadata attached to every HEC event. `networkId` defaults to
 * the local `undeployed` value the spec expects.
 */
export interface EventMetadata {
  dappName?: string;
  environment?: string;
  hostname?: string;
  networkId?: string;
}

/** Map a VitalId to the stable `component` id used in the HEC envelope. */
export function vitalIdToComponentId(vitalId: VitalId): string {
  switch (vitalId) {
    case 'network':
      return 'indexer'; // legacy combined vital reported as indexer
    default:
      return vitalId;
  }
}


// ---------------------------------------------------------------------------
// Severity Mapping
// ---------------------------------------------------------------------------
// Maps MidnightVitals status/log levels to Splunk severity conventions.
// Splunk uses these for color-coding and alert thresholds.

const STATUS_TO_SEVERITY: Record<VitalStatus, string> = {
  healthy: 'info',
  warning: 'warn',
  critical: 'critical',
  unknown: 'info',
  tracked: 'info', // actively observing public data (e.g. unshielded wallet activity)
};

const LOG_LEVEL_TO_SEVERITY: Record<string, string> = {
  action: 'info',
  info: 'info',
  success: 'info',
  warning: 'warn',
  error: 'error',
};


// ---------------------------------------------------------------------------
// Adapter Functions
// ---------------------------------------------------------------------------

/**
 * Convert a vital health check result into a Splunk HEC event.
 *
 * Example Splunk search after ingestion:
 *   sourcetype="midnight:vitals" type="midnight.vital.check" vital_id="proof-server"
 *   | timechart avg(response_time_ms) by vital_id
 */
/**
 * Build the common `event` fields every probe event must carry (per the HEC
 * Event Envelope in the spec). Returns only defined keys to keep events tidy.
 */
function commonEventFields(
  component: string,
  result: VitalCheckResult,
  metadata?: EventMetadata,
): Record<string, any> {
  const fields: Record<string, any> = {
    component,
    status: result.status,
    severity: STATUS_TO_SEVERITY[result.status],
    message: result.message,
    detail_line: result.detailLine,
    response_time_ms: result.responseTimeMs,
    environment: metadata?.environment || 'development',
    network_id: metadata?.networkId || 'undeployed',
    dapp_name: metadata?.dappName || 'unknown',
    probe_name: result.probeName ?? null,
    endpoint: result.endpoint ?? null,
    error_name: result.errorName ?? null,
    error_message: result.errorMessage ?? null,
  };
  if (result.httpStatus !== undefined) fields.http_status = result.httpStatus;
  if (result.graphqlErrorsCount !== undefined) fields.graphql_errors_count = result.graphqlErrorsCount;
  if (result.unsupportedProbe !== undefined) fields.unsupported_probe = result.unsupportedProbe;
  if (result.extra) Object.assign(fields, result.extra);
  return fields;
}

export function vitalCheckToSplunkEvent(
  vitalId: VitalId,
  result: VitalCheckResult,
  metadata?: EventMetadata,
  attestation?: {
    commitmentHex: string;
    status: 'pending' | 'confirmed' | 'failed' | 'skipped';
    txHash?: string | null;
    sequence?: number | null;
    skipReason?: string | null;
  },
): SplunkHecEvent {
  const component = vitalIdToComponentId(vitalId);
  return {
    time: Date.now() / 1000,
    sourcetype: SPLUNK_SOURCETYPES.VITALS,
    host: metadata?.hostname,
    event: {
      type: SPLUNK_EVENT_TYPES.VITAL_CHECK,
      vital_id: vitalId,
      vital_label: VITAL_LABELS[vitalId],
      ...commonEventFields(component, result, metadata),
      // ZK-specific enrichment
      is_zk_component: vitalId === 'proof-server',
      component_category: VITAL_CATEGORIES[vitalId],
      // On-chain attestation linkage (optional)
      attestation_commitment: attestation?.commitmentHex || null,
      attestation_status: attestation?.status || 'not_attested',
      attestation_tx_hash: attestation?.txHash || null,
      attestation_seq: attestation?.sequence ?? null,
      attestation_skip_reason: attestation?.skipReason || null,
    },
  };
}

/**
 * Latest-block / chain cadence event (sourcetype `midnight:chain`).
 */
export function chainBlockToSplunkEvent(
  result: VitalCheckResult,
  metadata?: EventMetadata,
): SplunkHecEvent {
  return {
    time: Date.now() / 1000,
    sourcetype: SPLUNK_SOURCETYPES.CHAIN,
    host: metadata?.hostname,
    event: {
      type: SPLUNK_EVENT_TYPES.CHAIN_BLOCK_LATEST,
      ...commonEventFields('indexer', result, metadata),
      block_height: result.blockHeight ?? null,
      block_hash: result.blockHash ?? null,
      block_timestamp: result.blockTimestamp ?? null,
      block_age_seconds: result.blockAgeSeconds ?? null,
    },
  };
}

/**
 * Component version event (sourcetype `midnight:vitals`).
 */
export function componentVersionToSplunkEvent(
  component: string,
  result: VitalCheckResult,
  metadata?: EventMetadata,
): SplunkHecEvent {
  return {
    time: Date.now() / 1000,
    sourcetype: SPLUNK_SOURCETYPES.VITALS,
    host: metadata?.hostname,
    event: {
      type: SPLUNK_EVENT_TYPES.COMPONENT_VERSION,
      ...commonEventFields(component, result, metadata),
    },
  };
}

/**
 * Contract monitorability event (sourcetype `midnight:contracts`).
 */
export function contractMonitorabilityToSplunkEvent(
  result: VitalCheckResult,
  metadata?: EventMetadata,
): SplunkHecEvent {
  return {
    time: Date.now() / 1000,
    sourcetype: SPLUNK_SOURCETYPES.CONTRACTS,
    host: metadata?.hostname,
    event: {
      type: SPLUNK_EVENT_TYPES.CONTRACT_MONITORABILITY,
      ...commonEventFields('contracts', result, metadata),
    },
  };
}

/**
 * Wallet boundary event (sourcetype `midnight:vitals`).
 */
export function walletBoundaryToSplunkEvent(
  result: VitalCheckResult,
  metadata?: EventMetadata,
): SplunkHecEvent {
  return {
    time: Date.now() / 1000,
    sourcetype: SPLUNK_SOURCETYPES.VITALS,
    host: metadata?.hostname,
    event: {
      type: SPLUNK_EVENT_TYPES.WALLET_BOUNDARY,
      ...commonEventFields('wallet', result, metadata),
    },
  };
}

/**
 * HEC delivery health event (sourcetype `zksplunk:connector`). Emitted from the
 * HEC client's send callbacks. Note: if HEC itself is down this event can't be
 * sent — it is captured by the JSONL sink and summarised in the next heartbeat.
 */
export function hecDeliveryToSplunkEvent(
  delivery: {
    hecUrl: string;
    batchEventCount: number;
    sendAttempt: number;
    sendStatus: 'success' | 'retry' | 'failed';
    hecResponseCode: number | null;
    responseTimeMs: number | null;
    errorName?: string | null;
    errorMessage?: string | null;
  },
  metadata?: EventMetadata,
): SplunkHecEvent {
  const severity =
    delivery.sendStatus === 'success'
      ? 'info'
      : delivery.sendStatus === 'retry'
        ? 'warn'
        : 'critical';
  return {
    time: Date.now() / 1000,
    sourcetype: SPLUNK_SOURCETYPES.CONNECTOR,
    host: metadata?.hostname,
    event: {
      type: SPLUNK_EVENT_TYPES.HEC_DELIVERY,
      component: 'connector',
      severity,
      hec_url: delivery.hecUrl,
      batch_event_count: delivery.batchEventCount,
      send_attempt: delivery.sendAttempt,
      send_status: delivery.sendStatus,
      hec_response_code: delivery.hecResponseCode,
      response_time_ms: delivery.responseTimeMs,
      error_name: delivery.errorName ?? null,
      error_message: delivery.errorMessage ?? null,
      environment: metadata?.environment || 'development',
      dapp_name: metadata?.dappName || 'unknown',
    },
  };
}


/**
 * Build a `midnight.attestation.confirmed` event emitted asynchronously
 * once a commitment has been anchored on-chain. Links back to the vital
 * check event via the shared `attestation_commitment` field.
 */
export function attestationConfirmedToSplunkEvent(
  vitalId: VitalId,
  result: AttestationResult,
  metadata?: {
    dappName?: string;
    environment?: string;
    network?: string;
    contractAddress?: string;
  },
): SplunkHecEvent {
  return {
    time: Date.now() / 1000,
    event: {
      type: SPLUNK_EVENT_TYPES.ATTESTATION_CONFIRMED,
      vital_id: vitalId,
      vital_label: VITAL_LABELS[vitalId],
      severity: 'info',
      attestation_commitment: result.commitmentHex,
      attestation_tx_hash: result.txHash,
      attestation_seq: result.sequence,
      attestation_block_height: result.blockHeight,
      attestation_latency_ms: result.latencyMs,
      attestation_network: metadata?.network || 'unknown',
      attestation_contract: metadata?.contractAddress || 'unknown',
      dapp_name: metadata?.dappName || 'unknown',
      environment: metadata?.environment || 'development',
    },
  };
}


/**
 * Build a `midnight.attestation.failed` event when on-chain submission errors.
 */
export function attestationFailedToSplunkEvent(
  vitalId: VitalId,
  commitmentHex: string,
  error: Error,
  metadata?: {
    dappName?: string;
    environment?: string;
    network?: string;
  },
): SplunkHecEvent {
  return {
    time: Date.now() / 1000,
    event: {
      type: SPLUNK_EVENT_TYPES.ATTESTATION_FAILED,
      vital_id: vitalId,
      vital_label: VITAL_LABELS[vitalId],
      severity: 'warn',
      attestation_commitment: commitmentHex,
      error_message: error.message,
      error_name: error.name,
      attestation_network: metadata?.network || 'unknown',
      dapp_name: metadata?.dappName || 'unknown',
      environment: metadata?.environment || 'development',
    },
  };
}


/**
 * Convert a vitals console log entry into a Splunk HEC event.
 *
 * Example Splunk search:
 *   sourcetype="midnight:vitals" type="midnight.vital.log" level="error"
 *   | table _time, message, detail, suggestion
 */
export function logEntryToSplunkEvent(
  entry: VitalsLogEntry,
  metadata?: {
    dappName?: string;
    environment?: string;
  },
): SplunkHecEvent {
  return {
    time: entry.timestamp / 1000,  // Convert ms to seconds for Splunk
    event: {
      type: SPLUNK_EVENT_TYPES.LOG_ENTRY,
      log_id: entry.id,
      level: entry.level,
      severity: LOG_LEVEL_TO_SEVERITY[entry.level] || 'info',
      message: entry.message,
      detail: entry.detail || null,
      suggestion: entry.suggestion || null,
      has_suggestion: !!entry.suggestion,
      dapp_name: metadata?.dappName || 'unknown',
      environment: metadata?.environment || 'development',
    },
  };
}


/**
 * Convert a full diagnostic report into a Splunk HEC event.
 *
 * Example Splunk search:
 *   sourcetype="midnight:vitals" type="midnight.diagnostic.report"
 *   | stats latest(healthy_count) as healthy, latest(total_checks) as total by dapp_name
 */
export function diagnosticReportToSplunkEvent(
  report: DiagnosticReport,
  metadata?: {
    dappName?: string;
    environment?: string;
  },
): SplunkHecEvent {
  // Calculate per-vital status for the report
  const vitalStatuses: Record<string, string> = {};
  report.vitals.forEach((v: VitalMonitor) => {
    vitalStatuses[`vital_${v.id.replace('-', '_')}_status`] = v.status;
  });

  return {
    time: report.timestamp / 1000,
    event: {
      type: SPLUNK_EVENT_TYPES.DIAGNOSTIC_REPORT,
      total_checks: report.totalChecks,
      healthy_count: report.healthyCount,
      health_percentage: report.totalChecks > 0
        ? Math.round((report.healthyCount / report.totalChecks) * 100)
        : 0,
      summary: report.summary,
      // Individual vital statuses as flat fields for easy Splunk queries
      ...vitalStatuses,
      // Dependency results
      dependencies_checked: report.dependencies.length,
      dependencies_installed: report.dependencies.filter((d: DependencyCheckResult) => d.installed).length,
      dapp_name: metadata?.dappName || 'unknown',
      environment: metadata?.environment || 'development',
    },
  };
}


/**
 * Convert a dependency check result into a Splunk HEC event.
 */
export function dependencyCheckToSplunkEvent(
  dep: DependencyCheckResult,
): SplunkHecEvent {
  return {
    time: Date.now() / 1000,
    event: {
      type: SPLUNK_EVENT_TYPES.DEPENDENCY_CHECK,
      dependency_name: dep.name,
      installed: dep.installed,
      version: dep.version,
      message: dep.message,
      severity: dep.installed ? 'info' : 'warn',
    },
  };
}


/**
 * Create a connector status event (ZKSplunk's own heartbeat).
 * Sent periodically so Splunk knows the connector itself is alive.
 */
export function connectorStatusToSplunkEvent(
  stats: {
    totalEventsSent: number;
    totalEventsFailed: number;
    totalBatchesSent: number;
    averageLatencyMs: number;
    queuedEvents: number;
    schedulerActive?: boolean;
    localFailedDeliveries?: number;
    failedEventsSinceLastHeartbeat?: number;
  },
  metadata?: EventMetadata,
): SplunkHecEvent {
  const failed = stats.totalEventsFailed + (stats.localFailedDeliveries ?? 0);
  const recentFailed = stats.failedEventsSinceLastHeartbeat ?? 0;
  const severity =
    recentFailed > 0 ? 'critical' : stats.queuedEvents > 0 || stats.averageLatencyMs > 1000 ? 'warn' : 'info';
  return {
    time: Date.now() / 1000,
    sourcetype: SPLUNK_SOURCETYPES.CONNECTOR,
    host: metadata?.hostname,
    event: {
      type: SPLUNK_EVENT_TYPES.CONNECTOR_STATUS,
      component: 'connector',
      connector_name: 'ZKSplunk',
      connector_version: '0.1.0',
      severity,
      total_events_sent: stats.totalEventsSent,
      total_events_failed: failed,
      failed_events_since_last_heartbeat: recentFailed,
      total_batches_sent: stats.totalBatchesSent,
      average_latency_ms: stats.averageLatencyMs,
      queued_events: stats.queuedEvents,
      scheduler_active: stats.schedulerActive ?? true,
      uptime_check: true,
      environment: metadata?.environment || 'development',
      dapp_name: metadata?.dappName || 'unknown',
    },
  };
}


// ---------------------------------------------------------------------------
// Lookup Tables
// ---------------------------------------------------------------------------

const VITAL_LABELS: Record<VitalId, string> = {
  'proof-server': 'Proof Server',
  'network': 'Network / Indexer',
  'indexer': 'Indexer',
  'node': 'Node',
  'wallet': 'Wallet',
  'contracts': 'Smart Contracts',
};

const VITAL_CATEGORIES: Record<VitalId, string> = {
  'proof-server': 'zk-infrastructure',
  'network': 'blockchain-network',
  'indexer': 'blockchain-network',
  'node': 'blockchain-network',
  'wallet': 'user-interface',
  'contracts': 'smart-contracts',
};
