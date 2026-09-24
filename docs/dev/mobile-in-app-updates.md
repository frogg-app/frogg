# Android in-app updating

What shipped on `add-in-app-update-mobile`, why it is built this way, and what still has to
be proven on a device. The user-facing description lives in
[Android and iOS](../../website/src/content/docs/docs/desktop-mobile-cli/mobile.mdx#updates).

## What it does

Settings > About > **Updates** on Android:

- reads the published releases from the GitHub API (`brand.distribution.releasesApi`),
- picks the newest release for the chosen channel (Stable hides betas, Beta shows both),
- picks the APK asset that matches this device and this install,
- downloads it into the app's cache with progress, and
- commits a `PackageInstaller` session so Android replaces the running app.

A sidebar callout offers the update at startup, so discovery does not depend on opening
Settings. Both surfaces share one updater instance per app run, so a download started from
either is the same download.

## Why these choices

**`PackageInstaller`, not an `ACTION_VIEW` intent.** A session streams the APK straight out
of the app's own cache directory, so there is no FileProvider to declare, no world-readable
copy of the package, and the install result comes back as a status broadcast rather than
being lost to a fire-and-forget intent. The system still shows its own confirmation.

**Signing flavour decides the asset.** Android only replaces an app with a package carrying
the same signing key. The native module reads the installed app's own certificate and reports
whether it is the publicly known Android debug key, and the picker offers `-unsigned`
(debug-signed) or the plain APK to match. When only the mismatched build exists, the app says
so instead of starting an install Android would reject. This is the part the earlier prototype
(recorded in the since-removed outstanding-work note) got wrong: it hardcoded arm64 and refused unsigned
assets, which are exactly the assets every current install needs.

**ABI order comes from the device.** `Build.SUPPORTED_ABIS` is walked in preference order and
the universal build is the last resort, so publishing more ABIs later needs no app change.

**The native module carries its own permission.** `REQUEST_INSTALL_PACKAGES` is declared in
`modules/frogg-app-installer/android/src/main/AndroidManifest.xml`, and the module is in the
F-Droid autolinking exclusion list. A build without the module therefore has neither the
permission nor the updater — which is what F-Droid's inclusion policy requires, since its
client owns those updates. There is no iOS path: the module is Android-only, so
`requireOptionalNativeModule` returns null and the section hides itself.

**The install promise usually never resolves.** A successful install stops the process, so
`installApk` in practice only comes back for cancellation (`STATUS_FAILURE_ABORTED`) and
failure. The state machine treats "cancelled" as returning to the offer, not as an error.

## Code map

| Concern                                                                      | File                                                                                                      |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Kotlin module: ABI list, signing probe, permission screen, install session   | `apps/ui/modules/frogg-app-installer/android/src/main/java/sh/frogg/installer/FroggAppInstallerModule.kt` |
| JS wrapper, and the `permission-required` outcome it raises itself           | `apps/ui/src/mobile/updates/android-app-installer.ts`                                                     |
| Pure logic: version compare, asset-name parsing, asset and release selection | `apps/ui/src/mobile/updates/mobile-updates.ts`                                                            |
| State machine: check, download progress, install outcomes                    | `apps/ui/src/mobile/updates/mobile-app-updater.ts`                                                        |
| Ports: GitHub fetch, `expo-file-system` download, installer call             | `apps/ui/src/mobile/updates/use-mobile-app-updater.ts`                                                    |
| Settings card and startup callout                                            | `mobile-updates-section.tsx`, `mobile-update-callout-source.tsx`                                          |
| Preferences `mobileUpdateAutoCheck`, `mobileUpdateChannel`                   | `apps/ui/src/hooks/use-settings/storage.ts`                                                               |
| Strings under `mobile.updates.*` in all nine locales                         | `apps/ui/src/i18n/resources/`                                                                             |

## Verified

- 22 unit tests over the pure selection logic and the state machine; the full `@frogg/app`
  suite (5519 tests) passes, as do the workspace typecheck, oxlint and oxfmt.
- The Settings card was rendered in `npm run preview` with the check stubbed. That caught a
  real bug: two buttons beside the title squeezed the text column to one character per line
  at phone width, so the card header is stacked rather than a standard settings row. It also
  showed the status line and the last-checked line repeating the same timestamp, so the
  status strings no longer mention it.

## Not verified

The native path has never been compiled or run: this VM has no Android SDK. A device run
still has to show that

1. the install-unknown-apps prompt appears and the settings screen opens,
2. the system confirmation appears and the APK replaces the running app in place,
3. app data survives the replacement, and
4. a debug-signed install is offered the `-unsigned` asset rather than being told the
   signatures differ.

Tracked as an unchecked item in `ROADMAP.md`.
