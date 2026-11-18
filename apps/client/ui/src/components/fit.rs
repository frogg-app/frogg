//! Keeps a popover inside the window (ui-next `Floating.web.tsx`: clamp to the viewport with an
//! 8px edge, flip to the side with more room, cap the height to that room). Positions go through
//! CSSOM (`style.setProperty`), which the shell's content security policy never blocks.

use wasm_bindgen::JsCast;

/// Gap kept between a popover and the window edge.
pub const EDGE: f64 = 8.0;

/// The usable window box: below the desktop title strip, inside the window.
pub fn viewport() -> (f64, f64, f64) {
    let Some(w) = web_sys::window() else {
        return (0.0, 1200.0, 800.0);
    };
    let num = |v: Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue>, d: f64| {
        v.ok().and_then(|v| v.as_f64()).unwrap_or(d)
    };
    let top = w
        .document()
        .and_then(|d| d.body())
        .filter(|b| b.class_list().contains("has-title-bar"))
        .map(|_| crate::native::TITLE_BAR_HEIGHT)
        .unwrap_or(0.0);
    (
        top,
        num(w.inner_width(), 1200.0),
        num(w.inner_height(), 800.0),
    )
}

/// Room above and below a `(top, bottom)` anchor span, after the edge gaps.
pub fn room_around(anchor_top: f64, anchor_bottom: f64, gap: f64) -> (f64, f64) {
    let (top, _, vh) = viewport();
    (
        anchor_top - gap - EDGE - top,
        vh - anchor_bottom - gap - EDGE,
    )
}

/// Whether a popover that needs `need` px should open upward, given its preferred side.
pub fn flip_up(prefer_up: bool, need: f64, above: f64, below: f64) -> bool {
    if prefer_up {
        !(above < need && below > above)
    } else {
        below < need && above > below
    }
}

/// Shifts `el` (already laid out) so its box sits inside the window, and caps its height so it
/// never runs past an edge. Clears an earlier shift first so repeated calls don't accumulate.
pub fn keep_in_view(el: &web_sys::Element) {
    let Some(el) = el.dyn_ref::<web_sys::HtmlElement>() else {
        return;
    };
    let style = el.style();
    let _ = style.remove_property("translate");
    let r = el.get_bounding_client_rect();
    let (top, vw, vh) = viewport();
    let room_h = (vh - top - EDGE * 2.0).max(80.0);
    if r.height() > room_h {
        let _ = style.set_property("max-height", &format!("{room_h}px"));
    }
    let h = r.height().min(room_h);
    let dx = if r.right() > vw - EDGE {
        (vw - EDGE - r.right()).max(EDGE - r.left())
    } else if r.left() < EDGE {
        EDGE - r.left()
    } else {
        0.0
    };
    let dy = if r.top() + h > vh - EDGE {
        (vh - EDGE - h) - r.top()
    } else if r.top() < top + EDGE {
        top + EDGE - r.top()
    } else {
        0.0
    };
    if dx != 0.0 || dy != 0.0 {
        let _ = style.set_property("translate", &format!("{dx}px {dy}px"));
    }
}

#[cfg(test)]
mod tests {
    use super::flip_up;

    #[test]
    fn flips_to_the_roomier_side_only_when_needed() {
        // Prefers down, fits below: stays down.
        assert!(!flip_up(false, 200.0, 50.0, 400.0));
        // Prefers down, no room below, more above: flips up.
        assert!(flip_up(false, 200.0, 500.0, 120.0));
        // Prefers down, no room either way but below is roomier: stays down.
        assert!(!flip_up(false, 900.0, 100.0, 300.0));
        // Prefers up, no room above, more below: flips down.
        assert!(!flip_up(true, 200.0, 60.0, 500.0));
        assert!(flip_up(true, 200.0, 300.0, 100.0));
    }
}
