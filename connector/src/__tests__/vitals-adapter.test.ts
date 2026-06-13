// =============================================================================
// ZKSplunk — Vitals adapter / event builder tests
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  vitalCheckToSplunkEvent,
  chainBlockToSplunkEvent,
  componentVersionToSplunkEvent,
  contractMonitorabilityToSplunkEvent,
  walletBoundaryToSplunkEvent,
  hecDeliveryToSplunkEvent,
  connectorStatusToSplunkEvent,
  vitalIdToComponentId,
  SPLUNK_EVENT_TYPES,
  SPLUNK_SOURCETYPES,
  type EventMetadata,
} from '../vitals-adapter';
import type { VitalCheckResult } from '../../../vitals/types';

const META: EventMetadata = {
  dappName: 'test-dapp',
  environment: 'local',
  hostname: 'test-host',
  networkId: 'undeployed',
};

function result(overrides: Partial<VitalCheckResult> = {}): VitalCheckResult {
  return {
    status: 'healthy',
    message: 'ok',
    detailLine: '200 · 10ms',
    responseTimeMs: 10,
    ...overrides,
  };
}

describe('vitalIdToComponentId', () => {
  it('maps the legacy combined vital to indexer', () => {
    expect(vitalIdToComponentId('network')).toBe('indexer');
  });
  it('passes explicit components through', () => {
    expect(vitalIdToComponentId('proof-server')).toBe('proof-server');
    expect(vitalIdToComponentId('node')).toBe('node');
    expect(vitalIdToComponentId('indexer')).toBe('indexer');
  });
});

describe('vitalCheckToSplunkEvent', () => {
  it('builds the spec envelope with common + structured + metadata fields', () => {
    const r = result({
      status: 'warning',
      probeName: 'proof_server_health',
      endpoint: 'http://localhost:6300/health',
      httpStatus: 200,
      responseTimeMs: 2100,
      extra: { proof_server_health_path: '/health' },
    });
    const ev = vitalCheckToSplunkEvent('proof-server', r, META);

    expect(ev.sourcetype).toBe(SPLUNK_SOURCETYPES.VITALS);
    expect(ev.host).toBe('test-host');
    expect(ev.event.type).toBe(SPLUNK_EVENT_TYPES.VITAL_CHECK);
    expect(ev.event.component).toBe('proof-server');
    expect(ev.event.vital_id).toBe('proof-server');
    expect(ev.event.status).toBe('warning');
    expect(ev.event.severity).toBe('warn');
    expect(ev.event.network_id).toBe('undeployed');
    expect(ev.event.dapp_name).toBe('test-dapp');
    expect(ev.event.environment).toBe('local');
    expect(ev.event.probe_name).toBe('proof_server_health');
    expect(ev.event.endpoint).toBe('http://localhost:6300/health');
    expect(ev.event.http_status).toBe(200);
    expect(ev.event.proof_server_health_path).toBe('/health'); // extra merged
    expect(ev.event.is_zk_component).toBe(true);
    // No indexed `fields` object is emitted: relying solely on search-time
    // KV_MODE=json from the event _raw avoids HEC multivalue field duplication.
    expect(ev.fields).toBeUndefined();
  });

  it('maps the legacy network vital onto the indexer component', () => {
    const ev = vitalCheckToSplunkEvent('network', result(), META);
    expect(ev.event.component).toBe('indexer');
    expect(ev.event.vital_id).toBe('network');
  });

  it('carries an attestation commitment when provided', () => {
    const ev = vitalCheckToSplunkEvent('proof-server', result(), META, {
      commitmentHex: 'ab'.repeat(32),
      status: 'pending',
    });
    expect(ev.event.attestation_status).toBe('pending');
    expect(ev.event.attestation_commitment).toBe('ab'.repeat(32));
  });

  it('maps each status to the right severity', () => {
    expect(vitalCheckToSplunkEvent('node', result({ status: 'healthy' }), META).event.severity).toBe('info');
    expect(vitalCheckToSplunkEvent('node', result({ status: 'warning' }), META).event.severity).toBe('warn');
    expect(vitalCheckToSplunkEvent('node', result({ status: 'critical' }), META).event.severity).toBe('critical');
    expect(vitalCheckToSplunkEvent('node', result({ status: 'unknown' }), META).event.severity).toBe('info');
    expect(vitalCheckToSplunkEvent('wallet', result({ status: 'tracked' }), META).event.severity).toBe('info');
  });
});

describe('chainBlockToSplunkEvent', () => {
  it('uses the chain sourcetype and includes block fields', () => {
    const ev = chainBlockToSplunkEvent(
      result({
        probeName: 'indexer_latest_block',
        blockHeight: 12345,
        blockHash: 'abcd',
        blockTimestamp: 1781136000,
        blockAgeSeconds: 8,
      }),
      META,
    );
    expect(ev.sourcetype).toBe(SPLUNK_SOURCETYPES.CHAIN);
    expect(ev.event.type).toBe(SPLUNK_EVENT_TYPES.CHAIN_BLOCK_LATEST);
    expect(ev.event.component).toBe('indexer');
    expect(ev.event.block_height).toBe(12345);
    expect(ev.event.block_age_seconds).toBe(8);
  });

  it('emits null block fields when block is unknown', () => {
    const ev = chainBlockToSplunkEvent(result({ status: 'unknown', blockHeight: null }), META);
    expect(ev.event.block_height).toBeNull();
    expect(ev.event.status).toBe('unknown');
  });
});

