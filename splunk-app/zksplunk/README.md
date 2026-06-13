# ZKSplunk — Splunk Enterprise app

Installable Splunk app that turns ZKSplunk telemetry into a health dashboard,
saved searches, and alert rules for local Midnight infrastructure.

## What it ships

```
default/app.conf                         app registration
default/indexes.conf                     the `zksplunk` index
default/props.conf                       JSON parsing for all 4 sourcetypes
default/savedsearches.conf               10 alert rules (one critical email rule enabled)
default/data/ui/nav/default.xml          navigation
default/data/ui/views/zksplunk_global_map.xml   the default geographic operator map
default/data/ui/views/zksplunk_overview.xml   the original overview dashboard
default/data/ui/views/zksplunk_component_detail.xml   per-component drilldown
default/data/ui/views/zksplunk_operator_summary.xml   1AM operator cluster summary
default/data/ui/views/zksplunk_ai_toolkit_analyst.xml   native Splunk AI Toolkit analyst tab
default/data/ui/views/zksplunk_mcp_analyst.xml   local MCP/chat fallback view
default/data/ui/views/zksplunk_attestation.xml   anonymous attestation relayer pipeline
appserver/static/zksplunk_chat_embed.html   browser-side chat shell for the analyst API
lookups/zksplunk_component_locations.csv   editable component geography metadata
metadata/default.meta                    global read sharing
```

Sourcetypes parsed: `midnight:vitals`, `midnight:chain`, `midnight:contracts`,
`zksplunk:connector`, `zksplunk:relayer`.

## Install (local Splunk Enterprise)

1. Copy this directory into Splunk:

   ```
   cp -r splunk-app/zksplunk "$SPLUNK_HOME/etc/apps/zksplunk"
   ```

2. Restart Splunk:

   ```
   "$SPLUNK_HOME/bin/splunk" restart
   ```

3. Enable HEC on **:8090** (the Midnight indexer uses :8088) and create a HEC
   token scoped to the `zksplunk` index. Confirm:

   ```
   curl -k https://localhost:8090/services/collector/health
   ```

4. Point the agent at HEC (see `zkMonitor/.env.zkmonitor`) and start it. Validate:

   ```spl
   index=zksplunk | stats count by sourcetype type
   ```

5. Open **Apps -> ZKSplunk -> ZKSplunk Global Map**. Click a component marker
   (`indexer`, `proof-server`, `wallet`, `node`) to open its detail drilldown.
   Click the **1AM Operator Cluster** badge to open the operator summary.

6. Open **ZKSplunk AI Toolkit Analyst** to ask questions inside Splunk. This
   view gathers live evidence from `index=zksplunk` and phrases the response
   with Splunk AI Toolkit's `| ai` command. The tested local connection is
   `ZKsplunk3`, configured as `provider=Gemini` and
   `model=gemini-2.5-flash`, so the view calls:

   ```spl
   | ai prompt="{prompt}" provider=Gemini model=gemini-2.5-flash
   ```

   It requires AI Toolkit installed and a role with
   `apply_ai_commander_command`.

   Splunk AI Toolkit marks the `ai` search command as risky by default. In the
   local demo instance, set the command override to avoid the dashboard
   confirmation gate:

   ```spl
   | rest /servicesNS/nobody/Splunk_ML_Toolkit/configs/conf-commands/ai
   ```

   Confirm `is_risky=0`. Without that local override, Splunk Web shows
   "Action required" and asks the operator to approve the query before the
   visualization runs.

7. If AI Toolkit is unavailable, open **ZKSplunk MCP Analyst** as a fallback.
   That view links to the local analyst service at `http://localhost:8787`.

## Geographic operator map

The default page is a geographic operator map for the current MVP cluster:

| Component | Initial location metadata |
|---|---|
| `indexer` | USA - 1AM host TBD |
| `node` | USA - 1AM host TBD |
| `wallet` | Wallet host TBD |
| `proof-server` | Buenos Aires, Argentina |

Edit `lookups/zksplunk_component_locations.csv` when 1AM confirms exact host
regions. Health colors still come from live Splunk events in `index=zksplunk`.

## Alert rules

Most saved searches in `savedsearches.conf` ship **scheduled but email-off**.
The general **ZKSplunk - Any Critical Event Email** rule ships with email
enabled for `apestchanker@gmail.com`. Each alert triggers when its search
returns any row, and is tracked under **Activity → Triggered Alerts**. For email
delivery, configure SMTP under **Settings → Server settings → Email settings**.

| Saved search | Fires when |
|---|---|
| ZKSplunk - Proof Server Outage | latest proof-server vital is `critical` |
| ZKSplunk - Proof Latency Degradation | p95 proof latency > 2000ms over a rolling window |
| ZKSplunk - Indexer Outage | latest indexer vital is `critical` |
| ZKSplunk - Indexer Latency Degradation | p95 indexer latency > 1000ms |
| ZKSplunk - Node Outage | latest node vital is `critical` |
| ZKSplunk - Block Height Stalled | block height unchanged or block age > 60s |
| ZKSplunk - Connector Silence | no heartbeat > 120s, or failures/queue > 0 |
| ZKSplunk - HEC Delivery Failures | any failed HEC delivery batch in 15m |
| ZKSplunk - Critical Components Last 15m | any critical component event in 15m |
| ZKSplunk - Any Critical Event Email | any critical ZKSplunk event in the last 2m; sends email to `apestchanker@gmail.com` |

## Privacy boundary

This app reports public infrastructure metadata only — proof-server/indexer/node
reachability and latency, public block metadata, and public contract
monitorability. It does **not** surface private Midnight state, witness
arguments, shielded parties, or shielded amounts.
