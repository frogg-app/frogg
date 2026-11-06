#![recursion_limit = "512"]
//! Frogg client UI (docs/plans/rust-client.md). Mount only; the root lives in `app.rs`.

mod app;
// Primitives, stores and theme are the API wave 2 builds on; not all of it has a caller yet.
#[allow(dead_code, unused_imports)]
mod components;
mod native;
mod shell;
#[allow(dead_code, unused_imports)]
mod state;
#[allow(dead_code, unused_imports)]
mod theme;
mod views;

fn main() {
    shell::crash::install();
    leptos::mount::mount_to_body(app::App);
}
