#!/usr/bin/env bash
set -euo pipefail

pattern='@vespid/enterprise-|apps/api-enterprise|packages/enterprise-|/enterprise/'

run_search() {
  if command -v rg >/dev/null 2>&1; then
    rg -n --hidden \
      --glob '!**/node_modules/**' \
      --glob '!**/dist/**' \
      --glob '!**/.next/**' \
      --glob '!**/*.md' \
      "$pattern" \
      apps packages tests
    return 0
  fi

  # GitHub-hosted runners don't guarantee ripgrep. Fall back to git grep.
  if command -v git >/dev/null 2>&1; then
    # Keep it on tracked files to avoid scanning deps; drop markdown matches.
    git grep -n -I -E "$pattern" -- apps packages tests | grep -v '\.md:' || true
    return 0
  fi

  echo "Neither rg nor git is available for boundary checks" >&2
  return 2
}

matches=$(run_search || true)

if [[ -n "$matches" ]]; then
  echo "Found forbidden enterprise imports/references in community code:" >&2
  echo "$matches" >&2
  exit 1
fi

echo "Boundary check passed: no community -> enterprise imports detected."
