//! Port of `terminal-stream-router.ts`: maps terminal ids to the one-byte stream slots the
//! daemon assigns in `subscribe_terminal_response`, and turns binary frames into events.

use std::collections::HashMap;

use crate::binary::{self, opcode, TerminalFrame, TerminalResize};

#[derive(Debug, Clone, PartialEq)]
pub enum TerminalStreamEvent {
    Output {
        terminal_id: String,
        data: Vec<u8>,
    },
    /// A full screen state (`TerminalState` JSON).
    Snapshot {
        terminal_id: String,
        state: serde_json::Value,
    },
    Restore {
        terminal_id: String,
        data: Vec<u8>,
    },
}

impl TerminalStreamEvent {
    pub fn terminal_id(&self) -> &str {
        match self {
            Self::Output { terminal_id, .. }
            | Self::Snapshot { terminal_id, .. }
            | Self::Restore { terminal_id, .. } => terminal_id,
        }
    }
}

/// What the user typed or how the view resized.
#[derive(Debug, Clone, PartialEq)]
pub enum TerminalInput {
    Input(String),
    Resize(TerminalResize),
}

impl TerminalInput {
    /// The JSON `terminal_input` fallback message used before a slot is known.
    pub fn to_json(&self) -> serde_json::Value {
        match self {
            Self::Input(data) => serde_json::json!({ "type": "input", "data": data }),
            Self::Resize(r) => {
                let mut v = serde_json::json!({ "type": "resize", "rows": r.rows, "cols": r.cols });
                if let Some(i) = &r.intent {
                    v["intent"] = i.clone().into();
                }
                v
            }
        }
    }
}

#[derive(Default)]
pub struct TerminalStreamRouter {
    terminal_slots: HashMap<String, u8>,
    slot_terminals: HashMap<u8, String>,
}

impl TerminalStreamRouter {
    pub fn set_slot(&mut self, terminal_id: &str, slot: u8) {
        if let Some(existing) = self.slot_terminals.get(&slot) {
            if existing != terminal_id {
                let existing = existing.clone();
                self.terminal_slots.remove(&existing);
            }
        }
        if let Some(old) = self.terminal_slots.get(terminal_id).copied() {
            if old != slot {
                self.slot_terminals.remove(&old);
            }
        }
        self.terminal_slots.insert(terminal_id.to_owned(), slot);
        self.slot_terminals.insert(slot, terminal_id.to_owned());
    }

    pub fn slot(&self, terminal_id: &str) -> Option<u8> {
        self.terminal_slots.get(terminal_id).copied()
    }

    pub fn remove_terminal(&mut self, terminal_id: &str) {
        if let Some(slot) = self.terminal_slots.remove(terminal_id) {
            if self.slot_terminals.get(&slot).map(String::as_str) == Some(terminal_id) {
                self.slot_terminals.remove(&slot);
            }
        }
    }

    pub fn clear_slots(&mut self) {
        self.terminal_slots.clear();
        self.slot_terminals.clear();
    }

    pub fn encode_input(&self, terminal_id: &str, input: &TerminalInput) -> Option<Vec<u8>> {
        let slot = self.slot(terminal_id)?;
        Some(match input {
            TerminalInput::Input(data) => {
                binary::encode_terminal_frame(opcode::INPUT, slot, data.as_bytes())
            }
            TerminalInput::Resize(r) => binary::encode_terminal_frame(
                opcode::RESIZE,
                slot,
                &serde_json::to_vec(r).unwrap_or_default(),
            ),
        })
    }

    pub fn route(&self, frame: TerminalFrame) -> Option<TerminalStreamEvent> {
        let terminal_id = self.slot_terminals.get(&frame.slot)?.clone();
        match frame.opcode {
            opcode::OUTPUT => Some(TerminalStreamEvent::Output {
                terminal_id,
                data: frame.payload,
            }),
            opcode::RESTORE => Some(TerminalStreamEvent::Restore {
                terminal_id,
                data: frame.payload,
            }),
            opcode::SNAPSHOT => {
                let state: serde_json::Value = serde_json::from_slice(&frame.payload).ok()?;
                state
                    .is_object()
                    .then_some(TerminalStreamEvent::Snapshot { terminal_id, state })
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slots_move_between_terminals() {
        let mut r = TerminalStreamRouter::default();
        r.set_slot("a", 1);
        r.set_slot("b", 1); // slot 1 now belongs to b
        assert_eq!(r.slot("a"), None);
        r.set_slot("b", 2);
        assert!(r
            .route(TerminalFrame {
                opcode: opcode::OUTPUT,
                slot: 1,
                payload: vec![]
            })
            .is_none());
        let ev = r
            .route(TerminalFrame {
                opcode: opcode::OUTPUT,
                slot: 2,
                payload: b"x".to_vec(),
            })
            .unwrap();
        assert_eq!(ev.terminal_id(), "b");
        assert_eq!(
            r.encode_input("b", &TerminalInput::Input("ls".into())),
            Some(vec![2, 2, b'l', b's'])
        );
        r.remove_terminal("b");
        assert_eq!(
            r.encode_input("b", &TerminalInput::Input("ls".into())),
            None
        );
    }
}
