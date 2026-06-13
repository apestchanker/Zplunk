// =============================================================================
// ZKSplunk — Configuration
// =============================================================================
// Reads environment variables and provides typed config for the connector.
// All Splunk and Midnight connection details are configured here.
// =============================================================================


/**
 * Complete configuration for the ZKSplunk connector.
 * Loaded from environment variables or passed directly.
 */
export interface ZKSplunkConfig {
  // Splunk HTTP Event Collector (HEC) settings
  splunkHecUrl: string;             // Cloud: "https://<instance>.splunkcloud.com:8088". Local: use :8090 (8088 collides with the Midnight indexer).
  splunkHecToken: string;           // HEC authentication token
  splunkIndex: string;              // Target index (default: "zksplunk")
  splunkSourcetype: string;         // Default sourcetype for events (default: "midnight:vitals")
  splunkSource: string;             // Source identifier (default: "zksplunk-connector")
  splunkHost: string;               // `host` field for the HEC envelope (default: machine hostname)

  // Midnight infrastructure endpoints
  midnightProofServerUrl: string;   // e.g., "http://localhost:6300"
  midnightIndexerUrl: string;       // midnight-local-dev: "http://localhost:8088/api/v4/graphql"
  midnightNodeUrl: string;          // e.g., "http://localhost:9944"

  // Proof server probe paths (configurable because different builds differ)
  proofServerHealthPath: string;    // default: "/health"
  proofServerVersionPath: string;   // default: "/version"

  // Polling intervals (milliseconds)
  pollIntervalProofServer: number;
  pollIntervalNetwork: number;      // legacy combined indexer+node interval (back-compat)
  pollIntervalIndexer: number;      // indexer GraphQL reachability
  pollIntervalNode: number;         // node /health
  pollIntervalChain: number;        // latest block / cadence
  pollIntervalVersion: number;      // proof server version
  pollIntervalWallet: number;
  pollIntervalContracts: number;
  connectorHeartbeatIntervalMs: number; // connector heartbeat cadence

  // Local development sink: write every HEC event (and failed deliveries) to a
  // JSONL file so you can inspect output without a running Splunk.
  enableLocalJsonlSink: boolean;
  localJsonlPath: string;

  // Connector behavior
  enableSplunkForwarding: boolean;  // Master switch: send events to Splunk?
  enableConsoleLogging: boolean;    // Also log events to local console?
  batchSize: number;                // How many events to batch before flushing to HEC
  batchFlushIntervalMs: number;     // Max time (ms) before flushing a partial batch
  retryAttempts: number;            // How many times to retry failed HEC requests
  retryDelayMs: number;             // Base delay between retries (doubled each attempt)
  hecRequestTimeoutMs: number;      // Per-request timeout for HEC calls (so a firewalled/slow HEC can't hang startup)

  // On-chain attestation (zksplunk.compact)
  enableAttestation: boolean;              // Master switch: anchor telemetry commitments on-chain?
  attestationContractAddress: string;      // Deployed zksplunk.compact contract address
  attestationNetwork: 'mainnet' | 'preprod' | 'preview';
  attestationSamplingRate: number;         // 0-1. Fraction of checks to attest (default 0.1 = 10%)
  attestOnlyOnStatusChange: boolean;       // If true, attest only when a vital's status transitions
  attestationMinIntervalMs: number;        // Minimum gap between attestations for the same vital
}


/**
 * Default configuration values.
 * These are sensible defaults for local development.
 */
export const DEFAULT_CONFIG: ZKSplunkConfig = {
  // Local default is :8090, NOT the usual HEC :8088 — midnight-local-dev's indexer
  // already binds :8088 (hardcoded to match Lace 'undeployed'). See docs/SPLUNK_API_INTEGRATION.md.
  splunkHecUrl: 'https://localhost:8090',
  splunkHecToken: '',
  splunkIndex: 'zksplunk',
  splunkSourcetype: 'midnight:vitals',
  splunkSource: 'zksplunk-monitoring-agent',
  splunkHost: 'local-dev-machine',

  midnightProofServerUrl: 'http://localhost:6300',
  midnightIndexerUrl: 'http://localhost:8088/api/v4/graphql',
  midnightNodeUrl: 'http://localhost:9944',

  proofServerHealthPath: '/health',
  proofServerVersionPath: '/version',

  pollIntervalProofServer: 15000,
  pollIntervalNetwork: 20000,
  pollIntervalIndexer: 20000,
  pollIntervalNode: 30000,
  pollIntervalChain: 30000,
  pollIntervalVersion: 300000,
  pollIntervalWallet: 300000,
  pollIntervalContracts: 60000,
  connectorHeartbeatIntervalMs: 60000,

  enableLocalJsonlSink: false,
  localJsonlPath: './out/zksplunk-events.jsonl',

  enableSplunkForwarding: true,
  enableConsoleLogging: true,
  batchSize: 10,
  batchFlushIntervalMs: 5000,
  retryAttempts: 3,
  retryDelayMs: 1000,
  hecRequestTimeoutMs: 5000,

  enableAttestation: false,
  attestationContractAddress: '',
  attestationNetwork: 'preprod',
  attestationSamplingRate: 0.1,
  attestOnlyOnStatusChange: true,
  attestationMinIntervalMs: 30_000,
};


/**
 * Load configuration from environment variables, falling back to defaults.
 * Works in both Node.js (process.env) and browser (import.meta.env) contexts.
 */
