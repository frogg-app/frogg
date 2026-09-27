/**
 * Explicit entrypoint for the install-script Worker and the SSH deploy engine.
 * Only the native app build imports it (`ssh-deploy-bridge.native.ts`), so it
 * stays out of the web bundle.
 */
export { installers } from "./generated/installers.js";
