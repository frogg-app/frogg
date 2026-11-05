use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use frogg_protocol::{inbound, outbound};
use futures::channel::oneshot;
use serde::Serialize;

use crate::frame::{self, IncomingFrame, SessionFrame};
use crate::{Error, Result};

/// Capabilities the TS client advertises in `hello`; the daemon gates payload shapes on them.
const HELLO_CAPABILITIES: &[&str] = &[
    "customModeIcons",
    "reasoningMergeEnum",
    "terminalReflowableSnapshot",
    "providerSubagents",
    "projectUpdates",
    "compactProviderSnapshots",
];

pub trait Transport {
    fn send(&self, text: String) -> std::result::Result<(), String>;
    fn close(&self);
}

#[derive(Debug, Clone)]
pub struct ClientConfig {
    pub client_id: String,
    pub client_type: inbound::HelloClientType,
    pub app_version: Option<String>,
    pub device_name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Idle,
    Connecting,
    Connected,
    Disconnected,
}

#[derive(Debug, Clone)]
pub enum Event {
    State(ConnectionState),
    /// A session message nobody was waiting for: pushes, stream updates, `status`.
    Session(SessionFrame),
}

type Listener = Rc<dyn Fn(&Event)>;

struct Inner {
    config: ClientConfig,
    transport: Option<Rc<dyn Transport>>,
    state: ConnectionState,
    pending: HashMap<String, oneshot::Sender<SessionFrame>>,
    listeners: Vec<(u64, Listener)>,
    next_id: u64,
}

/// Cheap to clone; clones share one connection.
#[derive(Clone)]
pub struct DaemonClient {
    inner: Rc<RefCell<Inner>>,
}

impl DaemonClient {
    pub fn new(config: ClientConfig) -> Self {
        Self {
            inner: Rc::new(RefCell::new(Inner {
                config,
                transport: None,
                state: ConnectionState::Idle,
                pending: HashMap::new(),
                listeners: Vec::new(),
                next_id: 0,
            })),
        }
    }

    pub fn state(&self) -> ConnectionState {
        self.inner.borrow().state
    }

    /// Registers a listener; returns a handle for [`DaemonClient::unsubscribe`].
    pub fn subscribe(&self, listener: impl Fn(&Event) + 'static) -> u64 {
        let mut inner = self.inner.borrow_mut();
        inner.next_id += 1;
        let id = inner.next_id;
        inner.listeners.push((id, Rc::new(listener)));
        id
    }

    pub fn unsubscribe(&self, id: u64) {
        self.inner.borrow_mut().listeners.retain(|(i, _)| *i != id);
    }

    // ---- transport side -------------------------------------------------------------------

    pub fn attach(&self, transport: Rc<dyn Transport>) {
        self.inner.borrow_mut().transport = Some(transport);
        self.set_state(ConnectionState::Connecting);
    }

    pub fn handle_open(&self) {
        if self.send_hello().is_err() {
            self.disconnect();
            return;
        }
        self.set_state(ConnectionState::Connected);
    }

    pub fn handle_frame(&self, text: &str) {
        let Some(IncomingFrame::Session(session)) = frame::parse(text) else {
            return;
        };
        let waiter = session
            .request_id
            .as_ref()
            .and_then(|id| self.inner.borrow_mut().pending.remove(id));
        match waiter {
            Some(tx) => {
                let _ = tx.send(session);
            }
            None => self.emit(&Event::Session(session)),
        }
    }

    /// Drops the transport and fails every request in flight.
    pub fn handle_close(&self) {
        {
            let mut inner = self.inner.borrow_mut();
            inner.transport = None;
            inner.pending.clear(); // dropping the senders resolves receivers with Closed
        }
        self.set_state(ConnectionState::Disconnected);
    }

    pub fn disconnect(&self) {
        let transport = self.inner.borrow_mut().transport.take();
        if let Some(t) = transport {
            t.close();
        }
        self.handle_close();
    }

