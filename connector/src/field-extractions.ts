// =============================================================================
// ZKSplunk — Splunk Field Extractions & Saved Searches
// =============================================================================
// Defines the ZK-specific field extractions and pre-built SPL queries
// that make Midnight blockchain data searchable and dashboardable in Splunk.
//
// These are exported as structured data so they can be:
//   1. Used programmatically by the connector
//   2. Written to Splunk app config files (props.conf, transforms.conf)
//   3. Referenced by the AI agent for natural-language queries
// =============================================================================


// ---------------------------------------------------------------------------
// Field Extractions
// ---------------------------------------------------------------------------
// These define how Splunk should parse and index ZKSplunk events.
// Each extraction maps a JSON path to a named Splunk field.

export const ZKSPLUNK_FIELD_EXTRACTIONS = {
  // Vital check fields
  vital_id: {
    description: 'Which component was checked (proof-server, network, wallet, contracts)',
    jsonPath: 'event.vital_id',
    fieldType: 'string',
    indexed: true,
    exampleValues: ['proof-server', 'network', 'wallet', 'contracts'],
  },
  vital_status: {
    description: 'Health status of the checked component',
    jsonPath: 'event.status',
    fieldType: 'string',
    indexed: true,
    exampleValues: ['healthy', 'warning', 'critical', 'unknown', 'tracked'],
  },
  response_time_ms: {
    description: 'Response latency in milliseconds. Null if component is unreachable.',
    jsonPath: 'event.response_time_ms',
    fieldType: 'number',
    indexed: false,
    exampleValues: [42, 150, 380, null],
  },
  is_zk_component: {
    description: 'Whether this vital monitors ZK-proof infrastructure specifically',
    jsonPath: 'event.is_zk_component',
    fieldType: 'boolean',
    indexed: true,
    exampleValues: [true, false],
  },
  component_category: {
    description: 'Functional category of the monitored component',
    jsonPath: 'event.component_category',
    fieldType: 'string',
    indexed: true,
    exampleValues: ['zk-infrastructure', 'blockchain-network', 'user-interface', 'smart-contracts'],
  },

  // Log entry fields
  log_level: {
    description: 'Severity level of the log entry',
    jsonPath: 'event.level',
    fieldType: 'string',
    indexed: true,
    exampleValues: ['action', 'info', 'success', 'warning', 'error'],
  },
  log_message: {
    description: 'Human-readable log message in plain English',
    jsonPath: 'event.message',
    fieldType: 'string',
    indexed: false,
    exampleValues: ['The proof server is running and responded in 42ms.'],
  },
  has_suggestion: {
    description: 'Whether the log entry includes a remediation suggestion',
    jsonPath: 'event.has_suggestion',
    fieldType: 'boolean',
    indexed: true,
    exampleValues: [true, false],
  },

  // Diagnostic report fields
  health_percentage: {
    description: 'Overall health percentage from the last diagnostic run',
    jsonPath: 'event.health_percentage',
    fieldType: 'number',
    indexed: true,
    exampleValues: [100, 75, 50, 0],
  },

  // Metadata fields
  dapp_name: {
    description: 'Name of the Midnight DApp being monitored',
    jsonPath: 'event.dapp_name',
    fieldType: 'string',
    indexed: true,
    exampleValues: ['DiscoveryManagement', 'proofOrBluff', 'KYCz'],
  },
  environment: {
    description: 'Deployment environment',
    jsonPath: 'event.environment',
    fieldType: 'string',
    indexed: true,
    exampleValues: ['development', 'staging', 'production', 'testnet', 'mainnet'],
  },
  event_type: {
    description: 'Type of ZKSplunk event',
    jsonPath: 'event.type',
    fieldType: 'string',
    indexed: true,
    exampleValues: [
      'midnight.vital.check',
      'midnight.vital.log',
      'midnight.diagnostic.report',
      'midnight.dependency.check',
      'zksplunk.connector.status',
    ],
  },
} as const;


// ---------------------------------------------------------------------------
// Saved Searches (Pre-built SPL Queries)
// ---------------------------------------------------------------------------
// These are ready-to-use Splunk searches for the ZKSplunk dashboard.
// They can be imported into a Splunk app's savedsearches.conf.

