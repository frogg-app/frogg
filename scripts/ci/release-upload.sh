#!/usr/bin/env bash
# Upload one asset to a GitHub release, retrying transient GitHub failures.
# Usage: release-upload.sh <tag> <file> <clobber:true|false>
#
# GitHub sometimes answers an upload with HTTP 500 after it has already created
# the asset, so the next attempt fails with 422 "ReleaseAsset.name already
# exists" even under --clobber. Before each retry, delete whatever this loop's
# own earlier attempt may have left behind, then upload again.
set -uo pipefail
tag=$1 file=$2 clobber=${3:-false}
name=$(basename "$file")
flags=()
if [ "$clobber" = "true" ]; then flags+=(--clobber); fi
for attempt in 1 2 3 4 5; do
  if [ "$attempt" -gt 1 ]; then
    sleep $((attempt * 10))
    if gh release view "$tag" --json assets --jq '.assets[].name' | grep -qx -- "$name"; then
      gh release delete-asset "$tag" "$name" --yes || true
    fi
  fi
  if gh release upload "$tag" "$file" "${flags[@]}"; then
    exit 0
  fi
  echo "::warning::upload of $name failed (attempt $attempt)"
done
echo "::error::upload of $name failed after 5 attempts"
exit 1
