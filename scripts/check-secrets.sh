#!/usr/bin/env bash
set -euo pipefail

if ! command -v rg >/dev/null 2>&1; then
  echo "rg is required for secret scanning" >&2
  exit 1
fi

pattern='(BEGIN (RSA|EC|OPENSSH) PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,})'

matches=$(rg -n --hidden \
  --glob '!.git/**' \
  --glob '!**/node_modules/**' \
  --glob '!**/.next/**' \
  --glob '!**/dist/**' \
  --glob '!pnpm-lock.yaml' \
  "$pattern" . || true)

if [[ -n "$matches" ]]; then
  echo "Secret scan failed. Potential credentials detected:" >&2
  echo "$matches" >&2
  exit 1
fi

echo "Secret scan passed."
