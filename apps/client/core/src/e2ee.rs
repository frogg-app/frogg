//! Client side of the relay's encrypted channel (`packages/relay/src/encrypted-channel.ts`
//! `createClientChannel` + `daemon-client-relay-e2ee-transport.ts`).
//!
//! Handshake: once the socket opens, send plaintext
//! `{"type":"e2ee_hello","key":<our public key>,"capabilities":{"binaryCiphertext":true}}`
//! every second until the daemon answers `{"type":"e2ee_ready",...}`. After that every frame
//! is a `[nonce ‖ ciphertext]` bundle under `box.before(daemonPublic, ourSecret)`: text
//! payloads as base64 text frames, binary payloads as binary frames when the daemon
//! negotiated `binaryCiphertext` (base64 text otherwise).

use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::{Rc, Weak};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::Value;

use crate::crypto::{self, KeyPair, SharedKey};
use crate::timer::{Scheduler, TimerId};
use crate::{Transport, TransportSink};

const HANDSHAKE_RETRY_MS: u64 = 1_000;
const MAX_PENDING_SENDS: usize = 200;
const HANDSHAKE_FAILED_CLOSE_CODE: u16 = 4001;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelState {
    /// Socket not open yet.
    Connecting,
    Handshaking,
    Open,
    Closed,
}

enum Outgoing {
    Text(String),
    Binary(Vec<u8>),
}

struct Inner {
    base: Option<Rc<dyn Transport>>,
    state: ChannelState,
    shared: Option<SharedKey>,
    hello: Option<String>,
    binary_ciphertext: bool,
    pending: VecDeque<Outgoing>,
    retry: Option<TimerId>,
    closed_upstream: bool,
}

/// An encrypted [`Transport`] over a base socket. The base socket reports to this channel
/// (it is the base's [`TransportSink`]); decrypted traffic goes to `upstream`.
pub struct ClientChannel {
    inner: RefCell<Inner>,
    upstream: Rc<dyn TransportSink>,
    scheduler: Rc<dyn Scheduler>,
    daemon_public: [u8; 32],
    keys: Option<KeyPair>,
    weak: Weak<ClientChannel>,
}

fn is_handshake(v: &Value, kind: &str) -> bool {
    v.get("type").and_then(Value::as_str) == Some(kind)
}

impl ClientChannel {
    /// Fails when the daemon key is malformed.
    pub fn new(
        daemon_public_key_b64: &str,
        upstream: Rc<dyn TransportSink>,
        scheduler: Rc<dyn Scheduler>,
    ) -> Result<Rc<Self>, crypto::CryptoError> {
        Self::with_keys(daemon_public_key_b64, upstream, scheduler, None)
    }

    /// As [`ClientChannel::new`] with a fixed client key pair (tests).
    pub fn with_keys(
        daemon_public_key_b64: &str,
        upstream: Rc<dyn TransportSink>,
        scheduler: Rc<dyn Scheduler>,
        keys: Option<KeyPair>,
    ) -> Result<Rc<Self>, crypto::CryptoError> {
        let daemon_public = crypto::import_public_key(daemon_public_key_b64)?;
        Ok(Rc::new_cyclic(|weak| Self {
            inner: RefCell::new(Inner {
                base: None,
                state: ChannelState::Connecting,
                shared: None,
                hello: None,
                binary_ciphertext: false,
                pending: VecDeque::new(),
                retry: None,
                closed_upstream: false,
            }),
            upstream,
            scheduler,
            daemon_public,
            keys,
            weak: weak.clone(),
        }))
    }

    /// The socket this channel encrypts over.
    pub fn set_base(&self, base: Rc<dyn Transport>) {
        self.inner.borrow_mut().base = Some(base);
    }

    pub fn state(&self) -> ChannelState {
        self.inner.borrow().state
    }

    fn base(&self) -> Option<Rc<dyn Transport>> {
        self.inner.borrow().base.clone()
    }

    fn fail(&self, code: u16, reason: &str) {
        self.clear_retry();
        self.inner.borrow_mut().state = ChannelState::Closed;
        if let Some(b) = self.base() {
            b.close_with(code, reason);
        }
    }

    fn clear_retry(&self) {
        if let Some(t) = self.inner.borrow_mut().retry.take() {
            self.scheduler.clear_timeout(t);
        }
    }

    fn start_handshake(&self) {
        let keys = match self.keys.clone().map(Ok).unwrap_or_else(KeyPair::generate) {
            Ok(k) => k,
            Err(e) => return self.handshake_failed(&e.to_string()),
        };
        let shared = match crypto::derive_shared_key(&keys.secret_key, &self.daemon_public) {
            Ok(s) => s,
            Err(e) => return self.handshake_failed(&e.to_string()),
        };
        let hello = serde_json::json!({
            "type": "e2ee_hello",
            "key": crypto::export_key(&keys.public_key),
            "capabilities": { "binaryCiphertext": true },
        })
        .to_string();
        {
            let mut inner = self.inner.borrow_mut();
            inner.shared = Some(shared);
            inner.hello = Some(hello);
            inner.state = ChannelState::Handshaking;
        }
        self.send_hello();
    }

