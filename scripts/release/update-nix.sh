#!/usr/bin/env bash
# Fix workspace-local lockfile entries and update the Nix dependency hash.
# Requires: node, npm, and either nix or docker
#
# Usage:
#   ./scripts/release/update-nix.sh          # fix lockfile + update hash
#   ./scripts/release/update-nix.sh --check  # verify everything is up to date (CI mode)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOCK_FILE="$ROOT_DIR/package-lock.json"
HASH_FILE="$ROOT_DIR/deploy/nix/npm-deps.hash"

CHECK_MODE=false
if [[ "${1:-}" == "--check" ]]; then
  CHECK_MODE=true
fi

# 1. Fix lockfile (add resolved/integrity for workspace-local entries)
#    Workaround for https://github.com/npm/cli/issues/4460
echo "Fixing lockfile..."
node "$ROOT_DIR/scripts/ci/fix-lockfile.mjs" "$LOCK_FILE"

# 2. Prefetch deps and compute hash
echo "Prefetching npm dependencies..."

# Resolve prefetch-npm-deps from the same nixpkgs pinned in flake.lock
NIXPKGS_URL="$(node -p "
  const l = JSON.parse(require('fs').readFileSync('$ROOT_DIR/deploy/nix/flake.lock', 'utf8'));
  const n = l.nodes.nixpkgs.locked;
  'github:' + n.owner + '/' + n.repo + '/' + n.rev;
")"

STDERR_LOG="$(mktemp)"
trap "rm -f '$STDERR_LOG'" EXIT

# The release host does not necessarily have Nix, but it does build containers.
# Fall back to the same image CI uses (scripts/ci/branding-nix.sh) so cutting a
# release refreshes this hash wherever the cut happens.
prefetch_with_nix() {
  nix shell "${NIXPKGS_URL}#prefetch-npm-deps" -c prefetch-npm-deps "$LOCK_FILE"
}

prefetch_with_docker() {
  docker run --rm -v "$ROOT_DIR:/work:ro" -w /work \
    -e NIX_CONFIG='experimental-features = nix-command flakes' \
    nixos/nix:latest \
    sh -c "nix shell '${NIXPKGS_URL}#prefetch-npm-deps' -c prefetch-npm-deps package-lock.json" |
    tail -1
}

if command -v nix > /dev/null 2>&1; then
  PREFETCH=prefetch_with_nix
elif command -v docker > /dev/null 2>&1; then
  echo "No nix on PATH; prefetching through the nixos/nix container."
  PREFETCH=prefetch_with_docker
else
  echo "ERROR: this needs either nix or docker to compute the dependency hash." >&2
  echo "Install Nix, or run: docker run --rm -v \"\$PWD:/work:ro\" -w /work nixos/nix:latest ..." >&2
  exit 1
fi

if ! NEW_HASH="$($PREFETCH 2>"$STDERR_LOG")"; then
  echo "ERROR: prefetch-npm-deps failed:" >&2
  tail -20 "$STDERR_LOG" >&2
  exit 1
fi
echo "Computed hash: $NEW_HASH"

# 3. Read current hash from the sidecar file
CURRENT_HASH="$(tr -d '[:space:]' < "$HASH_FILE")"

if [[ "$NEW_HASH" == "$CURRENT_HASH" ]]; then
  echo "Hash is already up to date."
else
  if $CHECK_MODE; then
    echo "ERROR: npmDepsHash is stale."
    echo "  current: $CURRENT_HASH"
    echo "  correct: $NEW_HASH"
    echo "Run ./scripts/release/update-nix.sh to fix."
    exit 1
  fi

  echo "Updating deploy/nix/npm-deps.hash..."
  printf '%s\n' "$NEW_HASH" > "$HASH_FILE"
  echo "Updated: $CURRENT_HASH -> $NEW_HASH"
fi
