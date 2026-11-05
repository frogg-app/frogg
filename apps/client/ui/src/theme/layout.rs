//! Layout breakpoints (ui-next `theme/layout.ts`, `tokens.ts` `bp`): phone < 700 ≤ tablet < 1100 ≤ desktop.

use leptos::prelude::*;

pub const TABLET: f64 = 700.0;
pub const DESKTOP: f64 = 1100.0;
/// At or above this width the side panel sits beside the main pane instead of over it.
pub const DOCKED: f64 = 900.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FormFactor {
    Phone,
    Tablet,
    Desktop,
}

impl FormFactor {
    pub fn of(width: f64) -> Self {
        if width < TABLET {
            Self::Phone
        } else if width < DESKTOP {
            Self::Tablet
        } else {
            Self::Desktop
        }
    }
}

/// Window size, kept current by one resize listener.
#[derive(Clone, Copy)]
pub struct Viewport {
    pub width: RwSignal<f64>,
    pub height: RwSignal<f64>,
    pub form_factor: Memo<FormFactor>,
    pub docked: Memo<bool>,
}

fn size() -> (f64, f64) {
    let w = window();
    let w0 = w.inner_width().ok().and_then(|v| v.as_f64()).unwrap_or(0.0);
    let h0 = w
        .inner_height()
        .ok()
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    (w0, h0)
}

impl Viewport {
    pub fn init() -> Self {
        let (w, h) = size();
        let width = RwSignal::new(w);
        let height = RwSignal::new(h);
        let handle = window_event_listener(leptos::ev::resize, move |_| {
            let (w, h) = size();
            width.set(w);
            height.set(h);
        });
        // Lives as long as the app.
        std::mem::forget(handle);
        Self {
            width,
            height,
            form_factor: Memo::new(move |_| FormFactor::of(width.get())),
            docked: Memo::new(move |_| width.get() >= DOCKED),
        }
    }

    pub fn phone(&self) -> bool {
        self.form_factor.get() == FormFactor::Phone
    }
}
