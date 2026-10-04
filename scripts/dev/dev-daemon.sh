#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/../../node_modules/.bin:$PATH"

source "$SCRIPT_DIR/dev-home.sh"

configure_dev_frogg_home

if [ -z "${FROGG_LOCAL_MODELS_DIR}" ]; then
  export FROGG_LOCAL_MODELS_DIR="$FROGG_HOME/models/local-speech"
  mkdir -p "$FROGG_LOCAL_MODELS_DIR"
fi

echo "══════════════════════════════════════════════════════"
echo "  ${FROGG_DEV_PRODUCT_NAME} Dev Daemon"
echo "══════════════════════════════════════════════════════"
echo "  Home:    ${FROGG_HOME}"
echo "  Models:  ${FROGG_LOCAL_MODELS_DIR}"
echo "  Listen:  ${FROGG_LISTEN}"
echo "══════════════════════════════════════════════════════"

export FROGG_CORS_ORIGINS="${FROGG_CORS_ORIGINS:-*}"

# The dev daemon trusts LAN clients whatever the brand default, so devices on the network
# connect without pairing. Set <PREFIX>_TRUST_LAN=false to opt out.
brand_prefix="$(node -p 'require(process.argv[1]).envPrefix.replace(/_+$/, "")' "$(default_dev_frogg_root)/.generated/branding/brand.json")"
trust_lan_var="${brand_prefix}_TRUST_LAN"
export "$trust_lan_var=${!trust_lan_var:-true}"
export FROGG_NODE_INSPECT="${FROGG_NODE_INSPECT:---inspect=0}"

if [ "${FROGG_SKIP_DEV_SERVER_BUILD:-0}" = "1" ]; then
  exec npm run dev:server:watch
fi

exec sh -c 'npm run build:server-deps && npm run dev:server:watch'
