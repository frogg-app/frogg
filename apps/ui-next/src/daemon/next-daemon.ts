// Frogg Next's own daemon: `-next.N` releases ship it beside the stable one (port 9969,
// ~/.frogg-next, the `frogg-next` CLI), so Frogg Next can be developed without touching a
// host's stable daemon. Its install script is the one attached to this app's own release.
const APP_VERSION: string = require("../../package.json").version;
const REPOSITORY = process.env.EXPO_PUBLIC_FROGG_RELEASE_REPO?.trim() || "frogg-app/frogg";

/** The Frogg Next daemon's CLI on a host. */
export const NEXT_CLI = "frogg-next";

/** Installs the Frogg Next daemon at this app's version. */
export const NEXT_INSTALL_COMMAND = `curl -fsSL https://github.com/${REPOSITORY}/releases/download/v${APP_VERSION}/install.sh | bash`;
