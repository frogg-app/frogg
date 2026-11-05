//! `Code` (highlighted source, optional line gutter) and `CodeFence` (a markdown code block
//! with a copy button), after ui-next's `Code.tsx` and `Markdown.tsx` `CodeFence`.

use crate::highlight::{highlight, Token};
use crate::icons::{CheckIcon, CopyIcon};
use leptos::prelude::*;
use std::time::Duration;

/// Tokens as spans with their `tk-<role>` classes.
pub fn tokens_view(tokens: Vec<Token>) -> impl IntoView {
    tokens
        .into_iter()
        .map(|t| match t.role {
            Some(r) => view! { <span class=r.class()>{t.text}</span> }.into_any(),
            None => t.text.into_any(),
        })
        .collect_view()
}

/// Highlighted code. `lang` is a language name, alias or file name/path. Re-highlights when
/// `code` changes; unchanged lines keep their DOM.
#[component]
pub fn Code(
    #[prop(into)] code: Signal<String>,
    #[prop(into, optional)] lang: Signal<String>,
    /// Show a line-number gutter (whole files); off for snippets.
    #[prop(optional)]
    line_numbers: bool,
    /// Wrap long lines instead of scrolling horizontally.
    #[prop(optional)]
    wrap: bool,
) -> impl IntoView {
    let lines = Memo::new(move |_| code.with(|c| lang.with(|l| highlight(c, l))));
    let rows = move || lines.get().into_iter().enumerate().collect::<Vec<_>>();
    view! {
        <div class="fr-code" class:fr-code-numbered=line_numbers class:fr-code-wrap=wrap>
            <div class="fr-code-lines">
                <For
                    each=rows
                    key=|(n, toks)| (*n, toks.clone())
                    children=move |(n, toks)| {
                        view! {
                            <div class="fr-code-line">
                                {line_numbers.then(|| view! { <span class="fr-code-no">{n + 1}</span> })}
                                <span class="fr-code-src">{tokens_view(toks)}</span>
                            </div>
                        }
                    }
                />
            </div>
        </div>
    }
}

const COPIED_MS: u64 = 1400;

/// Writes text to the clipboard (best effort).
pub fn copy_text(text: &str) {
    if let Some(w) = web_sys::window() {
        let _ = w.navigator().clipboard().write_text(text);
    }
}

/// A fenced code block: highlighted, with a copy button that turns into a tick while fresh.
#[component]
pub fn CodeFence(
    #[prop(into)] code: Signal<String>,
    #[prop(into, optional)] lang: Signal<String>,
) -> impl IntoView {
    let copied = RwSignal::new(false);
    let copy = move |_| {
        copy_text(&code.get_untracked());
        copied.set(true);
        set_timeout(move || copied.set(false), Duration::from_millis(COPIED_MS));
    };
    let label = move || {
        let l = lang.get();
        let l = l.split([' ', ',', '{']).next().unwrap_or("").to_string();
        (!l.is_empty()).then(|| view! { <span class="fr-fence-lang">{l}</span> })
    };
    view! {
        <div class="fr-fence">
            {label}
            <Code code=code lang=lang />
            <button
                class="fr-fence-copy"
                class:copied=move || copied.get()
                on:click=copy
                aria-label=move || if copied.get() { "Copied" } else { "Copy code" }
            >
                {move || if copied.get() { view! { <CheckIcon /> }.into_any() } else { view! { <CopyIcon /> }.into_any() }}
            </button>
        </div>
    }
}