    fn handshake_failed(&self, message: &str) {
        self.upstream.error(message);
        self.fail(HANDSHAKE_FAILED_CLOSE_CODE, "E2EE handshake failed");
    }

    fn send_hello(&self) {
        let (base, hello) = {
            let inner = self.inner.borrow();
            if inner.state != ChannelState::Handshaking {
                return;
            }
            (inner.base.clone(), inner.hello.clone())
        };
        if let (Some(base), Some(hello)) = (base, hello) {
            // Sends can fail while the socket flaps; the retry timer tries again.
            if let Err(e) = base.send(hello) {
                self.upstream.error(&e);
            }
        }
        let weak = self.weak.clone();
        let timer = self.scheduler.set_timeout(
            HANDSHAKE_RETRY_MS,
            Box::new(move || {
                if let Some(c) = weak.upgrade() {
                    c.inner.borrow_mut().retry = None;
                    c.send_hello();
                }
            }),
        );
        self.inner.borrow_mut().retry = Some(timer);
    }

    fn on_ready(&self, ready: &Value) {
        self.clear_retry();
        {
            let mut inner = self.inner.borrow_mut();
            inner.binary_ciphertext =
                ready.pointer("/capabilities/binaryCiphertext") == Some(&Value::Bool(true));
            inner.state = ChannelState::Open;
        }
        self.upstream.open();
        let pending: Vec<Outgoing> = self.inner.borrow_mut().pending.drain(..).collect();
        for item in pending {
            let r = match item {
                Outgoing::Text(t) => self.send_encrypted(t.as_bytes(), false),
                Outgoing::Binary(b) => self.send_encrypted(&b, true),
            };
            if let Err(e) = r {
                self.upstream.error(&e);
                self.fail(1011, &e);
                return;
            }
        }
    }

    fn send_encrypted(&self, plaintext: &[u8], binary: bool) -> Result<(), String> {
        let (base, shared, binary_ct) = {
            let inner = self.inner.borrow();
            if inner.state != ChannelState::Open {
                return Err("Channel not open".into());
            }
            (
                inner.base.clone().ok_or("Channel not open")?,
                inner.shared.clone().ok_or("Channel not open")?,
                inner.binary_ciphertext,
            )
        };
        let bundle = crypto::encrypt(&shared, plaintext).map_err(|e| e.to_string())?;
        if binary && binary_ct {
            base.send_binary(bundle)
        } else {
            // COMPAT(binaryCiphertext): base64 text for text payloads and legacy peers.
            base.send(STANDARD.encode(bundle))
        }
    }

    fn queue_or_send(&self, item: Outgoing) -> Result<(), String> {
        let state = self.inner.borrow().state;
        match state {
            ChannelState::Handshaking => {
                let mut inner = self.inner.borrow_mut();
                if inner.pending.len() >= MAX_PENDING_SENDS {
                    inner.pending.pop_front();
                }
                inner.pending.push_back(item);
                Ok(())
            }
            ChannelState::Open => match item {
                Outgoing::Text(t) => self.send_encrypted(t.as_bytes(), false),
                Outgoing::Binary(b) => self.send_encrypted(&b, true),
            },
            _ => Err("Encrypted channel not ready".into()),
        }
    }

