//! The WS envelope, and only the envelope.
//!
//! `WSInboundMessageSchema` in @frogg/protocol is a 4-arm discriminated union, one
//! arm of which (`session`) wraps all the session message types. We read only the
//! discriminator and keep the session payload as raw JSON, so unimplemented message
//! types are forwarded upstream byte-for-byte rather than round-tripped through a
//! Rust type we would have to keep in sync.

use std::borrow::Cow;

use serde::Deserialize;
use serde_json::value::RawValue;

/// The envelope's discriminator and the session payload left unparsed. This is what the hot
/// path reads for every client frame: other fields are skipped, not built into a `Value` tree,
/// so forwarding a large session message costs a scan rather than an allocation per node.
#[derive(Debug, Deserialize)]
pub struct Peek<'a> {
    #[serde(rename = "type", borrow)]
    pub kind: Cow<'a, str>,
    #[serde(borrow, default)]
    pub message: Option<&'a RawValue>,
}

pub fn peek(text: &str) -> Option<Peek<'_>> {
    serde_json::from_str(text).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_ping_envelope() {
        // WSPingMessageSchema carries no fields. The session-level `ping` is a
        // different message that does take requestId/clientSentAt; conflating
        // the two is how this daemon ended up emitting an off-schema pong.
        assert_eq!(peek(r#"{"type":"ping"}"#).unwrap().kind, "ping");
    }

    #[test]
    fn a_ping_with_extra_fields_is_still_a_ping() {
        // Unknown fields are skipped, so an older client sending extras is
        // tolerated - but we must not echo them back into the pong.
        assert_eq!(
            peek(r#"{"type":"ping","timestamp":42}"#).unwrap().kind,
            "ping"
        );
    }

    #[test]
    fn peeks_the_type_and_keeps_the_session_payload_raw() {
        let raw = r#"{"type":"session","message":{"type":"x","requestId":"r","big":[1,2,3]}}"#;
        let peeked = peek(raw).unwrap();
        assert_eq!(peeked.kind, "session");
        // Byte-for-byte, which is what makes opaque proxying safe.
        assert_eq!(
            peeked.message.unwrap().get(),
            r#"{"type":"x","requestId":"r","big":[1,2,3]}"#
        );
        let ping = peek(r#"{"type":"ping","timestamp":1}"#).unwrap();
        assert!(ping.message.is_none());
        assert!(peek("not json").is_none());
        assert!(peek(r#"{"message":{}}"#).is_none());
    }

    #[test]
    fn decodes_escaped_type_strings() {
        assert_eq!(peek(r#"{"type":"p\u0069ng"}"#).unwrap().kind, "ping");
    }
}
