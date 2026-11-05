//! The session-list status summary (ui-next `sessions/StatusSummary.tsx`): a proportional stacked
//! bar plus a legend of bucket counts. The bar wipes in on mount, segments glide on the shared
//! curve, and a bucket whose count rises flashes (needs: two bleeps, failed: one sharp flash,
//! review: a soft glow) and pops its glyph.

use std::collections::HashMap;

use leptos::prelude::*;

use crate::components::StatusGlyph;
use crate::state::Bucket;

const LEGEND: [(Bucket, &str); 5] = [
    (Bucket::Needs, "needs you"),
    (Bucket::Failed, "failed"),
    (Bucket::Review, "ready to review"),
    (Bucket::Working, "working"),
    (Bucket::Idle, "idle"),
];

#[component]
pub fn StatusSummary(#[prop(into)] counts: Signal<HashMap<Bucket, usize>>) -> impl IntoView {
    // Per bucket: how many times its count has risen (re-keys the flash so it replays).
    let rises = RwSignal::new(HashMap::<Bucket, u32>::new());
    let prev = StoredValue::new(HashMap::<Bucket, usize>::new());
    Effect::new(move |_| {
        let now = counts.get();
        let before = prev.get_value();
        if !before.is_empty() {
            for (b, _) in LEGEND {
                if now.get(&b).copied().unwrap_or(0) > before.get(&b).copied().unwrap_or(0) {
                    rises.update(|r| *r.entry(b).or_default() += 1);
                }
            }
        }
        prev.set_value(now);
    });
    let n = move |b: Bucket| counts.with(|c| c.get(&b).copied().unwrap_or(0));
    let total = move || LEGEND.iter().map(|(b, _)| n(*b)).sum::<usize>().max(1);
    view! {
        <div class="summary">
            <div class="summary-track">
                <div class="summary-clip">
                    {LEGEND
                        .iter()
                        .map(|(b, _)| {
                            let b = *b;
                            view! {
                                <div
                                    class=format!("seg-bar seg-{}", b.id())
                                    class:empty=move || n(b) == 0
                                    style=move || format!("flex-grow:{}", n(b) as f64 / total() as f64)
                                >
                                    {move || {
                                        let r = rises.with(|r| r.get(&b).copied().unwrap_or(0));
                                        (r > 0).then(|| view! { <span class=format!("seg-flash flash-{} k{}", b.id(), r % 2)></span> })
                                    }}
                                </div>
                            }
                        })
                        .collect_view()}
                </div>
            </div>
            <div class="summary-legend">
                {LEGEND
                    .iter()
                    .map(|(b, label)| {
                        let b = *b;
                        view! {
                            <Show when=move || { n(b) > 0 }>
                                <span class="legend-item m-fade-in">
                                    {move || {
                                        let r = rises.with(|r| r.get(&b).copied().unwrap_or(0));
                                        view! {
                                            <span class=format!("legend-glyph pop{}", r % 2) class:popped={r > 0}>
                                                <StatusGlyph bucket=b size=7.0 />
                                            </span>
                                        }
                                    }}
                                    <span class="t-mono legend-n">{move || n(b)}</span>
                                    <span class="legend-label">{*label}</span>
                                </span>
                            </Show>
                        }
                    })
                    .collect_view()}
            </div>
        </div>
    }
}
