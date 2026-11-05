//! Reading daemon frames without trusting the generated types to cover every variant.
//!
//! A frame is peeked first (envelope type, session message type, `requestId`), keeping the
//! session message as raw JSON. Correlation uses only the peek, so a response whose variant the
//! generated `outbound` types reject still reaches the caller that asked for it.

use frogg_protocol::outbound;
use serde::Deserialize;
use serde_json::value::RawValue;

#[derive(Debug, Clone)]
pub enum IncomingFrame {
    Pong,
    Session(SessionFrame),
    Other(String),
}

#[derive(Debug, Clone)]
pub struct SessionFrame {
    /// The session message's `type`, e.g. `fetch_agents_response`.
    pub kind: String,
    /// `payload.requestId` (or a top-level `requestId`), when present.
    pub request_id: Option<String>,
    /// The session message as sent, for callers that need fields the types do not model.
    pub raw: Box<RawValue>,
}

impl SessionFrame {
    /// The message decoded into the generated types.
    pub fn typed(&self) -> serde_json::Result<outbound::SessionMessage> {
        serde_json::from_str(self.raw.get())
    }

    /// The message's `payload`, decoded into `T`.
    pub fn payload<T: serde::de::DeserializeOwned>(&self) -> serde_json::Result<T> {
        #[derive(Deserialize)]
        struct WithPayload<T> {
            payload: T,
        }
        serde_json::from_str::<WithPayload<T>>(self.raw.get()).map(|w| w.payload)
    }

    /// The message as a JSON value.
    pub fn json(&self) -> serde_json::Value {
        serde_json::from_str(self.raw.get()).unwrap_or(serde_json::Value::Null)
    }

    /// `payload.status` for `status` messages (`server_info`, `agent_created`, ...).
    pub fn payload_status(&self) -> Option<String> {
        #[derive(Deserialize)]
        struct P {
            payload: Option<S>,
        }
        #[derive(Deserialize)]
        struct S {
            status: Option<String>,
        }
        serde_json::from_str::<P>(self.raw.get())
            .ok()?
            .payload?
            .status
    }
}

#[derive(Deserialize)]
struct Envelope {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    message: Option<Box<RawValue>>,
}

#[derive(Deserialize)]
struct SessionPeek {
    #[serde(rename = "type")]
    kind: String,
    #[serde(rename = "requestId", default)]
    request_id: Option<String>,
    #[serde(default)]
    payload: Option<PayloadPeek>,
}

#[derive(Deserialize)]
struct PayloadPeek {
    #[serde(rename = "requestId", default)]
    request_id: Option<serde_json::Value>,
}

pub fn parse(text: &str) -> Option<IncomingFrame> {
    let envelope: Envelope = serde_json::from_str(text).ok()?;
    match envelope.kind.as_str() {
        "pong" => Some(IncomingFrame::Pong),
        "session" => {
            let mut raw = envelope.message?;
            let peek: SessionPeek = serde_json::from_str(raw.get()).ok()?;
            let request_id = peek.request_id.or_else(|| {
                peek.payload
                    .and_then(|p| p.request_id)
                    .and_then(|v| v.as_str().map(str::to_owned))
            });
            if peek.kind == "providers_snapshot_update"
                || peek.kind == "get_providers_snapshot_response"
            {
                let value: serde_json::Value = serde_json::from_str(raw.get()).ok()?;
                if let Some(next) = crate::normalize::provider_snapshot_message(&value) {
                    raw = RawValue::from_string(next.to_string()).ok()?;
                }
            }
            Some(IncomingFrame::Session(SessionFrame {
                kind: peek.kind,
                request_id,
                raw,
            }))
        }
        other => Some(IncomingFrame::Other(other.to_owned())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peeks_request_id_from_the_payload() {
        let f = parse(r#"{"type":"session","message":{"type":"x_response","payload":{"requestId":"r1","n":1}}}"#)
            .unwrap();
        let IncomingFrame::Session(s) = f else {
            panic!()
        };
        assert_eq!(s.kind, "x_response");
        assert_eq!(s.request_id.as_deref(), Some("r1"));
    }

    #[test]
    fn peeks_a_top_level_request_id() {
        let f = parse(r#"{"type":"session","message":{"type":"y","requestId":"r2"}}"#).unwrap();
        let IncomingFrame::Session(s) = f else {
            panic!()
        };
        assert_eq!(s.request_id.as_deref(), Some("r2"));
    }

    #[test]
    fn a_null_request_id_is_no_request_id() {
        let f = parse(r#"{"type":"session","message":{"type":"y","payload":{"requestId":null}}}"#)
            .unwrap();
        let IncomingFrame::Session(s) = f else {
            panic!()
        };
        assert_eq!(s.request_id, None);
    }

    #[test]
    fn pong_and_unknown_envelopes() {
        assert!(matches!(
            parse(r#"{"type":"pong"}"#),
            Some(IncomingFrame::Pong)
        ));
        assert!(matches!(
            parse(r#"{"type":"later"}"#),
            Some(IncomingFrame::Other(_))
        ));
        assert!(parse("nope").is_none());
    }
}
