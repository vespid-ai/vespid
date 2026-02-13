#!/usr/bin/env bash
set -euo pipefail

pattern='(BEGIN (RSA|EC|OPENSSH) PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,})'

run_search() {
  if command -v rg >/dev/null 2>&1; then
    rg -n --hidden \
      --glob '!.git/**' \
      --glob '!**/node_modules/**' \
      --glob '!**/.next/**' \
      --glob '!**/dist/**' \
      --glob '!pnpm-lock.yaml' \
      "$pattern" .
    return 0
  fi

  if command -v git >/dev/null 2>&1; then
    # Scan tracked files only; drop pnpm lock and markdown to reduce noise.
    git grep -n -I -E "$pattern" -- . | grep -v '^pnpm-lock.yaml:' | grep -v '\.md:' || true
    return 0
  fi

  echo "Neither rg nor git is available for secret scanning" >&2
  return 2
}

matches=$(run_search || true)

if [[ -n "$matches" ]]; then
  echo "Secret scan failed. Potential credentials detected:" >&2
  echo "$matches" >&2
  exit 1
fi

echo "Secret scan passed."