describe('componentVersionToSplunkEvent', () => {
  it('builds a version event on the vitals sourcetype', () => {
    const ev = componentVersionToSplunkEvent(
      'proof-server',
      result({ probeName: 'proof_server_version', extra: { component_version: '8.0.3' } }),
      META,
    );
    expect(ev.sourcetype).toBe(SPLUNK_SOURCETYPES.VITALS);
    expect(ev.event.type).toBe(SPLUNK_EVENT_TYPES.COMPONENT_VERSION);
    expect(ev.event.component).toBe('proof-server');
    expect(ev.event.component_version).toBe('8.0.3');
  });
});

describe('contractMonitorabilityToSplunkEvent', () => {
  it('uses the contracts sourcetype and merges contract extras', () => {
    const ev = contractMonitorabilityToSplunkEvent(
      result({
        status: 'healthy',
        extra: { contract_id: 'zksplunk-attest', contract_found: true, unshielded_balance_count: 2 },
      }),
      META,
    );
    expect(ev.sourcetype).toBe(SPLUNK_SOURCETYPES.CONTRACTS);
    expect(ev.event.type).toBe(SPLUNK_EVENT_TYPES.CONTRACT_MONITORABILITY);
    expect(ev.event.component).toBe('contracts');
    expect(ev.event.contract_found).toBe(true);
    expect(ev.event.unshielded_balance_count).toBe(2);
  });
});

describe('walletBoundaryToSplunkEvent', () => {
  it('builds an unknown wallet boundary event', () => {
    const ev = walletBoundaryToSplunkEvent(
      result({ status: 'unknown', extra: { headless_mode: true, wallet_monitoring_configured: false } }),
      META,
    );
    expect(ev.event.type).toBe(SPLUNK_EVENT_TYPES.WALLET_BOUNDARY);
    expect(ev.event.component).toBe('wallet');
    expect(ev.event.status).toBe('unknown');
    expect(ev.event.severity).toBe('info'); // unknown is info, never critical
    expect(ev.event.headless_mode).toBe(true);
  });
});

describe('hecDeliveryToSplunkEvent', () => {
  const base = {
    hecUrl: 'https://localhost:8090',
    batchEventCount: 10,
    sendAttempt: 1,
    hecResponseCode: 0,
    responseTimeMs: 50,
  };
  it('uses the connector sourcetype', () => {
    const ev = hecDeliveryToSplunkEvent({ ...base, sendStatus: 'success' }, META);
    expect(ev.sourcetype).toBe(SPLUNK_SOURCETYPES.CONNECTOR);
    expect(ev.event.type).toBe(SPLUNK_EVENT_TYPES.HEC_DELIVERY);
    expect(ev.event.severity).toBe('info');
  });
  it('maps retry → warn and failed → critical', () => {
    expect(hecDeliveryToSplunkEvent({ ...base, sendStatus: 'retry' }, META).event.severity).toBe('warn');
    expect(
      hecDeliveryToSplunkEvent(
        { ...base, sendStatus: 'failed', hecResponseCode: null, responseTimeMs: null, errorMessage: 'down' },
        META,
      ).event.severity,
    ).toBe('critical');
  });
});

describe('connectorStatusToSplunkEvent', () => {
  const stats = {
    totalEventsSent: 100,
    totalEventsFailed: 0,
    totalBatchesSent: 10,
    averageLatencyMs: 50,
    queuedEvents: 0,
  };
  it('reports info severity and scheduler_active when healthy', () => {
    const ev = connectorStatusToSplunkEvent({ ...stats, schedulerActive: true }, META);
    expect(ev.sourcetype).toBe(SPLUNK_SOURCETYPES.CONNECTOR);
    expect(ev.event.type).toBe(SPLUNK_EVENT_TYPES.CONNECTOR_STATUS);
    expect(ev.event.severity).toBe('info');
    expect(ev.event.scheduler_active).toBe(true);
    expect(ev.event.component).toBe('connector');
  });
  it('keeps cumulative failures visible without treating old failures as current critical state', () => {
    const ev = connectorStatusToSplunkEvent({ ...stats, totalEventsFailed: 3, failedEventsSinceLastHeartbeat: 0 }, META);
    expect(ev.event.severity).toBe('info');
    expect(ev.event.total_events_failed).toBe(3);
    expect(ev.event.failed_events_since_last_heartbeat).toBe(0);
  });
  it('escalates to critical when events failed since the previous heartbeat', () => {
    const ev = connectorStatusToSplunkEvent({ ...stats, totalEventsFailed: 3, failedEventsSinceLastHeartbeat: 3 }, META);
    expect(ev.event.severity).toBe('critical');
    expect(ev.event.total_events_failed).toBe(3);
    expect(ev.event.failed_events_since_last_heartbeat).toBe(3);
  });
  it('warns when the queue is backed up or latency is high', () => {
    expect(connectorStatusToSplunkEvent({ ...stats, queuedEvents: 5 }, META).event.severity).toBe('warn');
    expect(connectorStatusToSplunkEvent({ ...stats, averageLatencyMs: 1500 }, META).event.severity).toBe('warn');
  });
});
