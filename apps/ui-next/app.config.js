// Prototype identity: installs beside the stable and beta apps rather than over them.
const PACKAGE_ID = "app.frogg.next";
const rootPkg = require("../../package.json");

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
    name: "Frogg Next",
    slug: "frogg-ui-next",
    scheme: "frogg-next",
    version: rootPkg.version.replace(/-.*$/, ""),
    userInterfaceStyle: "dark",
    backgroundColor: "#080b0d",
    android: {
      package: PACKAGE_ID,
      edgeToEdgeEnabled: true,
      softwareKeyboardLayoutMode: "resize",
      // Direct ws:// connections to daemons on the local network or a tailnet.
      usesCleartextTraffic: true,
    },
    ios: { bundleIdentifier: PACKAGE_ID },
    web: { bundler: "metro", output: "single" },
    autolinking: { searchPaths: ["../../node_modules", "./node_modules"] },
    plugins: [
      "expo-router",
      ["expo-font", { android: { fonts: families } }],
      [
        "expo-build-properties",
        { android: { minSdkVersion: 29, kotlinVersion: "2.1.20", usesCleartextTraffic: true } },
      ],
    ],
    experiments: { typedRoutes: false },
  },
};
