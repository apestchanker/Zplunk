// =============================================================================
// ZKSplunk — Config loader tests
// =============================================================================

import { describe, it, expect, afterEach } from 'vitest';
import { loadConfigFromEnvironment, DEFAULT_CONFIG } from '../config';

const TOUCHED = [
  'SPLUNK_HEC_URL', 'SPLUNK_HEC_TOKEN', 'SPLUNK_HOST', 'SPLUNK_SOURCE',
  'MIDNIGHT_INDEXER_URL', 'MIDNIGHT_NODE_URL', 'MIDNIGHT_PROOF_SERVER_URL',
  'PROOF_SERVER_HEALTH_PATH', 'PROOF_SERVER_VERSION_PATH',
  'POLL_INTERVAL_PROOF_SERVER_MS', 'POLL_INTERVAL_PROOF_SERVER',
  'POLL_INTERVAL_INDEXER_MS', 'POLL_INTERVAL_NODE_MS', 'POLL_INTERVAL_CHAIN_MS',
  'POLL_INTERVAL_VERSION_MS', 'POLL_INTERVAL_WALLET_MS', 'POLL_INTERVAL_CONTRACTS_MS',
  'CONNECTOR_HEARTBEAT_INTERVAL_MS',
  'ENABLE_LOCAL_JSONL_SINK', 'LOCAL_JSONL_PATH',
  'ENABLE_SPLUNK_FORWARDING', 'ENABLE_CONSOLE_LOGGING',
];

afterEach(() => {
  for (const k of TOUCHED) delete process.env[k];
});

describe('loadConfigFromEnvironment — defaults', () => {
  it('uses Indexer API v4 by default', () => {
    expect(loadConfigFromEnvironment().midnightIndexerUrl).toBe('http://localhost:8088/api/v4/graphql');
    expect(DEFAULT_CONFIG.midnightIndexerUrl).toContain('/api/v4/graphql');
  });

  it('defaults the node URL and proof server paths', () => {
    const c = loadConfigFromEnvironment();
    expect(c.midnightNodeUrl).toBe('http://localhost:9944');
    expect(c.proofServerHealthPath).toBe('/health');
    expect(c.proofServerVersionPath).toBe('/version');
  });

  it('has the spec default polling cadences', () => {
    const c = loadConfigFromEnvironment();
    expect(c.pollIntervalProofServer).toBe(15000);
    expect(c.pollIntervalIndexer).toBe(20000);
    expect(c.pollIntervalNode).toBe(30000);
    expect(c.pollIntervalChain).toBe(30000);
    expect(c.pollIntervalContracts).toBe(60000);
    expect(c.pollIntervalVersion).toBe(300000);
    expect(c.pollIntervalWallet).toBe(300000);
    expect(c.connectorHeartbeatIntervalMs).toBe(60000);
  });

  it('disables the JSONL sink by default', () => {
    expect(loadConfigFromEnvironment().enableLocalJsonlSink).toBe(false);
  });
});

describe('loadConfigFromEnvironment — overrides', () => {
  it('honors *_MS interval env vars', () => {
    process.env.POLL_INTERVAL_PROOF_SERVER_MS = '5000';
    process.env.POLL_INTERVAL_CHAIN_MS = '12345';
    const c = loadConfigFromEnvironment();
    expect(c.pollIntervalProofServer).toBe(5000);
    expect(c.pollIntervalChain).toBe(12345);
  });

  it('accepts the legacy non-_MS proof-server interval as a fallback alias', () => {
    process.env.POLL_INTERVAL_PROOF_SERVER = '7000';
    expect(loadConfigFromEnvironment().pollIntervalProofServer).toBe(7000);
  });

  it('prefers _MS over the legacy alias when both are set', () => {
    process.env.POLL_INTERVAL_PROOF_SERVER_MS = '1000';
    process.env.POLL_INTERVAL_PROOF_SERVER = '9000';
    expect(loadConfigFromEnvironment().pollIntervalProofServer).toBe(1000);
  });

  it('reads endpoints, host and source', () => {
    process.env.MIDNIGHT_NODE_URL = 'http://node:9999';
    process.env.SPLUNK_HOST = 'ci-box';
    process.env.SPLUNK_SOURCE = 'custom-source';
    const c = loadConfigFromEnvironment();
    expect(c.midnightNodeUrl).toBe('http://node:9999');
    expect(c.splunkHost).toBe('ci-box');
    expect(c.splunkSource).toBe('custom-source');
  });

  it('enables the JSONL sink and path via env', () => {
    process.env.ENABLE_LOCAL_JSONL_SINK = 'true';
    process.env.LOCAL_JSONL_PATH = '/tmp/x.jsonl';
    const c = loadConfigFromEnvironment();
    expect(c.enableLocalJsonlSink).toBe(true);
    expect(c.localJsonlPath).toBe('/tmp/x.jsonl');
  });

  it('treats forwarding/logging as enabled unless explicitly "false"', () => {
    process.env.ENABLE_SPLUNK_FORWARDING = 'false';
    process.env.ENABLE_CONSOLE_LOGGING = 'false';
    const c = loadConfigFromEnvironment();
    expect(c.enableSplunkForwarding).toBe(false);
    expect(c.enableConsoleLogging).toBe(false);
  });
});
