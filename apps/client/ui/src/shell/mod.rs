//! The app shell (ui-next `app/index.tsx`, Rail, StatusBar, PhoneTabs, Palette, toasts):
//! layouts per form factor, navigation chrome and the overlays every screen shares.

pub mod home;
pub mod host_sheet;
pub mod keys;
pub mod layout;
pub mod palette;
pub mod panel_head;
pub mod phone_tabs;
pub mod rail;
pub mod status_bar;
pub mod title_bar;
pub mod toast;
pub mod tools;

pub use layout::Shell;