    fn handle_message(&self, data: &[u8], is_binary: bool) {
        let state = self.inner.borrow().state;
        if state == ChannelState::Handshaking {
            if is_binary {
                return;
            }
            if let Ok(v) = serde_json::from_slice::<Value>(data) {
                if is_handshake(&v, "e2ee_ready") {
                    self.on_ready(&v);
                }
            }
            return;
        }
        if state != ChannelState::Open {
            return;
        }

        if !is_binary {
            if let Ok(text) = std::str::from_utf8(data) {
                if text.trim_start().starts_with('{') {
                    if let Ok(v) = serde_json::from_str::<Value>(text) {
                        if is_handshake(&v, "e2ee_hello") || is_handshake(&v, "e2ee_ready") {
                            return;
                        }
                        return self.fail(1011, "Received plaintext frame on encrypted channel");
                    }
                }
            }
        }

        let (shared, binary_ct) = {
            let inner = self.inner.borrow();
            (inner.shared.clone(), inner.binary_ciphertext)
        };
        let Some(shared) = shared else { return };
        let b64 = |d: &[u8]| -> Option<Vec<u8>> {
            STANDARD.decode(std::str::from_utf8(d).ok()?.trim()).ok()
        };
        // (ciphertext, plaintext kind: Some(true) binary, Some(false) text, None legacy guess)
        let (ciphertext, kind) = if binary_ct {
            if is_binary {
                (Some(data.to_vec()), Some(true))
            } else {
                (b64(data), Some(false))
            }
        } else if !is_binary {
            (b64(data), None)
        } else {
            (Some(b64(data).unwrap_or_else(|| data.to_vec())), None)
        };
        let Some(ciphertext) = ciphertext else {
            return self.fail(1011, "Invalid ciphertext encoding");
        };
        let plaintext = match crypto::decrypt(&shared, &ciphertext) {
            Ok(p) => p,
            Err(e) => return self.fail(1011, &e.to_string()),
        };
        match kind {
            Some(true) => self.upstream.binary(&plaintext),
            Some(false) => match String::from_utf8(plaintext) {
                Ok(t) => self.upstream.text(&t),
                Err(_) => self.fail(1011, "Decrypted text frame is not UTF-8"),
            },
            None => match String::from_utf8(plaintext) {
                Ok(t) => self.upstream.text(&t),
                Err(e) => self.upstream.binary(e.as_bytes()),
            },
        }
    }
}

impl TransportSink for ClientChannel {
    fn open(&self) {
        if self.inner.borrow().state == ChannelState::Connecting {
            self.start_handshake();
        }
    }

    fn text(&self, text: &str) {
        self.handle_message(text.as_bytes(), false);
    }

    fn binary(&self, bytes: &[u8]) {
        self.handle_message(bytes, true);
    }

    fn close(&self, code: Option<u16>, reason: &str) {
        self.clear_retry();
        let first = {
            let mut inner = self.inner.borrow_mut();
            inner.state = ChannelState::Closed;
            !std::mem::replace(&mut inner.closed_upstream, true)
        };
        if first {
            self.upstream.close(code, reason);
        }
    }

    fn error(&self, message: &str) {
        if !self.inner.borrow().closed_upstream {
            self.upstream.error(message);
        }
    }
}

impl Transport for ClientChannel {
    fn send(&self, text: String) -> Result<(), String> {
        self.queue_or_send(Outgoing::Text(text))
    }

    fn send_binary(&self, bytes: Vec<u8>) -> Result<(), String> {
        self.queue_or_send(Outgoing::Binary(bytes))
    }

    fn close(&self) {
        self.close_with(1000, "Normal closure");
    }

    fn close_with(&self, code: u16, reason: &str) {
        self.clear_retry();
        self.inner.borrow_mut().state = ChannelState::Closed;
        if let Some(b) = self.base() {
            b.close_with(code, reason);
        }
    }

