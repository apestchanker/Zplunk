#!/bin/sh
set -eu

OUT_DIR="${1:-certs}"
CERT_PATH="$OUT_DIR/localhost.pem"
KEY_PATH="$OUT_DIR/localhost-key.pem"
CONF_PATH="$OUT_DIR/localhost-openssl.cnf"

mkdir -p "$OUT_DIR"

cat > "$CONF_PATH" <<'EOF'
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = localhost

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = ::1
EOF

openssl req \
  -x509 \
  -nodes \
  -newkey rsa:2048 \
  -days 825 \
  -keyout "$KEY_PATH" \
  -out "$CERT_PATH" \
  -config "$CONF_PATH"

printf 'Created local HTTPS cert:\n'
printf '  cert: %s\n' "$CERT_PATH"
printf '  key : %s\n' "$KEY_PATH"
printf '\nAdd these to ai-agent/.env:\n'
printf 'AI_AGENT_TLS_CERT=%s\n' "$CERT_PATH"
printf 'AI_AGENT_TLS_KEY=%s\n' "$KEY_PATH"
printf '\nIf the iframe is still blocked, open https://localhost:8787 once and trust/continue past the local certificate warning.\n'
