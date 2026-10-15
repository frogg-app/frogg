// Name, package id and scheme come from the brand's Frogg Next identity (desktop/identity.cjs):
// the prerelease "Frogg Next" app beside the classic one now, the stable identity once promoted.
const rootPkg = require("../../package.json");
const { loadBrand } = require("../../scripts/dev/branding/load.cjs");
const { resolveIdentity } = require("./desktop/identity.cjs");
const identity = resolveIdentity(loadBrand());
// Read by the web/native bundle (pairing schemes, the in-app updater); the build scripts set the
// same values for the bundler processes they start.
process.env.EXPO_PUBLIC_FROGG_APP_SCHEME = identity.scheme;
process.env.EXPO_PUBLIC_FROGG_ARTIFACT_PREFIX = identity.artifactPrefix;
process.env.EXPO_PUBLIC_FROGG_RELEASE_REPO = identity.repository;
// Same env-driven release signing as the classic app; scripts/build-apk.mjs documents the variables.
const withAndroidReleaseSigning = require("../ui/plugins/with-android-release-signing");

const font = (file, weight, style = "normal") => ({
  path: `./assets/fonts/${file}.ttf`,
  weight,
  style,
});
const families = [
  {
    fontFamily: "Inter",
    fontDefinitions: [
      font("Inter-Regular", 400),
      font("Inter-Italic", 400, "italic"),
      font("Inter-Medium", 500),
      font("Inter-SemiBold", 600),
    ],
  },
  {
    fontFamily: "Space Grotesk",
    fontDefinitions: [
      font("SpaceGrotesk-Medium", 500),
      font("SpaceGrotesk-SemiBold", 600),
      font("SpaceGrotesk-Bold", 700),
    ],
  },
  {
    fontFamily: "JetBrains Mono",
    fontDefinitions: [
      font("JetBrainsMono-Regular", 400),
      font("JetBrainsMono-Italic", 400, "italic"),
      font("JetBrainsMono-Medium", 500),
    ],
  },
];

module.exports = {
  expo: {
    name: identity.name,
    slug: "frogg-ui-next",
    scheme: identity.scheme,
    version: rootPkg.version.replace(/-.*$/, ""),
    userInterfaceStyle: "dark",
    backgroundColor: "#080b0d",
    android: {
      package: identity.applicationId,
      edgeToEdgeEnabled: true,
      softwareKeyboardLayoutMode: "resize",
      // Direct ws:// connections to daemons on the local network or a tailnet.
      usesCleartextTraffic: true,
    },
    ios: { bundleIdentifier: identity.applicationId },
    web: { bundler: "metro", output: "single" },
    // ./modules links the classic app's FroggAppInstaller (APK self-update) by symlink.
    autolinking: {
      searchPaths: ["../../node_modules", "./node_modules"],
      nativeModulesDir: "./modules",
    },
    plugins: [
      "expo-router",
      ["expo-font", { android: { fonts: families } }],
      [
        "expo-build-properties",
        { android: { minSdkVersion: 29, kotlinVersion: "2.1.20", usesCleartextTraffic: true } },
      ],
      withAndroidReleaseSigning,
    ],
    // FROGG_WEB_BASE_URL serves a web export from a subpath (the component lab build uses /lab).
    experiments: {
      typedRoutes: false,
      ...(process.env.FROGG_WEB_BASE_URL ? { baseUrl: process.env.FROGG_WEB_BASE_URL } : {}),
    },
  },
};
