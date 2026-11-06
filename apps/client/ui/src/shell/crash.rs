//! The "This view crashed" page (ui-next `shell/ErrorBoundary.tsx`). A Rust panic in WASM
//! leaves the module unusable, so instead of a React-style boundary this hooks the panic: after
//! logging it, it replaces the body with a plain-DOM crash page (no Leptos, whose runtime may be
//! mid-borrow). "Try again" reloads the app; "Copy details" copies the message and location.

use wasm_bindgen::{closure::Closure, JsCast};

/// Installs the panic hook. Call once, before mounting.
pub fn install() {
    std::panic::set_hook(Box::new(|info| {
        console_error_panic_hook::hook(info);
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_owned())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panic".into());
        let at = info
            .location()
            .map(|l| format!("at {}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_default();
        show(&message, &at);
    }));
}

fn el(doc: &web_sys::Document, tag: &str, class: &str, text: &str) -> Option<web_sys::Node> {
    let e = doc.create_element(tag).ok()?;
    e.set_class_name(class);
    if !text.is_empty() {
        e.set_text_content(Some(text));
    }
    Some(e.into())
}

fn on_click(e: &web_sys::Node, f: impl FnMut() + 'static) {
    let cb = Closure::<dyn FnMut()>::new(f);
    let _ = e.add_event_listener_with_callback("click", cb.as_ref().unchecked_ref());
    cb.forget();
}

fn show(message: &str, at: &str) {
    let Some(doc) = web_sys::window().and_then(|w| w.document()) else {
        return;
    };
    let Some(body) = doc.body() else { return };
    // A second panic while showing the page must not stack pages.
    if doc.query_selector(".crash").ok().flatten().is_some() {
        return;
    }
    let build = || -> Option<web_sys::Node> {
        let root = el(&doc, "div", "crash", "")?;
        let head = el(&doc, "div", "crash-head", "")?;
        head.append_child(&el(
            &doc,
            "span",
            "t-label crash-eyebrow",
            "Something broke",
        )?)
        .ok()?;
        head.append_child(&el(&doc, "h1", "crash-title", "This view crashed")?)
            .ok()?;
        root.append_child(&head).ok()?;
        let main = el(&doc, "div", "crash-body", "")?;
        main.append_child(&el(&doc, "div", "crash-mark", "")?)
            .ok()?;
        main.append_child(&el(
            &doc,
            "p",
            "crash-msg",
            &format!("{message}. Your sessions keep running on their hosts."),
        )?)
        .ok()?;
        if !at.is_empty() {
            main.append_child(&el(&doc, "pre", "t-mono crash-trace", at)?)
                .ok()?;
        }
        let acts = el(&doc, "div", "crash-acts", "")?;
        let retry = el(&doc, "button", "btn cut btn-solid", "Try again")?;
        on_click(&retry, || {
            if let Some(w) = web_sys::window() {
                let _ = w.location().reload();
            }
        });
        let copy = el(&doc, "button", "btn cut btn-ghost", "Copy details")?;
        let details = format!("{message}\n{at}");
        let copy2 = copy.clone();
        on_click(&copy, move || {
            if let Some(w) = web_sys::window() {
                let _ = w.navigator().clipboard().write_text(&details);
                copy2.set_text_content(Some("Copied"));
            }
        });
        acts.append_child(&retry).ok()?;
        acts.append_child(&copy).ok()?;
        main.append_child(&acts).ok()?;
        root.append_child(&main).ok()?;
        Some(root)
    };
    let Some(page) = build() else { return };
    body.set_inner_html("");
    let _ = body.append_child(&page);
}
