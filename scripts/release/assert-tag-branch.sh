#!/usr/bin/env bash
# Stable tags must be on main, -beta.N tags on beta. The policy lives in
# scripts/release/release-branches.mjs; it is repeated here so the release
# workflow can check it before any node dependencies are installed.
set -euo pipefail
tag="${1:?usage: assert-tag-branch.sh <tag>}"
case "${tag#v}" in
  *-*) branch=beta ;;
  *) branch=main ;;
esac
if ! git fetch --quiet origin "+refs/heads/$branch:refs/remotes/origin/$branch"; then
  echo "::error::$tag needs origin/$branch, which does not exist. Stable releases are cut from main, betas from beta."
  exit 1
fi
if ! git merge-base --is-ancestor "$tag^{commit}" "origin/$branch"; then
  echo "::error::$tag is not on origin/$branch. Stable releases are cut from main, betas from beta."
  exit 1
fi
echo "$tag is on origin/$branch."
