# Frogg Next RS (apps/client)

The Rust Frogg client: a port of `apps/ui-next` to a Leptos UI compiled to WebAssembly, a Rust
client core, and a Tauri v2 shell for desktop and Android. Architecture: `docs/plans/rust-client.md`;
workstreams and contracts: `docs/plans/rust-client-work.md`.

## Layout

| Path                          | Crate               | What                                                                                      |
| ----------------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| `core/`                       | `frogg-client-core` | `DaemonClient`: WebSocket and relay (E2EE) transports, RPCs, binary frames, reconnect     |
| `render/`                     | `frogg-render`      | Markdown, syntax highlight, diff and terminal components; `styles/render.css`             |
| `ui/`                         | `frogg-ui`          | Leptos CSR app (Trunk). `src/shell` app chrome, `src/views` screens, `src/state` stores   |
| `ui/styles/`                  |                     | Plain CSS on the theme's custom properties (`theme.css` mirrors `ui-next/src/theme`)      |
| `src-tauri/`                  | `frogg-app`         | Tauri v2 shell, native bridge (`ui/src/native` is the UI side), Android project in `gen/` |
| `scripts/shot.mjs`            |                     | Headless Chromium screenshot helper (dev only)                                            |
| `../../crates/frogg-protocol` | `frogg-protocol`    | Generated wire types                                                                      |

Overlays: every modal `Sheet` portals itself to `<body>`; `Floating` popovers stay anchored in
their parent. One stacking scale lives at the top of `ui/styles/components.css`.

## Prerequisites

- Rust stable with `wasm32-unknown-unknown` (`rustup target add wasm32-unknown-unknown`)
- `trunk` (`cargo install trunk`), `tauri-cli` v2 (`cargo install tauri-cli`) for the shell
- Android: SDK (platform 36, build-tools 35), NDK 27, JDK 17, and the Android Rust targets
  (`rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`)

## Build and run

From `apps/client`:

```sh
# Browser: serves on http://localhost:1420 with rebuild on save
cd ui && trunk serve

# Release web bundle into ui/dist
cd ui && trunk build --release

# Desktop shell (runs trunk serve for you)
cargo tauri dev
cargo tauri build            # bundles for the current OS

# Android
cargo tauri android dev      # device or emulator
cargo tauri android build --apk
```

In the browser the app first tries the page's own origin as a host (`/ws`), which is right when a
daemon serves the bundle. Under `trunk serve` add your daemon from the Hosts sheet
(address `127.0.0.1:6767`, plus its password if it has one).

## Checks

```sh
cargo fmt --check
cargo clippy --workspace -- -D warnings
cargo clippy -p frogg-ui -p frogg-render -p frogg-client-core --target wasm32-unknown-unknown -- -D warnings
cargo test --workspace
cargo check -p frogg-ui --target wasm32-unknown-unknown
```

CI (`.github/workflows/rust-client.yml`) runs the wasm check and the core/render tests, builds the
desktop bundles and the Android APK, and attaches them to `-next.N` releases.

Release wasm size at the time of writing: about 5.1 MB raw, 1.9 MB gzip.

## Known gaps

- Settings pages not built yet are hidden from the list: Voice & Companion, Context & clean cut,
  Tools/skills/prompts, Security and Session labels.
- Android back: a sheet or popover opened from the root screen isn't closed by back (it leaves
  the app); everywhere else back closes the topmost view first.
