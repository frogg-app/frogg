//! Binary WebSocket frames: terminal streams and file transfers
//! (`packages/protocol/src/binary-frames`).

use serde::{Deserialize, Serialize};

pub mod opcode {
    pub const OUTPUT: u8 = 0x01;
    pub const INPUT: u8 = 0x02;
    pub const RESIZE: u8 = 0x03;
    pub const SNAPSHOT: u8 = 0x04;
    pub const RESTORE: u8 = 0x05;
    pub const FILE_BEGIN: u8 = 0x10;
    pub const FILE_CHUNK: u8 = 0x11;
    pub const FILE_END: u8 = 0x12;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalFrame {
    pub opcode: u8,
    pub slot: u8,
    pub payload: Vec<u8>,
}

pub fn encode_terminal_frame(opcode: u8, slot: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(2 + payload.len());
    out.push(opcode);
    out.push(slot);
    out.extend_from_slice(payload);
    out
}

pub fn decode_terminal_frame(bytes: &[u8]) -> Option<TerminalFrame> {
    if bytes.len() < 2 || !(opcode::OUTPUT..=opcode::RESTORE).contains(&bytes[0]) {
        return None;
    }
    Some(TerminalFrame {
        opcode: bytes[0],
        slot: bytes[1],
        payload: bytes[2..].to_vec(),
    })
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TerminalResize {
    pub rows: u32,
    pub cols: u32,
    /// `"claim"` or `"update"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intent: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileBeginMetadata {
    pub mime: String,
    pub size: u64,
    /// `"utf-8"` or `"binary"`.
    pub encoding: String,
    pub modified_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum FileFrame {
    Begin {
        request_id: String,
        metadata: FileBeginMetadata,
    },
    Chunk {
        request_id: String,
        payload: Vec<u8>,
    },
    End {
        request_id: String,
    },
}

impl FileFrame {
    pub fn request_id(&self) -> &str {
        match self {
            FileFrame::Begin { request_id, .. }
            | FileFrame::Chunk { request_id, .. }
            | FileFrame::End { request_id } => request_id,
        }
    }
}

pub fn encode_file_frame(frame: &FileFrame) -> Result<Vec<u8>, String> {
    let rid = frame.request_id().as_bytes();
    if rid.is_empty() || rid.len() > 0xff {
        return Err("File transfer requestId must be 1..=255 bytes".into());
    }
    let mut out = Vec::new();
    match frame {
        FileFrame::Begin { metadata, .. } => {
            let meta = serde_json::to_vec(metadata).map_err(|e| e.to_string())?;
            if meta.len() > 0xffff {
                return Err("FileBegin metadata is too long".into());
            }
            out.push(opcode::FILE_BEGIN);
            out.push(rid.len() as u8);
            out.extend_from_slice(rid);
            out.extend_from_slice(&(meta.len() as u16).to_be_bytes());
            out.extend_from_slice(&meta);
        }
        FileFrame::Chunk { payload, .. } => {
            out.push(opcode::FILE_CHUNK);
            out.push(rid.len() as u8);
            out.extend_from_slice(rid);
            out.extend_from_slice(payload);
        }
        FileFrame::End { .. } => {
            out.push(opcode::FILE_END);
            out.push(rid.len() as u8);
            out.extend_from_slice(rid);
        }
    }
    Ok(out)
}

pub fn decode_file_frame(bytes: &[u8]) -> Option<FileFrame> {
    if bytes.len() < 2 || !(opcode::FILE_BEGIN..=opcode::FILE_END).contains(&bytes[0]) {
        return None;
    }
    let len = bytes[1] as usize;
    if len == 0 || len > bytes.len() - 2 {
        return None;
    }
    let request_id = String::from_utf8_lossy(&bytes[2..2 + len]).into_owned();
    let body = &bytes[2 + len..];
    match bytes[0] {
        opcode::FILE_BEGIN => {
            if body.len() < 2 {
                return None;
            }
            let meta_len = u16::from_be_bytes([body[0], body[1]]) as usize;
            if meta_len != body.len() - 2 {
                return None;
            }
            let metadata = serde_json::from_slice(&body[2..]).ok()?;
            Some(FileFrame::Begin {
                request_id,
                metadata,
            })
        }
        opcode::FILE_CHUNK => Some(FileFrame::Chunk {
            request_id,
            payload: body.to_vec(),
        }),
        _ if body.is_empty() => Some(FileFrame::End { request_id }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_round_trip() {
        let bytes = encode_terminal_frame(opcode::OUTPUT, 7, b"hi");
        assert_eq!(bytes, vec![1, 7, b'h', b'i']);
        let f = decode_terminal_frame(&bytes).unwrap();
        assert_eq!((f.opcode, f.slot, f.payload.as_slice()), (1, 7, &b"hi"[..]));
        assert!(decode_terminal_frame(&[9, 1]).is_none());
        assert!(decode_terminal_frame(&[1]).is_none());
    }

    #[test]
    fn file_round_trip() {
        let begin = FileFrame::Begin {
            request_id: "r1".into(),
            metadata: FileBeginMetadata {
                mime: "text/plain".into(),
                size: 3,
                encoding: "utf-8".into(),
                modified_at: "2026-01-01T00:00:00Z".into(),
                revision: None,
                file_name: None,
            },
        };
        for f in [
            begin,
            FileFrame::Chunk {
                request_id: "r1".into(),
                payload: b"abc".to_vec(),
            },
            FileFrame::End {
                request_id: "r1".into(),
            },
        ] {
            assert_eq!(decode_file_frame(&encode_file_frame(&f).unwrap()), Some(f));
        }
        // Matches the TS layout: opcode, id length, id, u16be meta length, meta.
        let b = encode_file_frame(&FileFrame::End {
            request_id: "ab".into(),
        })
        .unwrap();
        assert_eq!(b, vec![0x12, 2, b'a', b'b']);
    }
}
