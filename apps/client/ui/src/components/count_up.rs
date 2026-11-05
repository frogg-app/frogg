//! A number that counts to its new value (ui-next `CountUp.tsx`), tabular figures.

use leptos::prelude::*;

const MS: f64 = 420.0;

#[derive(Clone, Copy)]
struct Run {
    start: f64,
    from: f64,
    to: f64,
    mine: u64,
    shown: RwSignal<f64>,
    token: StoredValue<u64>,
}

fn frame(r: Run) {
    request_animation_frame(move || {
        if r.token.get_value() != r.mine {
            return;
        }
        let t = ((js_sys::Date::now() - r.start) / MS).min(1.0);
        let k = 1.0 - (1.0 - t).powi(3);
        r.shown.set(r.from + (r.to - r.from) * k);
        if t < 1.0 {
            frame(r);
        }
    });
}

#[component]
pub fn CountUp(
    #[prop(into)] value: Signal<f64>,
    #[prop(default = 0)] decimals: usize,
    #[prop(optional, into)] class: String,
) -> impl IntoView {
    let shown = RwSignal::new(value.get_untracked());
    let token = StoredValue::new(0u64);
    Effect::new(move |_| {
        let to = value.get();
        let from = shown.get_untracked();
        token.update_value(|t| *t += 1);
        if (to - from).abs() < f64::EPSILON || super::presence::reduced_motion() {
            shown.set(to);
            return;
        }
        frame(Run {
            start: js_sys::Date::now(),
            from,
            to,
            mine: token.get_value(),
            shown,
            token,
        });
    });
    view! {
        <span class=format!("count-up {class}")>
            {move || format!("{:.*}", decimals, shown.get())}
        </span>
    }
}
