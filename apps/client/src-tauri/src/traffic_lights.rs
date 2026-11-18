//! Centres the macOS traffic lights on the app-drawn title strip.
//!
//! `traffic_light_position` can't do this reliably: tao sizes the title-bar container to
//! (button height + y) and keeps each button's own offset inside it, and both the button size and
//! that offset change with the SDK the app links (macOS 26's larger lights sit ~4pt higher for the
//! same y). So the shell measures the real buttons and lays them out itself: the container spans
//! the strip and each button is centred in it. AppKit puts the buttons back on some events
//! (resize, focus, appearance, leaving full screen), so `lib.rs` calls this again on those.

use objc2_app_kit::{NSView, NSWindow, NSWindowButton};
use objc2_foundation::NSPoint;
use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{Runtime, WebviewWindow};

use crate::windows::TITLE_BAR_HEIGHT;

/// Left edge of the close button, in points (macOS default spacing between the three after it).
const LEFT: f64 = 12.0;

/// Each window's NSWindow, by label. Tauri's `ns_window()` waits on the main thread, so it is
/// read once off it (`register`); window events, which run on the main thread, use the cache.
static NS_WINDOWS: Mutex<Option<HashMap<String, usize>>> = Mutex::new(None);

/// Learns `window`'s NSWindow (off the main thread) and centres its lights.
pub fn register<R: Runtime>(window: &WebviewWindow<R>) {
    let window = window.clone();
    std::thread::spawn(move || {
        let Ok(ptr) = window.ns_window() else {
            return;
        };
        let ptr = ptr as usize;
        NS_WINDOWS
            .lock()
            .unwrap()
            .get_or_insert_with(HashMap::new)
            .insert(window.label().to_owned(), ptr);
        let _ = window.run_on_main_thread(move || centre_ptr(ptr));
    });
}

/// From a window event (main thread): centres the lights again, or forgets a closed window.
pub fn on_event<R: Runtime>(window: &tauri::Window<R>, event: &tauri::WindowEvent) {
    use tauri::WindowEvent as E;
    let label = window.label();
    if matches!(event, E::Destroyed) {
        if let Some(map) = NS_WINDOWS.lock().unwrap().as_mut() {
            map.remove(label);
        }
        return;
    }
    if !matches!(
        event,
        E::Resized(_) | E::Focused(_) | E::ThemeChanged(_) | E::ScaleFactorChanged { .. }
    ) {
        return;
    }
    let ptr = NS_WINDOWS
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|m| m.get(label).copied());
    if let Some(ptr) = ptr {
        centre_ptr(ptr);
    }
}

/// Main thread only: `ptr` is a live NSWindow from `register`.
fn centre_ptr(ptr: usize) {
    // SAFETY: registered from this window and dropped on `Destroyed`; called on the main thread.
    let ns_window = unsafe { &*(ptr as *const NSWindow) };
    place(ns_window);
}

fn place(window: &NSWindow) {
    let button = |kind| window.standardWindowButton(kind);
    let (Some(close), Some(mini), Some(zoom)) = (
        button(NSWindowButton::CloseButton),
        button(NSWindowButton::MiniaturizeButton),
        button(NSWindowButton::ZoomButton),
    ) else {
        return;
    };
    let Some(bar) = (unsafe { close.superview() }) else {
        return;
    };
    let Some(container) = (unsafe { bar.superview() }) else {
        return;
    };
    // The container spans the strip at the top of the window.
    let mut frame = container.frame();
    frame.size.height = TITLE_BAR_HEIGHT;
    frame.origin.y = window.frame().size.height - TITLE_BAR_HEIGHT;
    container.setFrame(frame);

    // Centre each button on the strip's midline, in the coordinates of the view that holds it.
    let bar_frame = bar.frame();
    let mid_in_container = TITLE_BAR_HEIGHT / 2.0;
    let mid_in_bar = if bar.isFlipped() {
        mid_in_container - (frame.size.height - bar_frame.origin.y - bar_frame.size.height)
    } else {
        mid_in_container - bar_frame.origin.y
    };
    let space = mini.frame().origin.x - close.frame().origin.x;
    for (i, b) in [&close, &mini, &zoom].into_iter().enumerate() {
        let h = b.frame().size.height;
        let y = if bar.isFlipped() {
            bar_frame.size.height - mid_in_bar - h / 2.0
        } else {
            mid_in_bar - h / 2.0
        };
        let view: &NSView = b;
        view.setFrameOrigin(NSPoint::new(LEFT + i as f64 * space, y.round()));
    }
}
