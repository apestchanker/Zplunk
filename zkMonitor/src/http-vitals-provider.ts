// =============================================================================
// ZKSplunk zkMonitor — Live HTTP Vitals Provider
// =============================================================================
// A real (non-mock) implementation of VitalsProviderInterface that performs
// actual HTTP/GraphQL probes against live Midnight infrastructure, following
// implementation/ZKSPLUNK_MONITORING_AND_MCP_SPEC.md:
//
//   • proof-server : GET {healthPath}, fallback {versionPath}   (vital.check)
//   • proof-server : GET {versionPath}                          (component.version)
//   • indexer      : POST GraphQL `{ __typename }`              (vital.check)
//   • indexer      : POST GraphQL LatestBlock                   (chain.block_latest)
//   • node         : GET /health                                (vital.check)
//   • contracts    : POST GraphQL contractAction(address)       (contract.monitorability)
//   • wallet       : headless boundary or public unshielded WS  (wallet.boundary)
//
// Dependency-free (global fetch, Node 18+). Every result carries structured
// probe fields; secrets are scrubbed by the connector's sanitizer before send.
// =============================================================================

import type {
  VitalsProviderInterface,
  VitalCheckResult,
  DependencyCheckResult,
  ContractInfo,
} from '../../vitals/types.ts';

export interface HttpVitalsProviderOptions {
  proofServerUrl: string;
  indexerUrl: string;
  nodeUrl: string;
  proofServerHealthPath?: string;
  proofServerVersionPath?: string;
  /** Indexer GraphQL WebSocket URL (derived from indexerUrl if omitted). */
  indexerWsUrl?: string;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
}

/** ws(s):// URL for the indexer's GraphQL subscriptions endpoint. */
function deriveWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/, 'ws').replace(/\/+$/, '') + '/ws';
}

interface TimedResponse {
  ok: boolean;
  status: number;
  ms: number;
  text: string;
}

async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<TimedResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, ms: Date.now() - start, text };
  } finally {
    clearTimeout(timer);
  }
}

function errorResult(
  probeName: string,
  endpoint: string,
  err: unknown,
  label: string,
): VitalCheckResult {
  const e = err instanceof Error ? err : new Error(String(err));
  const timedOut = e.name === 'AbortError';
  return {
    status: 'critical',
    message: `${label} ${timedOut ? 'timed out' : 'unreachable'}: ${e.message}`,
    detailLine: timedOut ? 'Timeout' : 'Unreachable',
    responseTimeMs: null,
    endpoint,
    probeName,
    httpStatus: null,
    errorName: timedOut ? 'TimeoutError' : e.name,
    errorMessage: e.message,
  };
}

export class HttpVitalsProvider implements VitalsProviderInterface {
  private readonly timeoutMs: number;
  private readonly healthPath: string;
  private readonly versionPath: string;
  private readonly indexerWsUrl: string;

  // Chain cadence tracking across samples (for "advancing" / "stalled").
  private lastBlockHeight: number | null = null;
  private lastBlockHeightSeenAt = 0;

  constructor(private readonly options: HttpVitalsProviderOptions) {
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.healthPath = options.proofServerHealthPath ?? '/health';
    this.versionPath = options.proofServerVersionPath ?? '/version';
    this.indexerWsUrl = options.indexerWsUrl ?? deriveWsUrl(options.indexerUrl);
  }

