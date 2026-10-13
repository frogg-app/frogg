const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);
config.resolver.useWatchman = false;
config.resolver.unstable_enablePackageExports = true;

// @frogg/relay ships TypeScript sources with NodeNext `.js` specifiers.
const relaySrc = path.resolve(__dirname, "../../packages/relay/src");
const aotShim = path.resolve(__dirname, "src/shims/ws-outbound-aot.ts");
const fallback = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, name, platform) => {
  const resolve = fallback ?? context.resolveRequest;
  if (name.endsWith("/generated/validation/ws-outbound.aot.js")) {
    return { type: "sourceFile", filePath: aotShim };
  }
  if (
    context.originModulePath.startsWith(relaySrc) &&
    name.startsWith(".") &&
    name.endsWith(".js")
  ) {
    return resolve(context, name.replace(/\.js$/, ".ts"), platform);
  }
  return resolve(context, name, platform);
};
module.exports = config;