export const ZKSPLUNK_SAVED_SEARCHES = {

  // --- Overview Dashboard ---

  /** Current status of all 4 vitals (latest check per vital) */
  currentVitalStatus: {
    name: 'ZKSplunk - Current Vital Status',
    description: 'Shows the most recent health check result for each monitored component.',
    search: `sourcetype="midnight:vitals" type="midnight.vital.check"
| dedup vital_id sortby -_time
| table vital_id, status, response_time_ms, message, _time
| sort vital_id`,
    cronSchedule: '*/5 * * * *',
    alertCondition: 'where status="critical"',
  },

  /** Proof server latency over time */
  proofServerLatencyTimechart: {
    name: 'ZKSplunk - Proof Server Latency Over Time',
    description: 'Time chart of proof server response times. Spikes indicate potential issues.',
    search: `sourcetype="midnight:vitals" type="midnight.vital.check" vital_id="proof-server" response_time_ms!=null
| timechart avg(response_time_ms) as avg_latency, p95(response_time_ms) as p95_latency, max(response_time_ms) as max_latency`,
  },

  /** All critical events in the last hour */
  recentCriticalEvents: {
    name: 'ZKSplunk - Recent Critical Events',
    description: 'All critical-severity events from the last hour.',
    search: `sourcetype="midnight:vitals" (status="critical" OR severity="critical" OR level="error") earliest=-1h
| table _time, type, vital_id, level, message, suggestion
| sort -_time`,
    cronSchedule: '*/5 * * * *',
    alertCondition: 'where count > 0',
  },

  // --- Proof Server Deep Dive ---

  /** Proof server availability percentage */
  proofServerAvailability: {
    name: 'ZKSplunk - Proof Server Availability',
    description: 'Percentage of time the proof server has been healthy.',
    search: `sourcetype="midnight:vitals" type="midnight.vital.check" vital_id="proof-server"
| eval is_healthy=if(status="healthy", 1, 0)
| stats avg(is_healthy) as availability_pct
| eval availability_pct=round(availability_pct*100, 2)`,
  },

  /** Proof server status transitions (when did it go from healthy to critical?) */
  proofServerTransitions: {
    name: 'ZKSplunk - Proof Server Status Changes',
    description: 'Shows when the proof server transitioned between statuses.',
    search: `sourcetype="midnight:vitals" type="midnight.vital.check" vital_id="proof-server"
| sort _time
| streamstats current=f last(status) as prev_status
| where status!=prev_status
| table _time, prev_status, status, response_time_ms, message`,
  },

  // --- Wallet & Contracts ---

  /** Wallet connection state over time */
  walletConnectionTimeline: {
    name: 'ZKSplunk - Wallet Connection Timeline',
    description: 'Shows when the wallet was connected vs disconnected.',
    search: `sourcetype="midnight:vitals" type="midnight.vital.check" vital_id="wallet"
| timechart count by status`,
  },

  /** Smart contract health by contract */
  contractHealthSummary: {
    name: 'ZKSplunk - Contract Health Summary',
    description: 'Latest health status of all monitored smart contracts.',
    search: `sourcetype="midnight:vitals" type="midnight.vital.check" vital_id="contracts"
| dedup _time sortby -_time
| table _time, status, detail_line, message`,
  },

  // --- Network ---

  /** Network indexer sync status */
  networkSyncStatus: {
    name: 'ZKSplunk - Network Sync Status',
    description: 'Network indexer response time and sync lag over time.',
    search: `sourcetype="midnight:vitals" type="midnight.vital.check" vital_id="network"
| timechart avg(response_time_ms) as avg_latency, count(eval(status="critical")) as outages`,
  },

  // --- Multi-DApp (Enterprise) ---

  /** Health overview across all monitored DApps */
  multiDappOverview: {
    name: 'ZKSplunk - Multi-DApp Health Overview',
    description: 'Aggregate health status across all Midnight DApps reporting to Splunk.',
    search: `sourcetype="midnight:vitals" type="midnight.vital.check"
| stats latest(status) as current_status, avg(response_time_ms) as avg_latency by dapp_name, vital_id
| sort dapp_name, vital_id`,
  },

  // --- Connector Health ---

  /** ZKSplunk connector heartbeat */
  connectorHeartbeat: {
    name: 'ZKSplunk - Connector Heartbeat',
    description: 'Confirms the ZKSplunk connector is alive and forwarding events.',
    search: `sourcetype="midnight:vitals" type="zksplunk.connector.status"
| table _time, total_events_sent, total_events_failed, average_latency_ms, queued_events
| sort -_time
| head 10`,
  },

} as const;