  // -------------------------------------------------------------------------
  // 1. Proof server reachability  (event: midnight.vital.check)
  // -------------------------------------------------------------------------
  async checkProofServer(): Promise<VitalCheckResult> {
    const healthUrl = `${this.options.proofServerUrl}${this.healthPath}`;
    try {
      let res = await timedFetch(healthUrl, { method: 'GET' }, this.timeoutMs);
      let usedFallback = false;
      let activePath = this.healthPath;
      let endpoint = healthUrl;

      // Fallback to /version when /health is missing (404).
      if (res.status === 404) {
        const versionUrl = `${this.options.proofServerUrl}${this.versionPath}`;
        const fb = await timedFetch(versionUrl, { method: 'GET' }, this.timeoutMs);
        if (fb.ok) {
          res = fb;
          usedFallback = true;
          activePath = this.versionPath;
          endpoint = versionUrl;
        }
      }

      const base = {
        endpoint,
        probeName: 'proof_server_health',
        httpStatus: res.status,
        responseTimeMs: res.ms,
        extra: { proof_server_health_path: activePath, http_status: res.status },
      };

      if (res.ok) {
        const slow = res.ms >= 2000;
        const degraded = slow || usedFallback;
        return {
          ...base,
          status: degraded ? 'warning' : 'healthy',
          message: usedFallback
            ? `Proof server reachable via ${this.versionPath} fallback (${res.ms}ms).`
            : slow
              ? `Proof server responded slowly (${res.ms}ms).`
              : `Proof server healthy (${res.ms}ms).`,
          detailLine: `${res.status} · ${res.ms}ms${usedFallback ? ' · fallback' : ''}`,
        };
      }

      return {
        ...base,
        status: 'critical',
        message: `Proof server returned HTTP ${res.status}.`,
        detailLine: `HTTP ${res.status}`,
        errorName: 'HttpError',
        errorMessage: `HTTP ${res.status}`,
      };
    } catch (err) {
      return errorResult('proof_server_health', healthUrl, err, 'Proof server');
    }
  }

  // -------------------------------------------------------------------------
  // 5. Proof server version  (event: midnight.component.version)
  // -------------------------------------------------------------------------
  async checkProofServerVersion(): Promise<VitalCheckResult> {
    const url = `${this.options.proofServerUrl}${this.versionPath}`;
    try {
      const res = await timedFetch(url, { method: 'GET' }, this.timeoutMs);
      if (res.ok) {
        const raw = res.text.trim();
        const version = extractVersion(raw);
        return {
          status: 'healthy',
          message: version
            ? `Proof server version ${version}.`
            : `Proof server version endpoint reachable.`,
          detailLine: version ?? `${res.status} · ${res.ms}ms`,
          responseTimeMs: res.ms,
          endpoint: url,
          probeName: 'proof_server_version',
          httpStatus: res.status,
          extra: {
            component_version: version ?? 'unknown',
            version_raw_hash: `sha256:${sha256Hex(raw)}`,
          },
        };
      }
      // Version endpoint unavailable is NOT critical (reachability probe owns that).
      return {
        status: 'warning',
        message: `Proof server version endpoint unavailable (HTTP ${res.status}).`,
        detailLine: `HTTP ${res.status}`,
        responseTimeMs: res.ms,
        endpoint: url,
        probeName: 'proof_server_version',
        httpStatus: res.status,
        unsupportedProbe: res.status === 404,
      };
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      return {
        status: 'warning',
        message: `Proof server version endpoint unreachable: ${e.message}`,
        detailLine: 'Unavailable',
        responseTimeMs: null,
        endpoint: url,
        probeName: 'proof_server_version',
        httpStatus: null,
        errorName: e.name,
        errorMessage: e.message,
      };
    }
  }

