// =============================================================================
// ZKSplunk — Connector Entry Point
// =============================================================================
// Re-exports everything from the connector module for clean imports.
//
// Usage:
//   import { SplunkForwarder, SplunkHecClient, loadConfigFromEnvironment } from './connector';
// =============================================================================


// Configuration
export { loadConfigFromEnvironment, DEFAULT_CONFIG } from './config';
export type { ZKSplunkConfig } from './config';

// HEC Client
export { SplunkHecClient } from './hec-client';
export type { SplunkHecEvent, SplunkHecResponse, HecClientCallbacks, HecDeliveryInfo } from './hec-client';

// Local JSONL sink
export { JsonlSink } from './jsonl-sink';

// Probe result sanitizer
export { sanitizeText, sanitizeEndpoint, sanitizeResult } from './sanitize';

// Splunk Forwarder (the main integration class)
export { SplunkForwarder } from './splunk-forwarder';
export type { ForwarderStatus, ForwarderState } from './splunk-forwarder';

// Vitals-to-Splunk Adapter
export {
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
  vitalIdToComponentId,
  SPLUNK_EVENT_TYPES,
  SPLUNK_SOURCETYPES,
} from './vitals-adapter';
export type { EventMetadata } from './vitals-adapter';

// Field Extractions (for Splunk app configuration)
export {
  ZKSPLUNK_FIELD_EXTRACTIONS,
  ZKSPLUNK_SAVED_SEARCHES,
} from './field-extractions';

// On-chain attestation
export {
  MockAttestationClient,
  LoggingAttestationClient,
} from './attestation-client';
export type {
  AttestationClient,
  AttestationResult,
  MockAttestationClientOptions,
} from './attestation-client';

// Telemetry commitment helpers (for custom attestation flows)
export {
  canonicalStringify,
  commitSnapshot,
  buildSnapshot,
} from './telemetry-commitment';
export type { TelemetrySnapshot } from './telemetry-commitment';
