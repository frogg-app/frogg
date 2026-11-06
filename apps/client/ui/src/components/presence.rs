//! Keeps an overlay mounted through its exit animation (ui-next `presence.ts`).

use std::time::Duration;

use leptos::prelude::*;

#[derive(Clone, Copy)]
pub struct Presence {
    /// Whether the overlay is in the DOM.
    pub mounted: RwSignal<bool>,
    /// Playing its exit; swap enter keyframes for exit ones and drop pointer events.
    pub closing: RwSignal<bool>,
}

pub fn reduced_motion() -> bool {
    window()
        .match_media("(prefers-reduced-motion: reduce)")
        .ok()
        .flatten()
        .map(|m| m.matches())
        .unwrap_or(false)
}

/// Mounted while `open`, and for `exit_ms` after it turns false.
pub fn use_presence(open: Signal<bool>, exit_ms: u32) -> Presence {
    let p = Presence {
        mounted: RwSignal::new(open.get_untracked()),
        closing: RwSignal::new(false),
    };
    let generation = StoredValue::new(0u64);
    Effect::new(move |_| {
        let is_open = open.get();
        generation.update_value(|g| *g += 1);
        if is_open {
            p.mounted.set(true);
            p.closing.set(false);
            return;
        }
        if !p.mounted.get_untracked() {
            return;
        }
        if reduced_motion() {
            p.mounted.set(false);
            return;
        }
        p.closing.set(true);
        let mine = generation.get_value();
        set_timeout(
            move || {
                // The owner may be gone (navigated away mid-exit).
                if generation.try_get_value() == Some(mine) {
                    p.mounted.set(false);
                    p.closing.set(false);
                }
            },
            Duration::from_millis(exit_ms as u64),
        );
    });
    p
}