    // ---- requests -------------------------------------------------------------------------

    pub fn next_request_id(&self) -> String {
        let mut inner = self.inner.borrow_mut();
        inner.next_id += 1;
        format!("rs-{}-{}", inner.config.client_id, inner.next_id)
    }

    /// Sends a session message and waits for the frame carrying the same `requestId`.
    pub async fn request(
        &self,
        request_id: &str,
        message: &inbound::SessionMessage,
    ) -> Result<SessionFrame> {
        let rx = {
            let (tx, rx) = oneshot::channel();
            self.inner
                .borrow_mut()
                .pending
                .insert(request_id.to_owned(), tx);
            rx
        };
        if let Err(e) = self.send_envelope("session", Some(message)) {
            self.inner.borrow_mut().pending.remove(request_id);
            return Err(e);
        }
        rx.await.map_err(|_| Error::Closed)
    }

    pub async fn fetch_agents(
        &self,
        scope: Option<inbound::FetchAgentsRequestScope>,
    ) -> Result<outbound::FetchAgentsResponsePayload> {
        let request_id = self.next_request_id();
        let message = inbound::SessionMessage::FetchAgentsRequest(inbound::FetchAgentsRequest {
            request_id: request_id.clone(),
            scope,
            filter: None,
            sort: None,
            page: None,
            subscribe: None,
            sync: None,
        });
        let frame = self.request(&request_id, &message).await?;
        if frame.kind != "fetch_agents_response" {
            return Err(Error::Decode(format!(
                "expected fetch_agents_response, got {}",
                frame.kind
            )));
        }
        frame.payload().map_err(|e| Error::Decode(e.to_string()))
    }

    // ---- internals ------------------------------------------------------------------------

    fn send_hello(&self) -> Result<()> {
        let config = self.inner.borrow().config.clone();
        let capabilities: serde_json::Map<String, serde_json::Value> = HELLO_CAPABILITIES
            .iter()
            .map(|c| ((*c).to_owned(), serde_json::Value::Bool(true)))
            .collect();
        // Built as JSON rather than `inbound::Hello`: the capability map is open-ended on the
        // wire and the generated struct only models the keys the schema names.
        let hello = serde_json::json!({
            "type": "hello",
            "clientId": config.client_id,
            "clientType": config.client_type,
            "protocolVersion": 1,
            "capabilities": capabilities,
            "appVersion": config.app_version,
            "deviceName": config.device_name,
        });
        let mut hello = hello;
        if let Some(obj) = hello.as_object_mut() {
            obj.retain(|_, v| !v.is_null());
        }
        self.send_text(hello.to_string())
    }

