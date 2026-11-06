//! How tall the composer's input is, per session (ui-next `chat/composerSize.ts`): `Auto` grows
//! with the text up to a cap, `Expanded` is the big editor, `Px` is a height the user dragged to.

use serde_json::Value;

use crate::state::storage;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Size {
    Auto,
    Expanded,
    Px(f64),
}

const KEY: &str = "frogg.next.composer.size";
/// Sessions remembered; the oldest choices drop off past this.
const KEEP: usize = 100;

/// Lines the input grows through on its own before it scrolls.
pub const AUTO_LINES: f64 = 9.0;
pub const LINE: f64 = 20.0;
/// A drag that ends this close to the auto height snaps back to auto.
pub const SNAP: f64 = 12.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bounds {
    pub min: f64,
    /// Where auto growth stops.
    pub auto: f64,
    /// The expanded editor's height.
    pub expanded: f64,
    /// The tallest a drag can make it.
    pub max: f64,
}

pub fn bounds(min: f64, window_h: f64) -> Bounds {
    let max = (min + LINE * 4.0).max((window_h * 0.7).round());
    let expanded = max.min((LINE * 12.0).max((window_h * 0.5).round()));
    Bounds {
        min,
        auto: (min + LINE * (AUTO_LINES - 2.0)).min(expanded),
        expanded,
        max,
    }
}

/// The height a size asks for, given the text's own height.
pub fn target_height(size: Size, content: f64, b: Bounds) -> f64 {
    match size {
        Size::Expanded => b.expanded,
        Size::Px(h) => h.clamp(b.min, b.max),
        Size::Auto => content.ceil().clamp(b.min, b.auto),
    }
}

/// Where a drag ending at `end` settles: auto when near the auto height, else that height.
pub fn settle_drag(end: f64, content: f64, b: Bounds) -> Size {
    let end = end.clamp(b.min, b.max);
    if (end - target_height(Size::Auto, content, b)).abs() <= SNAP {
        Size::Auto
    } else {
        Size::Px(end.round())
    }
}

fn to_value(s: Size) -> Value {
    match s {
        Size::Auto => Value::from("auto"),
        Size::Expanded => Value::from("expanded"),
        Size::Px(h) => Value::from(h),
    }
}

fn from_value(v: &Value) -> Option<Size> {
    match v {
        Value::String(s) if s == "expanded" => Some(Size::Expanded),
        Value::Number(n) => n.as_f64().map(Size::Px),
        _ => None,
    }
}

/// Stored as `[[key, size], …]`, oldest first.
fn all() -> Vec<(String, Value)> {
    storage::get_json(KEY).unwrap_or_default()
}

pub fn load(key: &str) -> Size {
    all()
        .iter()
        .find(|(k, _)| k == key)
        .and_then(|(_, v)| from_value(v))
        .unwrap_or(Size::Auto)
}

pub fn save(key: &str, size: Size) {
    let mut list = all();
    list.retain(|(k, _)| k != key);
    if size != Size::Auto {
        list.push((key.to_owned(), to_value(size)));
    }
    let drop = list.len().saturating_sub(KEEP);
    list.drain(..drop);
    storage::set_json(KEY, &list);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes() {
        let b = bounds(48.0, 1000.0);
        assert_eq!(b.max, 700.0);
        assert_eq!(b.expanded, 500.0);
        assert_eq!(b.auto, 48.0 + 140.0);
        assert_eq!(target_height(Size::Auto, 20.0, b), 48.0);
        assert_eq!(target_height(Size::Auto, 120.4, b), 121.0);
        assert_eq!(target_height(Size::Auto, 900.0, b), b.auto);
        assert_eq!(target_height(Size::Expanded, 0.0, b), 500.0);
        assert_eq!(target_height(Size::Px(5000.0), 0.0, b), 700.0);
        // A small window still leaves room to drag.
        let small = bounds(48.0, 100.0);
        assert_eq!(small.max, 128.0);
        assert!(small.auto <= small.expanded);
    }

    #[test]
    fn drag_snaps_to_auto() {
        let b = bounds(48.0, 1000.0);
        assert_eq!(settle_drag(55.0, 20.0, b), Size::Auto);
        assert_eq!(settle_drag(300.4, 20.0, b), Size::Px(300.0));
        assert_eq!(settle_drag(9999.0, 20.0, b), Size::Px(700.0));
    }
}
