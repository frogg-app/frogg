//! Inbox: built by the sessions stream in `views::sessions::inbox`; re-exported here so the
//! shell's routing (`panels::inbox::*`) needs no change.

pub use crate::views::sessions::inbox::{InboxDetail, InboxPanel};
