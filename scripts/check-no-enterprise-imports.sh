#!/usr/bin/env bash
set -euo pipefail

if ! command -v rg >/dev/null 2>&1; then
  echo "rg is required for boundary checks" >&2
  exit 1
fi

matches=$(rg -n --hidden \
  --glob '!**/node_modules/**' \
  --glob '!**/dist/**' \
  --glob '!**/.next/**' \
  --glob '!**/*.md' \
  "@vespid/enterprise-|apps/api-enterprise|packages/enterprise-|/enterprise/" \
  apps packages tests || true)

if [[ -n "$matches" ]]; then
  echo "Found forbidden enterprise imports/references in community code:" >&2
  echo "$matches" >&2
  exit 1
fi

echo "Boundary check passed: no community -> enterprise imports detected."
