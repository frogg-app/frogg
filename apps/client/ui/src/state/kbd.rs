//! Keyboard hints (ui-next `kbd.ts`): written with Apple symbols, shown as the user's keyboard
//! spells them ("⌘K" stays on Apple devices, becomes "Ctrl+K" elsewhere).

use std::sync::OnceLock;

pub fn is_apple() -> bool {
    static APPLE: OnceLock<bool> = OnceLock::new();
    *APPLE.get_or_init(|| {
        let Some(nav) = web_sys::window().map(|w| w.navigator()) else {
            return false;
        };
        let name = nav
            .platform()
            .ok()
            .filter(|p| !p.is_empty())
            .or_else(|| nav.user_agent().ok())
            .unwrap_or_default()
            .to_lowercase();
        ["mac", "iphone", "ipad", "ipod"]
            .iter()
            .any(|k| name.contains(k))
    })
}

/// `hint` as this device's keyboard spells it.
pub fn kbd(hint: &str) -> String {
    format_for(hint, is_apple())
}

pub fn format_for(hint: &str, apple: bool) -> String {
    if apple {
        return hint.to_owned();
    }
    hint.replace('⌘', "Ctrl+")
        .replace('⌃', "Ctrl+")
        .replace('⌥', "Alt+")
        .replace('⇧', "Shift+")
}

#[cfg(test)]
mod tests {
    #[test]
    fn spells_for_pc() {
        assert_eq!(super::format_for("⌘K", false), "Ctrl+K");
        assert_eq!(super::format_for("⌃`", false), "Ctrl+`");
        assert_eq!(super::format_for("⌘K opens", true), "⌘K opens");
    }
}
