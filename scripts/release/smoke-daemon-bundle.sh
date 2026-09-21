#!/usr/bin/env bash
# Smoke-tests a daemon bundle tarball on the current host: extracts it into a
# temp dir, starts the daemon through the bundle's launcher, waits for
# `daemon status` to report running, fetches the web UI over HTTP, then stops
# the daemon.
#
# The launcher is named after the brand's cliName, not "frogg": a branded
# bundle ships bin/<cliName> and no bin/frogg at all, because build-daemon-bundle
# only writes the upstream alias when brand.legacyFrogg is set. So the name is
# discovered from bin/ rather than assumed, and this runs against any brand.
#
# Usage: scripts/release/smoke-daemon-bundle.sh <bundle.tar.gz> [port]
set -euo pipefail

bundle="${1:?usage: $0 <bundle.tar.gz> [port]}"
port="${2:-6798}"
listen="0.0.0.0:${port}"

work="$(mktemp -d "${TMPDIR:-/tmp}/frogg-bundle-smoke.XXXXXX")"
home="${work}/home"
mkdir -p "${home}"

cli=""
cleanup() {
  if [ -n "${cli}" ]; then
    "${cli}" daemon stop --home "${home}" --json >/dev/null 2>&1 || true
  fi
  rm -rf "${work}"
}
trap cleanup EXIT

mkdir -p "${work}/bundle"
tar -xzf "${bundle}" --strip-components=1 -C "${work}/bundle"

# One launcher per bundle, named for the brand's cliName (bin/frogg, ...).
# The stock brand additionally writes the "frogg" alias over the same name, so
# either way bin/ holds exactly one entry; prefer "frogg" if that ever changes.
bin_dir="${work}/bundle/bin"
if [ -x "${bin_dir}/frogg" ]; then
  cli="${bin_dir}/frogg"
else
  cli="$(find "${bin_dir}" -maxdepth 1 -type f -perm -u+x | sort | head -n 1)"
fi
if [ -z "${cli}" ] || [ ! -x "${cli}" ]; then
  echo "no executable launcher in ${bin_dir}:" >&2
  ls -la "${bin_dir}" >&2 || true
  exit 1
fi

echo "manifest: $(tr -d '\n ' < "${work}/bundle/manifest.json")"
echo "launcher: $(basename "${cli}")"
echo "$(basename "${cli}") --version: $("${cli}" --version)"

"${cli}" daemon start --listen "${listen}" --no-relay --web-ui --home "${home}"

for _ in $(seq 1 60); do
  status="$("${cli}" daemon status --home "${home}" --json 2>/dev/null || true)"
  if printf '%s' "${status}" | grep -q '"localDaemon": *"running"'; then
    break
  fi
  sleep 1
done
if ! printf '%s' "${status}" | grep -q '"localDaemon": *"running"'; then
  echo "daemon did not reach running state:" >&2
  printf '%s\n' "${status}" >&2
  cat "${home}/daemon.log" >&2 || true
  exit 1
fi
echo "daemon status: running (listen ${listen})"

html="$(curl -fsS "http://127.0.0.1:${port}/")"
if ! printf '%s' "${html}" | grep -qi '<html'; then
  echo "web UI did not return HTML:" >&2
  printf '%s\n' "${html}" | head -c 500 >&2
  exit 1
fi
echo "web UI: OK ($(printf '%s' "${html}" | wc -c) bytes of HTML)"

"${cli}" daemon stop --home "${home}" --json
echo "smoke test passed"