    fn buffered_amount(&self) -> u64 {
        self.base().map_or(0, |b| b.buffered_amount())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::timer::ManualScheduler;

    #[derive(Default)]
    struct Recorder {
        events: RefCell<Vec<String>>,
    }
    impl TransportSink for Recorder {
        fn open(&self) {
            self.events.borrow_mut().push("open".into());
        }
        fn text(&self, t: &str) {
            self.events.borrow_mut().push(format!("text:{t}"));
        }
        fn binary(&self, b: &[u8]) {
            self.events.borrow_mut().push(format!("bin:{b:?}"));
        }
        fn close(&self, code: Option<u16>, reason: &str) {
            self.events
                .borrow_mut()
                .push(format!("close:{code:?}:{reason}"));
        }
        fn error(&self, m: &str) {
            self.events.borrow_mut().push(format!("error:{m}"));
        }
    }

    #[derive(Default)]
    struct Wire {
        text: RefCell<Vec<String>>,
        bin: RefCell<Vec<Vec<u8>>>,
        closed: RefCell<Option<(u16, String)>>,
    }
    impl Transport for Wire {
        fn send(&self, t: String) -> Result<(), String> {
            self.text.borrow_mut().push(t);
            Ok(())
        }
        fn send_binary(&self, b: Vec<u8>) -> Result<(), String> {
            self.bin.borrow_mut().push(b);
            Ok(())
        }
        fn close(&self) {}
        fn close_with(&self, code: u16, reason: &str) {
            *self.closed.borrow_mut() = Some((code, reason.into()));
        }
    }

    fn setup(
        binary: bool,
    ) -> (
        Rc<ClientChannel>,
        Rc<Recorder>,
        Rc<Wire>,
        ManualScheduler,
        SharedKey,
    ) {
        let daemon = KeyPair::generate().unwrap();
        let up = Rc::new(Recorder::default());
        let s = ManualScheduler::new();
        let ch = ClientChannel::new(
            &crypto::export_key(&daemon.public_key),
            up.clone(),
            Rc::new(s.clone()),
        )
        .unwrap();
        let wire = Rc::new(Wire::default());
        ch.set_base(wire.clone());
        TransportSink::open(&*ch);
        // Daemon side: read the hello, derive the key, answer ready.
        let hello: Value = serde_json::from_str(&wire.text.borrow()[0]).unwrap();
        assert_eq!(hello["type"], "e2ee_hello");
        assert_eq!(hello["capabilities"]["binaryCiphertext"], true);
        let client_pub = crypto::import_public_key(hello["key"].as_str().unwrap()).unwrap();
        let shared = crypto::derive_shared_key(&daemon.secret_key, &client_pub).unwrap();
        let ready = if binary {
            r#"{"type":"e2ee_ready","capabilities":{"binaryCiphertext":true}}"#
        } else {
            r#"{"type":"e2ee_ready"}"#
        };
        // Queued before ready, flushed after.
        Transport::send(&*ch, "early".into()).unwrap();
        TransportSink::text(&*ch, ready);
        (ch, up, wire, s, shared)
    }

    #[test]
    fn handshake_retries_until_ready() {
        let daemon = KeyPair::generate().unwrap();
        let up = Rc::new(Recorder::default());
        let s = ManualScheduler::new();
        let ch = ClientChannel::new(
            &crypto::export_key(&daemon.public_key),
            up.clone(),
            Rc::new(s.clone()),
        )
        .unwrap();
        let wire = Rc::new(Wire::default());
        ch.set_base(wire.clone());
        assert!(
            Transport::send(&*ch, "x".into()).is_err(),
            "not ready before open"
        );
        TransportSink::open(&*ch);
        s.advance(2_500);
        assert_eq!(wire.text.borrow().len(), 3, "hello plus two retries");
        TransportSink::text(&*ch, r#"{"type":"e2ee_ready"}"#);
        s.advance(5_000);
        assert_eq!(wire.text.borrow().len(), 3, "no retries once open");
        assert_eq!(*up.events.borrow(), vec!["open".to_string()]);
    }

    #[test]
    fn round_trips_text_and_binary() {
        let (ch, up, wire, _s, shared) = setup(true);
        // The queued "early" message went out encrypted as base64 text after ready.
        let early = STANDARD.decode(&wire.text.borrow()[1]).unwrap();
        assert_eq!(crypto::decrypt(&shared, &early).unwrap(), b"early");

        Transport::send_binary(&*ch, vec![1, 2, 3]).unwrap();
        let bin = wire.bin.borrow()[0].clone();
        assert_eq!(crypto::decrypt(&shared, &bin).unwrap(), vec![1, 2, 3]);

        // Daemon → client.
        let text_bundle = crypto::encrypt(&shared, br#"{"type":"pong"}"#).unwrap();
        TransportSink::text(&*ch, &STANDARD.encode(text_bundle));
        let bin_bundle = crypto::encrypt(&shared, &[9, 9]).unwrap();
        TransportSink::binary(&*ch, &bin_bundle);
        // Stray handshake traffic is ignored.
        TransportSink::text(&*ch, r#"{"type":"e2ee_ready"}"#);
        assert_eq!(
            *up.events.borrow(),
            vec![
                "open".to_string(),
                r#"text:{"type":"pong"}"#.into(),
                "bin:[9, 9]".into()
            ]
        );
    }

    #[test]
    fn legacy_peer_gets_base64_binary() {
        let (ch, _up, wire, _s, shared) = setup(false);
        Transport::send_binary(&*ch, vec![7]).unwrap();
        assert!(wire.bin.borrow().is_empty());
        let last = wire.text.borrow().last().cloned().unwrap();
        assert_eq!(
            crypto::decrypt(&shared, &STANDARD.decode(last).unwrap()).unwrap(),
            vec![7]
        );
    }

    #[test]
    fn plaintext_or_bad_ciphertext_closes() {
        let (ch, _up, wire, _s, _shared) = setup(true);
        TransportSink::text(&*ch, r#"{"type":"session"}"#);
        assert_eq!(wire.closed.borrow().as_ref().unwrap().0, 1011);
        let (ch, _up, wire, _s, _shared) = setup(true);
        TransportSink::binary(&*ch, &[0u8; 40]);
        assert_eq!(
            wire.closed.borrow().as_ref().unwrap().1,
            "Decryption failed"
        );
    }

    #[test]
    fn base_close_reaches_upstream_once() {
        let (ch, up, _wire, _s, _shared) = setup(true);
        TransportSink::close(&*ch, Some(1006), "gone");
        TransportSink::close(&*ch, Some(1006), "gone");
        let closes = up
            .events
            .borrow()
            .iter()
            .filter(|e| e.starts_with("close"))
            .count();
        assert_eq!(closes, 1);
    }
}
