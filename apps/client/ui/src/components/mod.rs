//! Primitives (ports of apps/ui-next/src/components): styling lives in `styles/components.css`.

pub mod brackets;
pub mod button;
pub mod count_up;
pub mod field;
pub mod glide;
pub mod icon;
pub mod icon_data;
pub mod logo;
pub mod menu;
pub mod presence;
pub mod seg;
pub mod select;
pub mod shape;
pub mod sheet;
pub mod skeleton;
pub mod status_glyph;
pub mod text;

pub use brackets::Brackets;
pub use button::{Button, ButtonKind};
pub use count_up::CountUp;
pub use field::{Field, TextInput};
pub use icon::Icon;
pub use icon_data::Ico;
pub use logo::Logo;
pub use menu::{Menu, MenuItem};
pub use presence::{use_presence, Presence};
pub use seg::Seg;
pub use select::{Select, SelectOption};
pub use shape::Cut;
pub use sheet::{Floating, Sheet};
pub use skeleton::SkeletonRows;
pub use status_glyph::StatusGlyph;
pub use text::{Text, TextVariant};
