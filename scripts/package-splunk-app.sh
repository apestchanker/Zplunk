#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

cd "$ROOT_DIR"

# COPYFILE_DISABLE prevents macOS tar from adding AppleDouble metadata files.
COPYFILE_DISABLE=1 tar \
  --exclude='__MACOSX' \
  --exclude='.DS_Store' \
  --exclude='._*' \
  --exclude='*/.DS_Store' \
  --exclude='*/._*' \
  -C splunk-app \
  -czf zksplunk.spl \
  zksplunk

if tar -tzf zksplunk.spl | grep -E '(^|/)__MACOSX(/|$)|(^|/)\.DS_Store$|(^|/)\._' >/dev/null; then
  echo "ERROR: zksplunk.spl contains macOS metadata files" >&2
  exit 1
fi

echo "Created zksplunk.spl without macOS metadata"
