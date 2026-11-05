//! Fixture page for frogg-render: every component with sample content. `trunk serve` here,
//! or `trunk build` and serve `dist/`. With `--features bare` it renders none of them, which
//! measures the crate's wasm contribution against the same Leptos baseline.

#[cfg(feature = "bare")]
use leptos::prelude::*;

#[cfg(feature = "bare")]
fn main() {
    console_error_panic_hook::set_once();
    leptos::mount::mount_to_body(|| view! { <p>"bare"</p> });
}

#[cfg(not(feature = "bare"))]
fn main() {
    console_error_panic_hook::set_once();
    leptos::mount::mount_to_body(demo::App);
}

#[cfg(not(feature = "bare"))]
mod demo {
    use frogg_render::diff::{diff_texts, parse_unified, DiffMode, DiffView};
    use frogg_render::{Code, Markdown, Terminal, TerminalHandle};
    use leptos::prelude::*;
    use std::time::Duration;

    const MD: &str = r#"## Plan

I checked the **daemon** handler and the *client* store. Three changes:

1. Parse the `restore` frame before the first `output`.
2. Keep ~~two~~ one subscription per terminal.
3. Re-wrap scrollback on resize; see https://frogg.app/docs/terminals.

- [x] reproduce the race
- [ ] add a regression test
  - against the fake transport

> The snapshot carries per-row wrap flags since v0.1.88.

| Metric | Before | After |
|:-------|-------:|:-----:|
| attach | 412 ms | 96 ms |
| heap   | 55 MB  | 21 MB |

```rust
/// Replays a snapshot into the parser.
pub fn restore(&self, bytes: &[u8]) -> usize {
    self.reset();
    self.write(bytes); // 'a lifetimes, "strings", 0x1f
    bytes.len()
}
```

Done — open [the diff](https://example.com/diff) to review.
"#;

    const TS: &str = r#"import { useMemo } from "react";

export interface Token { text: string; style: string | null }

// Keys a line's tokens by position once.
export function keyed(tokens: Token[], n = 0): Array<Token & { id: string }> {
  return tokens.map((t) => ({ ...t, id: `t${n++}` }));
}"#;

    const PY: &str = r#"@dataclass
class Snapshot:
    rows: int = 24
    def to_ansi(self) -> str:
        """Replay as ANSI."""
        return "\x1b[0m" if self.rows > 0 else None  # reset"#;

    const JSON: &str = r#"{ "name": "frogg", "version": "1.6.14", "private": true, "workspaces": ["apps/*"], "n": 3.5e2 }"#;

    const YAML: &str = "# CI\non:\n  push:\n    branches: [frogg-next]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    timeout: 30\n";

    const SH: &str = "#!/usr/bin/env bash\nset -euo pipefail\nfor f in \"$@\"; do\n  echo \"building ${f}\" && cargo build --release # fast\ndone";

    const OLD: &str = "use std::fmt;\n\nfn main() {\n    let name = \"frogg\";\n    let count = 3;\n    println!(\"hello {}\", name);\n    for i in 0..count {\n        step(i);\n    }\n}\n\nfn step(i: u32) {\n    let x = i * 2;\n    let y = x + 1;\n    let z = y * y;\n    println!(\"{}\", z);\n}\n\nfn unused() {}\n";
    const NEW: &str = "use std::fmt;\n\nfn main() {\n    let name = \"frogg next\";\n    let count = 3;\n    println!(\"hello, {}!\", name);\n    for i in 0..count {\n        step(i);\n    }\n}\n\nfn step(i: u32) {\n    let x = i * 2;\n    let y = x + 1;\n    let z = y * y;\n    tracing::info!(z, \"stepped\");\n}\n";

    const PATCH: &str = "diff --git a/apps/client/ui/styles/app.css b/apps/client/ui/styles/app.css\nindex 1a2b3c4..5d6e7f8 100644\n--- a/apps/client/ui/styles/app.css\n+++ b/apps/client/ui/styles/app.css\n@@ -12,6 +12,7 @@ body {\n .rail {\n   width: 64px;\n-  background: var(--panel);\n+  background: var(--bg2);\n+  border-right: 1px solid var(--line);\n   transition: width 180ms var(--ease);\n }\n";

    fn term_fixture() -> String {
        let mut s = String::new();
        s.push_str(
            "\x1b[1;32mfrogg\x1b[0m@\x1b[1;34mdev\x1b[0m:\x1b[36m~/frogg\x1b[0m$ ls --color\r\n",
        );
        s.push_str("\x1b[1;34mapps\x1b[0m  \x1b[1;34mcrates\x1b[0m  Cargo.toml  \x1b[32mbuild.sh\x1b[0m  README.md\r\n");
        s.push_str("\x1b[1;32mfrogg\x1b[0m@\x1b[1;34mdev\x1b[0m:\x1b[36m~/frogg\x1b[0m$ cargo test -p frogg-render\r\n");
        s.push_str("   \x1b[1;32mCompiling\x1b[0m frogg-render v1.6.14\r\n");
        s.push_str("    \x1b[1;32mFinished\x1b[0m `test` profile in 2.1s\r\n");
        s.push_str("test result: \x1b[32mok\x1b[0m. 29 passed; \x1b[31m0 failed\x1b[0m\r\n");
        for i in 0..16 {
            s.push_str(&format!("\x1b[38;5;{}m█\x1b[0m", 16 + i * 13));
        }
        s.push_str("  \x1b[7m inverse \x1b[0m \x1b[4munderline\x1b[0m \x1b[3mitalic\x1b[0m \x1b[38;2;255;140;0mtruecolor\x1b[0m 你好\r\n");
        s.push_str("\x1b[1;32mfrogg\x1b[0m@\x1b[1;34mdev\x1b[0m:\x1b[36m~/frogg\x1b[0m$ ");
        s
    }

    #[component]
    pub fn App() -> impl IntoView {
        // Markdown streams in, a few characters at a time, to exercise incremental rendering.
        let shown = RwSignal::new(MD.len());
        let text = Signal::derive(move || MD[..shown.get()].to_string());
        let replay = move |_| {
            shown.set(0);
            let handle = set_interval_with_handle(
                move || {
                    let next = (shown.get_untracked() + 7).min(MD.len());
                    let next = (next..=MD.len()).find(|&i| MD.is_char_boundary(i)).unwrap();
                    shown.set(next);
                },
                Duration::from_millis(16),
            );
            if let Ok(h) = handle {
                set_timeout(
                    move || h.clear(),
                    Duration::from_millis(16 * (MD.len() as u64 / 7 + 4)),
                );
            }
        };

        let mode = RwSignal::new(DiffMode::Split);
        let files = Signal::derive(move || {
            let mut f = vec![diff_texts(OLD, NEW, "src/main.rs", 2)];
            f.extend(parse_unified(PATCH));
            f
        });

        let term = TerminalHandle::new(12, 80, 1000);
        term.write(term_fixture().as_bytes());
        // Local echo stands in for a shell.
        let on_input = Callback::new(move |s: String| {
            let echoed = s.replace('\r', "\r\n").replace('\x7f', "\x08 \x08");
            term.write(echoed.as_bytes());
        });
        let size = RwSignal::new((0u16, 0u16));

        view! {
            <main class="demo">
                <section>
                    <h2>"Markdown" <button on:click=replay>"stream"</button></h2>
                    <Markdown text=text on_link=Callback::new(|h: String| leptos::logging::log!("open {h}")) />
                </section>
                <section class="stack">
                    <h2>"Code"</h2>
                    <div class="file"><Code code=TS lang="App.tsx" line_numbers=true /></div>
                    <div class="file"><Code code=PY lang="py" line_numbers=true /></div>
                    <div class="file"><Code code=JSON lang="json" /></div>
                    <div class="file"><Code code=YAML lang="ci.yml" line_numbers=true /></div>
                    <div class="file"><Code code=SH lang="sh" /></div>
                </section>
                <section class="wide">
                    <h2>
                        "DiffView"
                        <button class:on=move || mode.get() == DiffMode::Unified on:click=move |_| mode.set(DiffMode::Unified)>"unified"</button>
                        <button class:on=move || mode.get() == DiffMode::Split on:click=move |_| mode.set(DiffMode::Split)>"split"</button>
                    </h2>
                    <DiffView files=files mode=mode />
                </section>
                <section class="wide">
                    <h2>"Terminal " {move || { let (c, r) = size.get(); format!("{c}×{r}") }}</h2>
                    <div class="term">
                        <Terminal handle=term on_input=on_input on_resize=Callback::new(move |s| size.set(s)) />
                    </div>
                </section>
            </main>
        }
    }
}
