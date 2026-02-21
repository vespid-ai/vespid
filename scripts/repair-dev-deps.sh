#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

check_failed=0

run_check() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "[deps] ok: ${label}"
    return
  fi
  check_failed=1
  echo "[deps] missing: ${label}"
}

echo "[deps] verifying workspace dependency links..."
run_check "api -> fastify" pnpm --filter @vespid/api exec node -e "import('fastify')"
run_check "gateway -> fastify" pnpm --filter @vespid/gateway exec node -e "import('fastify')"
run_check "engine-runner -> fastify" pnpm --filter @vespid/engine-runner exec node -e "import('fastify')"
run_check "db -> drizzle-orm" pnpm --filter @vespid/db exec node -e "import('drizzle-orm')"
run_check "scheduler -> @vespid/db" pnpm --filter @vespid/scheduler exec tsx -e "import('@vespid/db')"

if [[ "$check_failed" -eq 0 ]]; then
  echo "[deps] all checks passed."
  exit 0
fi

echo "[deps] repairing workspace links (offline)..."
if ! pnpm -r install --offline; then
  echo "[deps] offline repair failed, retrying with online install..."
  pnpm -r install
fi

echo "[deps] rechecking dependency links..."
check_failed=0
run_check "api -> fastify" pnpm --filter @vespid/api exec node -e "import('fastify')"
run_check "gateway -> fastify" pnpm --filter @vespid/gateway exec node -e "import('fastify')"
run_check "engine-runner -> fastify" pnpm --filter @vespid/engine-runner exec node -e "import('fastify')"
run_check "db -> drizzle-orm" pnpm --filter @vespid/db exec node -e "import('drizzle-orm')"
run_check "scheduler -> @vespid/db" pnpm --filter @vespid/scheduler exec tsx -e "import('@vespid/db')"

if [[ "$check_failed" -ne 0 ]]; then
  echo "[deps] repair failed. Please run 'pnpm -r install' manually and retry."
  exit 1
fi

echo "[deps] repair complete."
