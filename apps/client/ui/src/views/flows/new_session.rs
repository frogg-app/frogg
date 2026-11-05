//! New session: built by the sessions stream in `views::new_session`; re-exported here so the
//! root's mount (`flows::new_session::NewSession`) needs no change.

pub use crate::views::new_session::NewSession;