  // -------------------------------------------------------------------------
  // 2. Indexer GraphQL reachability  (event: midnight.vital.check)
  //    `checkNetwork` is kept as the back-compat alias for the combined vital.
  // -------------------------------------------------------------------------
  async checkIndexer(): Promise<VitalCheckResult> {
    const url = this.options.indexerUrl;
    try {
      const res = await timedFetch(
        url,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: '{ __typename }' }),
        },
        this.timeoutMs,
      );

      let parsed: any = null;
      let parseOk = true;
      try {
        parsed = JSON.parse(res.text);
      } catch {
        parseOk = false;
      }
      const gqlErrors: unknown[] = Array.isArray(parsed?.errors) ? parsed.errors : [];

      const base = {
        endpoint: url,
        probeName: 'indexer_graphql_typename',
        httpStatus: res.status,
        responseTimeMs: res.ms,
        graphqlErrorsCount: gqlErrors.length,
        extra: { graphql_operation: '__typename', graphql_errors_count: gqlErrors.length },
      };

      if (!res.ok) {
        return {
          ...base,
          status: 'critical',
          message: `Indexer returned HTTP ${res.status}.`,
          detailLine: `HTTP ${res.status}`,
          errorName: 'HttpError',
          errorMessage: `HTTP ${res.status}`,
        };
      }
      if (!parseOk) {
        return {
          ...base,
          status: 'critical',
          message: `Indexer returned invalid JSON.`,
          detailLine: 'Invalid JSON',
          errorName: 'ParseError',
          errorMessage: 'Response body was not valid JSON',
        };
      }
      if (gqlErrors.length > 0 && parsed?.data == null) {
        return {
          ...base,
          status: 'critical',
          message: `Indexer GraphQL returned ${gqlErrors.length} error(s) with no data.`,
          detailLine: `${gqlErrors.length} gql error(s)`,
          errorName: 'GraphQLError',
          errorMessage: firstGqlMessage(gqlErrors),
        };
      }

      const slow = res.ms >= 1000;
      const degraded = slow || gqlErrors.length > 0;
      return {
        ...base,
        status: degraded ? 'warning' : 'healthy',
        message: gqlErrors.length > 0
          ? `Indexer reachable with ${gqlErrors.length} GraphQL warning(s) (${res.ms}ms).`
          : slow
            ? `Indexer reachable but slow (${res.ms}ms).`
            : `Indexer reachable and responsive (${res.ms}ms).`,
        detailLine: `${res.status} · ${res.ms}ms`,
      };
    } catch (err) {
      return errorResult('indexer_graphql_typename', url, err, 'Indexer');
    }
  }

  /** Back-compat alias: the legacy combined `network` vital == indexer probe. */
  async checkNetwork(): Promise<VitalCheckResult> {
    return this.checkIndexer();
  }

  // -------------------------------------------------------------------------
  // 3. Indexer latest block  (event: midnight.chain.block_latest)
  // -------------------------------------------------------------------------
  async checkLatestBlock(): Promise<VitalCheckResult> {
    const url = this.options.indexerUrl;
    const query = `query LatestBlock {
  block {
    hash
    height
    protocolVersion
    timestamp
    author
  }
}`;
    try {
      const res = await timedFetch(
        url,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query }),
        },
        this.timeoutMs,
      );

      let parsed: any = null;
      try {
        parsed = JSON.parse(res.text);
      } catch {
        /* handled below */
      }
      const block = parsed?.data?.block;

      // If reachable but no block data, mark block metrics unknown (do NOT fail).
      if (!res.ok || !block || typeof block.height !== 'number') {
        return {
          status: 'unknown',
          message: res.ok
            ? 'Indexer reachable but latest block not available yet.'
            : `Indexer returned HTTP ${res.status} for latest block query.`,
          detailLine: res.ok ? 'No block yet' : `HTTP ${res.status}`,
          responseTimeMs: res.ms,
          endpoint: url,
          probeName: 'indexer_latest_block',
          httpStatus: res.status,
          blockHeight: null,
          blockHash: null,
          blockTimestamp: null,
          blockAgeSeconds: null,
          unsupportedProbe: !res.ok,
        };
      }

      const height: number = block.height;
      // Indexer timestamps are typically ms; normalise to seconds when large.
      const tsRaw: number = Number(block.timestamp) || 0;
      const blockTsSec = tsRaw > 1e12 ? Math.floor(tsRaw / 1000) : tsRaw;
      const ageSec = blockTsSec > 0 ? Math.max(0, Math.floor(Date.now() / 1000) - blockTsSec) : null;

      // Advancing detection across samples.
      const prevHeight = this.lastBlockHeight;
      const unchanged = prevHeight !== null && prevHeight === height;
      this.lastBlockHeight = height;
      this.lastBlockHeightSeenAt = Date.now();

      let status: VitalCheckResult['status'] = 'healthy';
      let message = `Latest block ${height} (age ${ageSec ?? '?'}s).`;
      if (ageSec !== null && ageSec > 60) {
        status = 'critical';
        message = `Latest block ${height} is stale (age ${ageSec}s > 60s).`;
      } else if ((ageSec !== null && ageSec > 30) || unchanged) {
        status = 'warning';
        message = unchanged
          ? `Block height unchanged at ${height} across samples.`
          : `Latest block ${height} aging (${ageSec}s).`;
      }

      return {
        status,
        message,
        detailLine: `#${height} · ${ageSec ?? '?'}s`,
        responseTimeMs: res.ms,
        endpoint: url,
        probeName: 'indexer_latest_block',
        httpStatus: res.status,
        blockHeight: height,
        blockHash: typeof block.hash === 'string' ? block.hash : null,
        blockTimestamp: blockTsSec || null,
        blockAgeSeconds: ageSec,
        extra: {
          protocol_version: block.protocolVersion ?? null,
          author: typeof block.author === 'string' ? block.author : null,
          height_unchanged: unchanged,
        },
      };
    } catch (err) {
      // Chain probe failure is reported but kept distinct from indexer outage.
      const e = err instanceof Error ? err : new Error(String(err));
      return {
        status: 'critical',
        message: `Latest block query failed: ${e.message}`,
        detailLine: e.name === 'AbortError' ? 'Timeout' : 'Failed',
        responseTimeMs: null,
        endpoint: url,
        probeName: 'indexer_latest_block',
        httpStatus: null,
        errorName: e.name === 'AbortError' ? 'TimeoutError' : e.name,
        errorMessage: e.message,
        blockHeight: null,
        blockAgeSeconds: null,
      };
    }
  }

  // -------------------------------------------------------------------------
  // 4. Node health  (event: midnight.vital.check)
  // -------------------------------------------------------------------------
  async checkNode(): Promise<VitalCheckResult> {
    const url = `${this.options.nodeUrl}/health`;
    try {
      const res = await timedFetch(url, { method: 'GET' }, this.timeoutMs);
      const base = {
        endpoint: url,
        probeName: 'node_health',
        httpStatus: res.status,
        responseTimeMs: res.ms,
      };

      if (res.status === 404) {
        return {
          ...base,
          status: 'unknown',
          message: `Node /health not exposed (HTTP 404) — node probe unsupported.`,
          detailLine: 'Unsupported',
          unsupportedProbe: true,
          extra: { unsupported_probe: true },
        };
      }
      if (res.ok) {
        const slow = res.ms >= 1000;
        return {
          ...base,
          status: slow ? 'warning' : 'healthy',
          message: slow
            ? `Node responded slowly (${res.ms}ms).`
            : `Node healthy (${res.ms}ms).`,
          detailLine: `${res.status} · ${res.ms}ms`,
          extra: { unsupported_probe: false },
        };
      }
      return {
        ...base,
        status: 'critical',
        message: `Node returned HTTP ${res.status}.`,
        detailLine: `HTTP ${res.status}`,
        errorName: 'HttpError',
        errorMessage: `HTTP ${res.status}`,
        extra: { unsupported_probe: false },
      };
    } catch (err) {
      return errorResult('node_health', url, err, 'Node');
    }
  }

  // -------------------------------------------------------------------------
  // 7. Wallet boundary  (event: midnight.wallet.boundary)
  // -------------------------------------------------------------------------
  async checkWallet(): Promise<VitalCheckResult> {
    return {
      status: 'unknown',
      message: 'Wallet health is not observable from the headless agent.',
      detailLine: 'N/A (headless)',
      responseTimeMs: null,
      probeName: 'wallet_boundary',
      extra: {
        headless_mode: true,
        wallet_monitoring_configured: false,
      },
    };
  }

  // -------------------------------------------------------------------------
  // 7b. Unshielded wallet observation  (event: midnight.wallet.boundary)
  // -------------------------------------------------------------------------
  // PUBLIC data only — no viewing key. Subscribes to unshieldedTransactions for
  // the address (graphql-transport-ws), drains from tx 0 until caught up, and
  // computes the public unshielded balance + activity. Shielded balances are
  // never read (they require a private viewing key by design).
  async checkWalletUnshielded(address: string): Promise<VitalCheckResult> {
    const wsUrl = this.indexerWsUrl;
    try {
      const start = Date.now();
      const payloads = await drainUnshielded(wsUrl, address, this.timeoutMs * 2);
      const acc = accumulateUnshielded(payloads, address);
      const tokens = Object.keys(acc.balances);
      const primary = tokens.length ? acc.balances[tokens[0]] : '0';
      return {
        status: 'tracked',
        message:
          `Tracking unshielded activity for ${address.slice(0, 16)}…: ${acc.txCount} tx, ` +
          `${acc.createdUtxos} created / ${acc.spentUtxos} spent UTXOs, ${tokens.length} token type(s). ` +
          `Shielded balance is private and never read.`,
        detailLine: `tracked · ${acc.txCount} tx · ${tokens.length} token(s)`,
        responseTimeMs: Date.now() - start,
        endpoint: wsUrl,
        probeName: 'wallet_unshielded',
        extra: {
          wallet_address: address,
          unshielded_tx_count: acc.txCount,
          unshielded_created_utxos: acc.createdUtxos,
          unshielded_spent_utxos: acc.spentUtxos,
          unshielded_token_types: tokens.length,
          unshielded_primary_balance: primary,
          unshielded_balances_json: JSON.stringify(acc.balances),
          indexer_highest_tx_id: acc.highestTxId,
          wallet_balance_shielded_private: true,
        },
      };
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      return {
        status: 'critical',
        message: `Unshielded wallet probe failed: ${e.message}`,
        detailLine: 'WS error',
        responseTimeMs: null,
        endpoint: wsUrl,
        probeName: 'wallet_unshielded',
        errorName: e.name,
        errorMessage: e.message,
        extra: { wallet_address: address },
      };
    }
  }

  // -------------------------------------------------------------------------
  // 6. Contract monitorability  (event: midnight.contract.monitorability)
  // -------------------------------------------------------------------------
  async checkContractMonitorability(contracts: ContractInfo[]): Promise<VitalCheckResult> {
    const configured = contracts.filter((c) => c.address && c.address.length > 0);
    if (configured.length === 0) {
      return {
        status: 'warning',
        message: 'No contract addresses configured to monitor.',
        detailLine: '0 configured',
        responseTimeMs: null,
        endpoint: this.options.indexerUrl,
        probeName: 'contract_monitorability',
        extra: { contract_query_supported: true, contract_found: false },
      };
    }

    const url = this.options.indexerUrl;
    const query = `query ContractMonitorability($address: HexEncoded!) {
  contractAction(address: $address) {
    __typename
    ... on ContractDeploy { address state zswapState unshieldedBalances { tokenType amount } }
    ... on ContractCall { address state zswapState entryPoint unshieldedBalances { tokenType amount } }
    ... on ContractUpdate { address state zswapState unshieldedBalances { tokenType amount } }
  }
}`;

    // Probe the first configured contract (spec allows max concurrency 3; for
    // the MVP we report the primary contract and a found count).
    const target = configured[0];
    try {
      const res = await timedFetch(
        url,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query, variables: { address: target.address } }),
        },
        this.timeoutMs,
      );

      let parsed: any = null;
      try {
        parsed = JSON.parse(res.text);
      } catch {
        /* handled below */
      }
      const gqlErrors: unknown[] = Array.isArray(parsed?.errors) ? parsed.errors : [];
      const action = parsed?.data?.contractAction;
      const found = !!action;
      const balances = Array.isArray(action?.unshieldedBalances) ? action.unshieldedBalances : [];

      const base = {
        endpoint: url,
        probeName: 'contract_monitorability',
        httpStatus: res.status,
        responseTimeMs: res.ms,
        graphqlErrorsCount: gqlErrors.length,
        extra: {
          contract_id: target.id,
          contract_address: target.address,
          contract_found: found,
          contract_query_supported: gqlErrors.length === 0 && res.ok,
          unshielded_balance_count: balances.length,
          configured_count: configured.length,
        },
      };

      // Query unsupported (schema mismatch) → warning, not critical.
      if (res.ok && gqlErrors.length > 0) {
        return {
          ...base,
          status: 'warning',
          message: `contractAction query not supported by this indexer (${gqlErrors.length} error(s)).`,
          detailLine: 'Query unsupported',
          errorName: 'GraphQLError',
          errorMessage: firstGqlMessage(gqlErrors),
        };
      }
      if (!res.ok) {
        return {
          ...base,
          status: 'critical',
          message: `Contract query failed (HTTP ${res.status}) for ${target.id}.`,
          detailLine: `HTTP ${res.status}`,
          errorName: 'HttpError',
          errorMessage: `HTTP ${res.status}`,
        };
      }
      return {
        ...base,
        status: found ? 'healthy' : 'warning',
        message: found
          ? `Contract ${target.id} monitorable (${action.__typename}, ${balances.length} balance(s)).`
          : `Contract ${target.id} configured but not found on indexer yet.`,
        detailLine: found ? `${action.__typename}` : 'Not found',
      };
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      return {
        status: 'critical',
        message: `Contract query unreachable for ${target.id}: ${e.message}`,
        detailLine: e.name === 'AbortError' ? 'Timeout' : 'Unreachable',
        responseTimeMs: null,
        endpoint: url,
        probeName: 'contract_monitorability',
        httpStatus: null,
        errorName: e.name === 'AbortError' ? 'TimeoutError' : e.name,
        errorMessage: e.message,
        extra: {
          contract_id: target.id,
          contract_address: target.address,
          contract_found: false,
        },
      };
    }
  }

  /** Back-compat alias kept for the original VitalsProviderInterface. */
  async checkContracts(contracts: ContractInfo[]): Promise<VitalCheckResult> {
    return this.checkContractMonitorability(contracts);
  }

  async checkDependencies(): Promise<DependencyCheckResult[]> {
    return [
      {
        name: 'Node.js',
        installed: true,
        version: process.versions.node,
        message: `Node.js ${process.versions.node} is running the connector.`,
      },
    ];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Pull a semver-ish version string out of a /version body (JSON or plain). */
function extractVersion(raw: string): string | null {
  if (!raw) return null;
  try {
    const json = JSON.parse(raw);
    const v = json.version ?? json.proofServerVersion ?? json.tag ?? json.build;
    if (typeof v === 'string') return v;
  } catch {
    /* not JSON */
  }
  const m = raw.match(/\d+\.\d+\.\d+(?:[-+][\w.]+)?/);
  return m ? m[0] : raw.slice(0, 64) || null;
}

function firstGqlMessage(errors: unknown[]): string {
  const first = errors[0] as { message?: string } | undefined;
  return first?.message ? String(first.message) : 'GraphQL error';
}

// ---------------------------------------------------------------------------
// Unshielded wallet subscription (public data, no viewing key)
// ---------------------------------------------------------------------------

const UNSHIELDED_SUB = `subscription Unshielded($a: UnshieldedAddress!) {
  unshieldedTransactions(address: $a, transactionId: 0) {
    __typename
    ... on UnshieldedTransaction {
      transaction { __typename }
      createdUtxos { tokenType value owner }
      spentUtxos { tokenType value owner }
    }
    ... on UnshieldedTransactionsProgress { highestTransactionId }
  }
}`;

/**
 * Reduce a list of `unshieldedTransactions` subscription payloads into public
 * balance + activity for `address`. Net balance per token = created − spent
 * for UTXOs owned by the address. Pure + deterministic (unit-tested).
 */
export function accumulateUnshielded(
  payloads: any[],
  address: string,
): {
  txCount: number;
  createdUtxos: number;
  spentUtxos: number;
  balances: Record<string, string>;
  highestTxId: number | null;
} {
  let txCount = 0;
  let createdUtxos = 0;
  let spentUtxos = 0;
  let highestTxId: number | null = null;
  const bal: Record<string, bigint> = {};
  for (const p of payloads) {
    if (!p) continue;
    if (p.__typename === 'UnshieldedTransaction') {
      txCount++;
      for (const u of p.createdUtxos || []) {
        if (u.owner === address) {
          createdUtxos++;
          bal[u.tokenType] = (bal[u.tokenType] ?? 0n) + BigInt(u.value);
        }
      }
      for (const u of p.spentUtxos || []) {
        if (u.owner === address) {
          spentUtxos++;
          bal[u.tokenType] = (bal[u.tokenType] ?? 0n) - BigInt(u.value);
        }
      }
    } else if (p.__typename === 'UnshieldedTransactionsProgress') {
      highestTxId = p.highestTransactionId ?? highestTxId;
    }
  }
  const balances: Record<string, string> = {};
  for (const k of Object.keys(bal)) balances[k] = bal[k].toString();
  return { txCount, createdUtxos, spentUtxos, balances, highestTxId };
}

/**
 * Open a graphql-transport-ws subscription and collect unshieldedTransactions
 * payloads, then resolve with everything collected. Uses Node's global WebSocket.
 *
 * Completion semantics — IMPORTANT: the indexer emits a `Progress` marker
 * FIRST (announcing the highest transaction id it knows about), THEN replays
 * the address's historical transactions, then stays live. So a Progress marker
 * does NOT mean "caught up" — bailing on the first one drops every transaction
 * and reports 0 activity for an active wallet. Instead we drain until the
 * stream goes idle for `idleMs` (replay finished) or the hard `timeoutMs`
 * ceiling fires, whichever comes first.
 */
function drainUnshielded(
  wsUrl: string,
  address: string,
  timeoutMs: number,
  idleMs = 1_500,
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const payloads: any[] = [];
    let settled = false;
    let ws: WebSocket;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      clearTimeout(idleTimer);
      try { ws.close(); } catch { /* ignore */ }
      if (err) reject(err);
      else resolve(payloads);
    };
    // Absolute ceiling so a chatty live wallet can't keep us open forever.
    const hardTimer = setTimeout(() => finish(), timeoutMs);
    // Reset after each streamed message; fires once the replay has gone quiet.
    const bumpIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(), Math.min(idleMs, timeoutMs));
    };

    try {
      ws = new WebSocket(wsUrl, 'graphql-transport-ws');
    } catch (e) {
      clearTimeout(hardTimer);
      return reject(e as Error);
    }

    ws.onopen = () => ws.send(JSON.stringify({ type: 'connection_init' }));
    ws.onerror = () => finish(new Error(`WebSocket error connecting to ${wsUrl}`));
    ws.onclose = () => finish();
    ws.onmessage = (ev: MessageEvent) => {
      let m: any;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.type === 'connection_ack') {
        ws.send(JSON.stringify({ id: '1', type: 'subscribe', payload: { query: UNSHIELDED_SUB, variables: { a: address } } }));
      } else if (m.type === 'next') {
        const p = m.payload?.data?.unshieldedTransactions;
        if (p) payloads.push(p);
        // Drain through Progress + replayed transactions; stop when it goes idle.
        bumpIdle();
      } else if (m.type === 'error') {
        finish(new Error('GraphQL subscription error: ' + JSON.stringify(m.payload)));
      } else if (m.type === 'complete') {
        finish();
      }
    };
  });
}
