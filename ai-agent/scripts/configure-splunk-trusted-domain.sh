#!/bin/sh
set -eu

if [ ! -f .env ]; then
  printf 'Missing ai-agent/.env. Run this script from ai-agent after creating .env.\n' >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

if [ -z "${SPLUNK_REST_URL:-}" ] || [ -z "${SPLUNK_REST_TOKEN:-}" ]; then
  printf 'SPLUNK_REST_URL and SPLUNK_REST_TOKEN are required in ai-agent/.env.\n' >&2
  exit 1
fi

curl -sk \
  -H "Authorization: Bearer $SPLUNK_REST_TOKEN" \
  "$SPLUNK_REST_URL/servicesNS/nobody/system/web-features/feature:dashboards_csp" \
  -d dashboards_trusted_domain.zksplunk_ai_agent_localhost=https://localhost:8787 \
  -d dashboards_trusted_domain.zksplunk_ai_agent_loopback=https://127.0.0.1:8787 \
  -d dashboards_trusted_domain.zksplunk_ai_agent_localhost_host=localhost:8787 \
  -d dashboards_trusted_domain.zksplunk_ai_agent_loopback_host=127.0.0.1:8787 \
  -d enable_dashboards_external_content_restriction=true \
  -d enable_dashboards_redirection_restriction=true \
  >/dev/null

printf 'Configured Splunk Dashboards Trusted Domains List for https://localhost:8787.\n'