export function loadConfigFromEnvironment(): ZKSplunkConfig {
  // Try to read env vars from either Node.js or Vite contexts
  const env = typeof process !== 'undefined' && process.env
    ? process.env
    : (typeof import.meta !== 'undefined' && (import.meta as any).env) || {};

  return {
    splunkHecUrl: env.SPLUNK_HEC_URL || DEFAULT_CONFIG.splunkHecUrl,
    splunkHecToken: env.SPLUNK_HEC_TOKEN || DEFAULT_CONFIG.splunkHecToken,
    splunkIndex: env.SPLUNK_INDEX || DEFAULT_CONFIG.splunkIndex,
    splunkSourcetype: env.SPLUNK_SOURCETYPE || DEFAULT_CONFIG.splunkSourcetype,
    splunkSource: env.SPLUNK_SOURCE || DEFAULT_CONFIG.splunkSource,
    splunkHost: env.SPLUNK_HOST || DEFAULT_CONFIG.splunkHost,

    midnightProofServerUrl: env.MIDNIGHT_PROOF_SERVER_URL || DEFAULT_CONFIG.midnightProofServerUrl,
    midnightIndexerUrl: env.MIDNIGHT_INDEXER_URL || DEFAULT_CONFIG.midnightIndexerUrl,
    midnightNodeUrl: env.MIDNIGHT_NODE_URL || DEFAULT_CONFIG.midnightNodeUrl,

    proofServerHealthPath: env.PROOF_SERVER_HEALTH_PATH || DEFAULT_CONFIG.proofServerHealthPath,
    proofServerVersionPath: env.PROOF_SERVER_VERSION_PATH || DEFAULT_CONFIG.proofServerVersionPath,

    pollIntervalProofServer: parseInt(env.POLL_INTERVAL_PROOF_SERVER_MS || env.POLL_INTERVAL_PROOF_SERVER || '', 10) || DEFAULT_CONFIG.pollIntervalProofServer,
    pollIntervalNetwork: parseInt(env.POLL_INTERVAL_NETWORK || '', 10) || DEFAULT_CONFIG.pollIntervalNetwork,
    pollIntervalIndexer: parseInt(env.POLL_INTERVAL_INDEXER_MS || env.POLL_INTERVAL_INDEXER || '', 10) || DEFAULT_CONFIG.pollIntervalIndexer,
    pollIntervalNode: parseInt(env.POLL_INTERVAL_NODE_MS || env.POLL_INTERVAL_NODE || '', 10) || DEFAULT_CONFIG.pollIntervalNode,
    pollIntervalChain: parseInt(env.POLL_INTERVAL_CHAIN_MS || env.POLL_INTERVAL_CHAIN || '', 10) || DEFAULT_CONFIG.pollIntervalChain,
    pollIntervalVersion: parseInt(env.POLL_INTERVAL_VERSION_MS || env.POLL_INTERVAL_VERSION || '', 10) || DEFAULT_CONFIG.pollIntervalVersion,
    pollIntervalWallet: parseInt(env.POLL_INTERVAL_WALLET_MS || env.POLL_INTERVAL_WALLET || '', 10) || DEFAULT_CONFIG.pollIntervalWallet,
    pollIntervalContracts: parseInt(env.POLL_INTERVAL_CONTRACTS_MS || env.POLL_INTERVAL_CONTRACTS || '', 10) || DEFAULT_CONFIG.pollIntervalContracts,
    connectorHeartbeatIntervalMs: parseInt(env.CONNECTOR_HEARTBEAT_INTERVAL_MS || '', 10) || DEFAULT_CONFIG.connectorHeartbeatIntervalMs,

    enableLocalJsonlSink: env.ENABLE_LOCAL_JSONL_SINK === 'true',
    localJsonlPath: env.LOCAL_JSONL_PATH || DEFAULT_CONFIG.localJsonlPath,

    enableSplunkForwarding: env.ENABLE_SPLUNK_FORWARDING !== 'false',
    enableConsoleLogging: env.ENABLE_CONSOLE_LOGGING !== 'false',
    batchSize: parseInt(env.BATCH_SIZE || '', 10) || DEFAULT_CONFIG.batchSize,
    batchFlushIntervalMs: parseInt(env.BATCH_FLUSH_INTERVAL_MS || '', 10) || DEFAULT_CONFIG.batchFlushIntervalMs,
    retryAttempts: parseInt(env.RETRY_ATTEMPTS || '', 10) || DEFAULT_CONFIG.retryAttempts,
    retryDelayMs: parseInt(env.RETRY_DELAY_MS || '', 10) || DEFAULT_CONFIG.retryDelayMs,
    hecRequestTimeoutMs: parseInt(env.HEC_REQUEST_TIMEOUT_MS || '', 10) || DEFAULT_CONFIG.hecRequestTimeoutMs,

    enableAttestation: env.ZKSPLUNK_ATTEST_ENABLED === 'true',
    attestationContractAddress: env.ZKSPLUNK_CONTRACT_ADDRESS || DEFAULT_CONFIG.attestationContractAddress,
    attestationNetwork: (env.BLOCKFROST_MIDNIGHT_NETWORK as ZKSplunkConfig['attestationNetwork']) || DEFAULT_CONFIG.attestationNetwork,
    attestationSamplingRate: parseFloat(env.ZKSPLUNK_ATTEST_SAMPLING_RATE || '') || DEFAULT_CONFIG.attestationSamplingRate,
    attestOnlyOnStatusChange: env.ZKSPLUNK_ATTEST_ONLY_ON_CHANGE !== 'false',
    attestationMinIntervalMs: parseInt(env.ZKSPLUNK_ATTEST_MIN_INTERVAL_MS || '', 10) || DEFAULT_CONFIG.attestationMinIntervalMs,
  };
}