    fn send_envelope<T: Serialize>(&self, kind: &str, message: Option<&T>) -> Result<()> {
        #[derive(Serialize)]
        struct Envelope<'a, T> {
            #[serde(rename = "type")]
            kind: &'a str,
            #[serde(skip_serializing_if = "Option::is_none")]
            message: Option<&'a T>,
        }
        let text = serde_json::to_string(&Envelope { kind, message })
            .map_err(|e| Error::Send(e.to_string()))?;
        self.send_text(text)
    }

    fn send_text(&self, text: String) -> Result<()> {
        let transport = self.inner.borrow().transport.clone();
        transport
            .ok_or(Error::NotConnected)?
            .send(text)
            .map_err(Error::Send)
    }

    fn set_state(&self, state: ConnectionState) {
        let changed = {
            let mut inner = self.inner.borrow_mut();
            let changed = inner.state != state;
            inner.state = state;
            changed
        };
        if changed {
            self.emit(&Event::State(state));
        }
    }

    fn emit(&self, event: &Event) {
        // Snapshot so a listener can (un)subscribe while being called.
        let listeners: Vec<Listener> = self
            .inner
            .borrow()
            .listeners
            .iter()
            .map(|(_, l)| l.clone())
            .collect();
        for l in listeners {
            l(event);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::executor::LocalPool;
    use futures::task::LocalSpawnExt;

    #[derive(Default)]
    struct FakeTransport {
        sent: RefCell<Vec<String>>,
    }
    impl Transport for FakeTransport {
        fn send(&self, text: String) -> std::result::Result<(), String> {
            self.sent.borrow_mut().push(text);
            Ok(())
        }
        fn close(&self) {}
    }

    fn client() -> (DaemonClient, Rc<FakeTransport>) {
        let c = DaemonClient::new(ClientConfig {
            client_id: "cid".into(),
            client_type: inbound::HelloClientType::Browser,
            app_version: Some("1.0.0".into()),
            device_name: None,
        });
        let t = Rc::new(FakeTransport::default());
        c.attach(t.clone());
        c.handle_open();
        (c, t)
    }

    #[test]
    fn open_sends_hello_and_reports_connected() {
        let (c, t) = client();
        assert_eq!(c.state(), ConnectionState::Connected);
        let hello: serde_json::Value = serde_json::from_str(&t.sent.borrow()[0]).unwrap();
        assert_eq!(hello["type"], "hello");
        assert_eq!(hello["clientType"], "browser");
        assert_eq!(hello["protocolVersion"], 1);
        assert_eq!(hello["capabilities"]["projectUpdates"], true);
        assert!(hello.get("deviceName").is_none());
        // The daemon accepts what the generated schema accepts.
        serde_json::from_value::<inbound::WsInboundMessage>(hello).unwrap();
    }

    #[test]
    fn fetch_agents_correlates_on_request_id() {
        let (c, t) = client();
        let mut pool = LocalPool::new();
        let result = Rc::new(RefCell::new(None));
        {
            let c = c.clone();
            let result = result.clone();
            pool.spawner()
                .spawn_local(async move {
                    *result.borrow_mut() = Some(c.fetch_agents(None).await);
                })
                .unwrap();
        }
        pool.run_until_stalled();
        let sent: serde_json::Value = serde_json::from_str(&t.sent.borrow()[1]).unwrap();
        assert_eq!(sent["type"], "session");
        assert_eq!(sent["message"]["type"], "fetch_agents_request");
        let id = sent["message"]["requestId"].as_str().unwrap().to_owned();

        // An unrelated push is an event, not the answer.
        let seen = Rc::new(RefCell::new(Vec::new()));
        let s = seen.clone();
        c.subscribe(move |e| {
            if let Event::Session(f) = e {
                s.borrow_mut().push(f.kind.clone());
            }
        });
        c.handle_frame(r#"{"type":"session","message":{"type":"agent_update","payload":{}}}"#);
        c.handle_frame(&format!(
            r#"{{"type":"session","message":{{"type":"fetch_agents_response","payload":{{"requestId":"{id}","entries":[],"pageInfo":{{"nextCursor":null,"prevCursor":null,"hasMore":false}}}}}}}}"#
        ));
        pool.run_until_stalled();
        assert_eq!(*seen.borrow(), vec!["agent_update".to_owned()]);
        let payload = result.borrow_mut().take().unwrap().unwrap();
        assert!(payload.entries.is_empty());
    }

    #[test]
    fn close_fails_requests_in_flight() {
        let (c, _t) = client();
        let mut pool = LocalPool::new();
        let result = Rc::new(RefCell::new(None));
        {
            let c = c.clone();
            let result = result.clone();
            pool.spawner()
                .spawn_local(async move {
                    *result.borrow_mut() = Some(c.fetch_agents(None).await);
                })
                .unwrap();
        }
        pool.run_until_stalled();
        c.handle_close();
        pool.run_until_stalled();
        assert_eq!(
            result.borrow_mut().take().unwrap().unwrap_err(),
            Error::Closed
        );
        assert_eq!(c.state(), ConnectionState::Disconnected);
    }
}
