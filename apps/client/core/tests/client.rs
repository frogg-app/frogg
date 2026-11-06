//! DaemonClient against a fake transport and a manual clock: correlation, queueing,
//! timeouts, reconnect/backoff, the stale-socket guard, auth rejection, heartbeat,
//! feature gates, terminal and file binary frames, and relay E2EE end to end.

use std::cell::RefCell;
use std::future::Future;
use std::rc::Rc;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use frogg_client_core::crypto::{self, KeyPair};
use frogg_client_core::protocol::inbound;
use frogg_client_core::relay::{self, RelayTarget, SocketOpener};
use frogg_client_core::timer::ManualScheduler;
use frogg_client_core::*;
use futures::executor::LocalPool;
use futures::task::LocalSpawnExt;
use serde_json::{json, Value};

#[derive(Default)]
struct FakeSocket {
    sent: RefCell<Vec<String>>,
    binary: RefCell<Vec<Vec<u8>>>,
    closed: RefCell<Option<u16>>,
}

impl Transport for FakeSocket {
    fn send(&self, text: String) -> std::result::Result<(), String> {
        self.sent.borrow_mut().push(text);
        Ok(())
    }
    fn send_binary(&self, bytes: Vec<u8>) -> std::result::Result<(), String> {
        self.binary.borrow_mut().push(bytes);
        Ok(())
    }
    fn close(&self) {
        self.close_with(1000, "");
    }
    fn close_with(&self, code: u16, _reason: &str) {
        *self.closed.borrow_mut() = Some(code);
    }
}

/// Every connection attempt: the sink the client gave the socket, and the socket.
type Attempts = Rc<RefCell<Vec<(Rc<dyn TransportSink>, Rc<FakeSocket>, Vec<String>)>>>;

struct Harness {
    client: DaemonClient,
    clock: ManualScheduler,
    attempts: Attempts,
    pool: LocalPool,
}

fn config() -> ClientConfig {
    ClientConfig {
        client_id: "cid_test".into(),
        client_type: inbound::HelloClientType::Browser,
        app_version: Some("1.0.0".into()),
        device_name: None,
    }
}

fn opener(attempts: Attempts) -> SocketOpener {
    Rc::new(
        move |_url: &str, protocols: &[String], sink: Rc<dyn TransportSink>| {
            let socket = Rc::new(FakeSocket::default());
            attempts
                .borrow_mut()
                .push((sink, socket.clone(), protocols.to_vec()));
            Ok(socket as Rc<dyn Transport>)
        },
    )
}

fn harness_with(options: impl FnOnce(&mut ClientOptions)) -> Harness {
    let clock = ManualScheduler::new();
    let mut opts = ClientOptions {
        scheduler: Rc::new(clock.clone()),
        ..Default::default()
    };
    options(&mut opts);
    let client = DaemonClient::with_options(config(), opts);
    let attempts: Attempts = Rc::default();
    relay::connect_direct(
        &client,
        "ws://daemon/ws",
        ConnectOptions {
            password: Some("pw".into()),
            token: None,
        },
        opener(attempts.clone()),
    );
    Harness {
        client,
        clock,
        attempts,
        pool: LocalPool::new(),
    }
}

fn harness() -> Harness {
    harness_with(|_| {})
}

const SERVER_INFO: &str = r#"{"type":"session","message":{"type":"status","payload":{"status":"server_info","serverId":"srv","features":{"webUiControl":true,"selectiveAgentTimeline":true}}}}"#;

impl Harness {
    fn sink(&self) -> Rc<dyn TransportSink> {
        self.attempts.borrow().last().unwrap().0.clone()
    }
    fn socket(&self) -> Rc<FakeSocket> {
        self.attempts.borrow().last().unwrap().1.clone()
    }
    fn open_and_greet(&mut self) {
        self.sink().open();
        self.sink().text(SERVER_INFO);
        self.pool.run_until_stalled();
    }
    fn spawn<T: 'static>(
        &mut self,
        fut: impl Future<Output = T> + 'static,
    ) -> Rc<RefCell<Option<T>>> {
        let out = Rc::new(RefCell::new(None));
        let o = out.clone();
        self.pool
            .spawner()
            .spawn_local(async move {
                *o.borrow_mut() = Some(fut.await);
            })
            .unwrap();
        self.pool.run_until_stalled();
        out
    }
    fn sent(&self) -> Vec<Value> {
        self.socket()
            .sent
            .borrow()
            .iter()
            .map(|s| serde_json::from_str(s).unwrap())
            .collect()
    }
    fn last_message(&self) -> Value {
        self.sent().last().unwrap()["message"].clone()
    }
    fn reply(&mut self, message: Value) {
        self.sink()
            .text(&json!({ "type": "session", "message": message }).to_string());
        self.pool.run_until_stalled();
    }
}

#[test]
fn hello_then_connected_on_server_info_with_bearer_protocol() {
    let h = harness();
    assert_eq!(h.client.state(), ConnectionState::Connecting);
    assert_eq!(
        h.attempts.borrow()[0].2,
        vec!["frogg.bearer.pw".to_string()]
    );
    h.sink().open();
    let hello = &h.sent()[0];
    assert_eq!(hello["type"], "hello");
    assert_eq!(hello["clientId"], "cid_test");
    assert_eq!(hello["capabilities"]["compactProviderSnapshots"], true);
    assert!(
        hello.get("auth").is_none(),
        "direct connections authenticate in the handshake"
    );
    serde_json::from_value::<inbound::WsInboundMessage>(hello.clone()).unwrap();
    assert_eq!(h.client.state(), ConnectionState::Connecting);
    h.sink().text(SERVER_INFO);
    assert_eq!(h.client.state(), ConnectionState::Connected);
    assert_eq!(h.client.server_info().unwrap().server_id, "srv");
}

#[test]
fn requests_while_connecting_are_queued_and_flushed() {
    let mut h = harness();
    let r = {
        let c = h.client.clone();
        h.spawn(async move { c.fetch_agents(None).await })
    };
    h.sink().open();
    assert_eq!(h.sent().len(), 1, "only hello before server_info");
    h.sink().text(SERVER_INFO);
    let msg = h.last_message();
    assert_eq!(msg["type"], "fetch_agents_request");
    let id = msg["requestId"].as_str().unwrap().to_owned();
    h.reply(json!({"type":"fetch_agents_response","payload":{"requestId":id,"entries":[],"pageInfo":{"nextCursor":null,"prevCursor":null,"hasMore":false}}}));
    assert!(r.borrow_mut().take().unwrap().unwrap().entries.is_empty());
}

#[test]
fn correlates_on_request_id_and_emits_every_frame() {
    let mut h = harness();
    h.open_and_greet();
    let seen = Rc::new(RefCell::new(Vec::new()));
    let s = seen.clone();
    h.client.subscribe(move |e| {
        if let Event::Session(f) = e {
            s.borrow_mut().push(f.kind.clone());
        }
    });
    let r = {
        let c = h.client.clone();
        h.spawn(async move { c.add_project("/p").await })
    };
    let id = h.last_message()["requestId"].as_str().unwrap().to_owned();
    // A response for someone else and a push do not resolve it.
    h.reply(json!({"type":"project.add.response","payload":{"requestId":"other"}}));
    h.reply(json!({"type":"agent_update","payload":{}}));
    assert!(r.borrow().is_none());
    h.reply(json!({"type":"rpc_error","payload":{"requestId":id,"error":"nope","code":"forbidden","requestType":"project.add.request"}}));
    match r.borrow_mut().take().unwrap() {
        Err(Error::Rpc { error, code, .. }) => {
            assert_eq!(error, "nope");
            assert_eq!(code.as_deref(), Some("forbidden"));
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(
        *seen.borrow(),
        vec!["project.add.response", "agent_update", "rpc_error"]
    );
}

#[test]
fn requests_time_out() {
    let mut h = harness_with(|o| o.heartbeat = false);
    h.open_and_greet();
    let r = {
        let c = h.client.clone();
        h.spawn(async move { c.get_daemon_config().await })
    };
    h.clock.advance(29_999);
    h.pool.run_until_stalled();
    assert!(r.borrow().is_none());
    h.clock.advance(1);
    h.pool.run_until_stalled();
    assert_eq!(
        r.borrow_mut().take().unwrap().unwrap_err(),
        Error::Timeout(30_000)
    );
    // Per-call timeouts follow the TS client (list_provider_models: 90 s).
    let r = {
        let c = h.client.clone();
        h.spawn(async move { c.list_provider_models("claude", None).await })
    };
    h.clock.advance(60_000);
    h.pool.run_until_stalled();
    assert!(r.borrow().is_none());
    h.clock.advance(30_000);
    h.pool.run_until_stalled();
    assert_eq!(
        r.borrow_mut().take().unwrap().unwrap_err(),
        Error::Timeout(90_000)
    );
}

#[test]
fn reconnects_with_backoff_and_ignores_stale_sockets() {
    let mut h = harness();
    h.open_and_greet();
    let first = h.sink();
    let r = {
        let c = h.client.clone();
        h.spawn(async move { c.get_daemon_config().await })
    };
    first.close(Some(1006), "");
    h.pool.run_until_stalled();
    assert_eq!(r.borrow_mut().take().unwrap().unwrap_err(), Error::Closed);
    assert_eq!(h.client.state(), ConnectionState::Disconnected);
    assert_eq!(
        h.client.last_error().as_deref(),
        Some("Transport closed (code 1006)")
    );
    assert!(h.client.server_info().is_none());

    h.clock.advance(1_499);
    assert_eq!(h.attempts.borrow().len(), 1);
    h.clock.advance(1);
    assert_eq!(h.attempts.borrow().len(), 2, "first retry after 1.5 s");
    assert_eq!(h.client.state(), ConnectionState::Connecting);

    // The old socket's late events must not touch the new attempt.
    first.close(Some(1006), "late");
    first.text(SERVER_INFO);
    assert_eq!(h.client.state(), ConnectionState::Connecting);

    // Second failure doubles the delay.
    h.sink().close(None, "");
    h.clock.advance(2_999);
    assert_eq!(h.attempts.borrow().len(), 2);
    h.clock.advance(1);
    assert_eq!(h.attempts.borrow().len(), 3);
    h.open_and_greet();
    assert_eq!(h.client.state(), ConnectionState::Connected);

    // Success resets the backoff.
    h.sink().close(None, "");
    h.clock.advance(1_500);
    assert_eq!(h.attempts.borrow().len(), 4);
}

#[test]
fn connect_timeout_retries() {
    let h = harness();
    h.clock.advance(15_000);
    assert_eq!(
        h.client.last_error().as_deref(),
        Some("Connection timed out")
    );
    assert_eq!(h.socket().closed.borrow().unwrap(), 1001);
    h.clock.advance(1_500);
    assert_eq!(h.attempts.borrow().len(), 2);
}

#[test]
fn auth_rejection_stops_reconnecting() {
    let mut h = harness();
    h.open_and_greet();
    h.sink()
        .close(Some(AUTH_FAILED_CLOSE_CODE), "Invalid credential");
    assert!(matches!(
        h.client.last_error_info(),
        Some(ErrorInfo::PairingRequired {
            credential_rejected: true,
            ..
        })
    ));
    h.clock.advance(120_000);
    assert_eq!(h.attempts.borrow().len(), 1);
    // A rate-limited 4401 is transient.
    h.client.connect();
    assert_eq!(h.attempts.borrow().len(), 2);
    h.sink()
        .close(Some(AUTH_FAILED_CLOSE_CODE), "Too many failed attempts");
    h.clock.advance(1_500);
    assert_eq!(h.attempts.borrow().len(), 3);
}

#[test]
fn http_401_handshake_error_is_an_auth_rejection() {
    let h = harness();
    h.sink().error("Unexpected server response: 401");
    assert!(matches!(
        h.client.last_error_info(),
        Some(ErrorInfo::PairingRequired { .. })
    ));
    h.clock.advance(60_000);
    assert_eq!(h.attempts.borrow().len(), 1);
}

#[test]
fn rejects_an_unexpected_server() {
    let mut h = harness_with(|o| o.expected_server_id = Some("other".into()));
    h.open_and_greet();
    assert_ne!(h.client.state(), ConnectionState::Connected);
    assert!(matches!(
        h.client.last_error_info(),
        Some(ErrorInfo::ServerIdentityMismatch { .. })
    ));
}

#[test]
fn heartbeat_reconnects_after_two_missed_pongs() {
    let mut h = harness();
    h.open_and_greet();
    let pings = |h: &Harness| {
        h.socket()
            .sent
            .borrow()
            .iter()
            .filter(|s| *s == r#"{"type":"ping"}"#)
            .count()
    };
    h.clock.advance(10_000);
    assert_eq!(pings(&h), 1);
    h.sink().text(r#"{"type":"pong"}"#);
    h.pool.run_until_stalled();
    assert!(h.client.last_liveness_rtt_ms().is_some());
    // Miss two in a row.
    h.clock.advance(10_000 + 15_000);
    h.clock.advance(10_000);
    assert_eq!(h.attempts.borrow().len(), 1);
    h.clock.advance(15_000);
    assert_eq!(h.client.state(), ConnectionState::Disconnected);
    assert!(h.client.last_error().unwrap().contains("Liveness"));
    h.clock.advance(1_500);
    assert_eq!(h.attempts.borrow().len(), 2);
}

#[test]
fn feature_gates() {
    let mut h = harness();
    h.open_and_greet();
    let r = {
        let c = h.client.clone();
        h.spawn(async move { c.get_dev_daemon_status().await })
    };
    assert!(matches!(
        r.borrow_mut().take().unwrap(),
        Err(Error::Unsupported(_))
    ));
    let before = h.sent().len();
    let _r = {
        let c = h.client.clone();
        h.spawn(async move { c.get_web_ui_status().await })
    };
    assert_eq!(h.sent().len(), before + 1);
    assert_eq!(h.last_message()["type"], "daemon.web_ui.get_status.request");
    assert!(!h.client.supports_plugins());
    // setAgentTimelineSubscription is a no-op without the feature, sorted and deduped with it.
    let _r = {
        let c = h.client.clone();
        h.spawn(async move {
            c.set_agent_timeline_subscription(&["b".into(), "a".into(), "b".into()])
                .await
        })
    };
    assert_eq!(h.last_message()["agentIds"], json!(["a", "b"]));
}

#[test]
fn accepted_false_is_an_error() {
    let mut h = harness();
    h.open_and_greet();
    let r = {
        let c = h.client.clone();
        h.spawn(async move { c.set_agent_mode("a1", "plan").await })
    };
    let id = h.last_message()["requestId"].as_str().unwrap().to_owned();
    h.reply(json!({"type":"set_agent_mode_response","payload":{"requestId":id,"agentId":"a1","accepted":false,"error":"busy"}}));
    assert_eq!(
        r.borrow_mut().take().unwrap().unwrap_err(),
        Error::Daemon("busy".into())
    );
}

#[test]
fn create_agent_waits_for_its_status() {
    let mut h = harness();
    h.open_and_greet();
    let req: inbound::CreateAgentRequest = serde_json::from_value(json!({
        "requestId": "", "config": { "provider": "claude", "cwd": "/w" }, "initialPrompt": "hi"
    }))
    .unwrap();
    let r = {
        let c = h.client.clone();
        h.spawn(async move { c.create_agent(&req).await })
    };
    let msg = h.last_message();
    assert_eq!(msg["type"], "create_agent_request");
    let id = msg["requestId"].as_str().unwrap().to_owned();
    assert!(!id.is_empty());
    h.reply(
        json!({"type":"status","payload":{"status":"agent_created","requestId":"x","agent":{}}}),
    );
    assert!(r.borrow().is_none());
    h.reply(json!({"type":"status","payload":{"status":"agent_created","requestId":id,"agent":{"id":"a9"}}}));
    assert_eq!(r.borrow_mut().take().unwrap().unwrap()["id"], "a9");
}

#[test]
fn terminal_stream_routing() {
    let mut h = harness();
    h.open_and_greet();
    let events = Rc::new(RefCell::new(Vec::new()));
    let e = events.clone();
    h.client
        .on_terminal_stream_event(move |ev| e.borrow_mut().push(ev.clone()));
    // Before a slot: JSON input.
    h.client
        .send_terminal_input("t1", TerminalInput::Input("ls".into()))
        .unwrap();
    assert_eq!(h.last_message()["type"], "terminal_input");
    let r = {
        let c = h.client.clone();
        h.spawn(async move { c.subscribe_terminal("t1", None).await })
    };
    let id = h.last_message()["requestId"].as_str().unwrap().to_owned();
    h.reply(json!({"type":"subscribe_terminal_response","payload":{"requestId":id,"terminalId":"t1","slot":3,"error":null}}));
    assert!(r.borrow_mut().take().unwrap().is_ok());
    h.sink().binary(&[0x01, 3, b'o', b'k']);
    assert_eq!(
        *events.borrow(),
        vec![TerminalStreamEvent::Output {
            terminal_id: "t1".into(),
            data: b"ok".to_vec()
        }]
    );
    h.client
        .send_terminal_input("t1", TerminalInput::Input("pwd".into()))
        .unwrap();
    assert_eq!(
        h.socket().binary.borrow().last().unwrap(),
        &vec![0x02, 3, b'p', b'w', b'd']
    );
    // Exit frees the slot.
    h.reply(json!({"type":"terminal_stream_exit","payload":{"terminalId":"t1"}}));
    h.sink().binary(&[0x01, 3, b'x']);
    assert_eq!(events.borrow().len(), 1);
}

#[test]
fn read_file_over_binary_frames() {
    use frogg_client_core::binary::{encode_file_frame, FileBeginMetadata, FileFrame};
    let mut h = harness();
    h.open_and_greet();
    let r = {
        let c = h.client.clone();
        h.spawn(async move { c.read_file("/w", "a.txt", None).await })
    };
    let msg = h.last_message();
    assert_eq!(msg["acceptBinary"], true);
    let rid = msg["requestId"].as_str().unwrap().to_owned();
    let frames = [
        FileFrame::Begin {
            request_id: rid.clone(),
            metadata: FileBeginMetadata {
                mime: "text/plain".into(),
                size: 5,
                encoding: "utf-8".into(),
                modified_at: "2026-01-01T00:00:00Z".into(),
                revision: Some("r1".into()),
                file_name: None,
            },
        },
        FileFrame::Chunk {
            request_id: rid.clone(),
            payload: b"hel".to_vec(),
        },
        FileFrame::Chunk {
            request_id: rid.clone(),
            payload: b"lo".to_vec(),
        },
        FileFrame::End { request_id: rid },
    ];
    for f in frames {
        h.sink().binary(&encode_file_frame(&f).unwrap());
    }
    h.pool.run_until_stalled();
    let file = r.borrow_mut().take().unwrap().unwrap();
    assert_eq!(file.bytes, b"hello");
    assert_eq!(file.kind, "text");
    assert_eq!(file.revision.as_deref(), Some("r1"));
}

#[test]
fn provider_snapshots_are_expanded() {
    let mut h = harness();
    h.open_and_greet();
    let seen = Rc::new(RefCell::new(None));
    let s = seen.clone();
    h.client.subscribe(move |e| {
        if let Event::Session(f) = e {
            if f.kind == "providers_snapshot_update" {
                *s.borrow_mut() = Some(f.json());
            }
        }
    });
    h.reply(
        json!({"type":"providers_snapshot_update","payload":{"entries":[],"compactSnapshot":{
        "entries":[{"provider":"claude","models":[{"id":"m","thinkingSet":0}]}],
        "thinkingSets":[{"options":[{"id":"hi"}]}]}}}),
    );
    let v = seen.borrow().clone().unwrap();
    assert_eq!(
        v["payload"]["entries"][0]["models"][0]["thinkingOptions"][0]["id"],
        "hi"
    );
}

/// Every RPC sends a message the generated inbound schema accepts.
#[test]
fn every_request_matches_the_inbound_schema() {
    let mut h = harness_with(|o| o.heartbeat = false);
    h.open_and_greet();
    h.reply(json!({"type":"status","payload":{"status":"server_info","serverId":"srv","features":{
        "webUiControl":true,"daemonChannelControl":true,"daemonUpdateRuns":true,"devDaemonRebuild":true,
        "plugins":true,"selectiveAgentTimeline":true}}}));
    let c = h.client.clone();
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    macro_rules! calls {
        ($($e:expr),* $(,)?) => {{ $( { let c = c.clone(); let _ = h.spawn(async move { let _ = $e(c).await; }); } )* }};
    }
    calls!(
        |c: DaemonClient| async move { c.fetch_agents(None).await.map(|_| ()) },
        |c: DaemonClient| async move { c.archive_agent("a").await.map(|_| ()) },
        |c: DaemonClient| async move { c.detach_agent("a").await },
        |c: DaemonClient| async move { c.cancel_agent_auto_resume("a").await },
        |c: DaemonClient| async move { c.cancel_agent("a").await },
        |c: DaemonClient| async move { c.refresh_agent("a").await.map(|_| ()) },
        |c: DaemonClient| async move { c.update_agent("a", Some("n"), None).await },
        |c: DaemonClient| async move { c.set_agent_mode("a", "m").await.map(|_| ()) },
        |c: DaemonClient| async move { c.set_agent_model("a", None).await },
        |c: DaemonClient| async move {
            c.set_agent_thinking_option("a", Some("hi"))
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move {
            c.transfer_agent_provider_account("a", None)
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move {
            c.clean_cut_agent("a", serde_json::Map::new())
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move { c.rewind_agent("a", "m", "both").await.map(|_| ()) },
        |c: DaemonClient| async move { c.clear_agent_attention(&["a".into()]).await },
        |c: DaemonClient| async move { c.send_message("a", "hi", Default::default()).await },
        |c: DaemonClient| async move {
            c.fetch_agent_timeline("a", Default::default())
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move { c.set_agent_timeline_subscription(&["a".into()]).await },
        |c: DaemonClient| async move {
            c.build_agent_fork_context("a", None, Some("m"))
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move { c.list_provider_subagents("a", None).await.map(|_| ()) },
        |c: DaemonClient| async move {
            c.fetch_provider_subagent_timeline("a", "s", Default::default())
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move {
            c.list_provider_agent_definitions(Some("/w"))
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move { c.list_commands("a", None).await.map(|_| ()) },
        |c: DaemonClient| async move { c.set_workspace_pinned("w", true).await.map(|_| ()) },
        |c: DaemonClient| async move { c.list_workspace_labels("sub", None).await.map(|_| ()) },
        |c: DaemonClient| async move {
            c.set_workspace_label(
                "w",
                &serde_json::from_value(json!({"name":"x","color":"violet"})).unwrap(),
                true,
            )
            .await
            .map(|_| ())
        },
        |c: DaemonClient| async move {
            c.update_workspace_label("x", Some("y"), None)
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move { c.delete_workspace_label("x").await.map(|_| ()) },
        |c: DaemonClient| async move { c.list_projects(None).await.map(|_| ()) },
        |c: DaemonClient| async move { c.add_project("/p").await.map(|_| ()) },
        |c: DaemonClient| async move { c.create_project_directory("/p", "n").await.map(|_| ()) },
        |c: DaemonClient| async move { c.read_project_config("/p").await.map(|_| ()) },
        |c: DaemonClient| async move {
            c.get_branch_suggestions("/p", Some("ma"), Some(5))
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move { c.get_checkout_status("/p").await.map(|_| ()) },
        |c: DaemonClient| async move {
            c.subscribe_checkout_diff("/p", json!({"mode":"base","baseRef":" main "}), None)
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move {
            c.checkout_commit("/p", Some("m"), Some(true))
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move {
            c.checkout_merge("/p", None, Some("squash"), None)
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move {
            c.checkout_merge_from_base("/p", None, None)
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move { c.checkout_pull("/p").await.map(|_| ()) },
        |c: DaemonClient| async move { c.checkout_push("/p").await.map(|_| ()) },
        |c: DaemonClient| async move { c.checkout_switch_branch("/p", "b").await.map(|_| ()) },
        |c: DaemonClient| async move {
            c.checkout_discard_changes("/p", &["a".into()])
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move { c.list_checkout_commits("/p").await.map(|_| ()) },
        |c: DaemonClient| async move {
            c.checkout_pr_create("/p", Some("t"), None, None)
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move { c.checkout_pr_merge("/p", "squash").await.map(|_| ()) },
        |c: DaemonClient| async move { c.checkout_pr_status("/p").await.map(|_| ()) },
        |c: DaemonClient| async move {
            c.checkout_forge_set_auto_merge("/p", true, Some("squash"))
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move { c.checkout_ci_list_runs("/p").await.map(|_| ()) },
        |c: DaemonClient| async move { c.checkout_streams_get_graph("/p", true).await.map(|_| ()) },
        |c: DaemonClient| async move { c.stash_save("/p", None).await.map(|_| ()) },
        |c: DaemonClient| async move { c.stash_pop("/p", 0).await.map(|_| ()) },
        |c: DaemonClient| async move { c.stash_list("/p", Some(true)).await.map(|_| ()) },
        |c: DaemonClient| async move { c.list_directory("/p", ".").await.map(|_| ()) },
        |c: DaemonClient| async move { c.read_file("/p", "a", Some(10)).await.map(|_| ()) },
        |c: DaemonClient| async move {
            c.write_file("/p", "a", "x", "2026-01-01T00:00:00Z", None)
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move {
            c.create_file_entry("/p", ".", "n", "file")
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move { c.rename_file_entry("/p", "a", "b").await.map(|_| ()) },
        |c: DaemonClient| async move { c.duplicate_file_entry("/p", "a").await.map(|_| ()) },
        |c: DaemonClient| async move { c.delete_file_entry("/p", "a").await.map(|_| ()) },
        |c: DaemonClient| async move { c.zip_directory("/p", ".", true).await.map(|_| ()) },
        |c: DaemonClient| async move { c.list_terminals(Some("/p"), None).await.map(|_| ()) },
        |c: DaemonClient| async move {
            c.create_terminal(
                "/p",
                CreateTerminalOptions {
                    name: Some("t".into()),
                    ..Default::default()
                },
            )
            .await
            .map(|_| ())
        },
        |c: DaemonClient| async move { c.kill_terminal("t").await.map(|_| ()) },
        |c: DaemonClient| async move { c.subscribe_terminal("t", None).await.map(|_| ()) },
        |c: DaemonClient| async move { c.get_providers_snapshot(Some("/p"), None).await.map(|_| ()) },
        |c: DaemonClient| async move {
            c.refresh_providers_snapshot(None, Some(&["claude".into()]))
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move { c.list_provider_models("claude", None).await.map(|_| ()) },
        |c: DaemonClient| async move {
            c.list_provider_features(json!({"provider":"claude","cwd":"/p"}))
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move {
            c.list_provider_usage(Some("claude"), Some(None), Some(1000))
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move { c.check_provider_updates(Some(true)).await.map(|_| ()) },
        |c: DaemonClient| async move { c.install_provider_update("claude", None).await.map(|_| ()) },
        |c: DaemonClient| async move { c.list_provider_accounts(None).await.map(|_| ()) },
        |c: DaemonClient| async move {
            c.create_provider_account("claude", "work", None)
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move { c.delete_provider_account("x").await.map(|_| ()) },
        |c: DaemonClient| async move { c.sign_out_provider_account("x").await.map(|_| ()) },
        |c: DaemonClient| async move {
            c.set_active_provider_account("claude", None)
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move {
            c.set_provider_account_preferences("x", None)
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move { c.export_provider_accounts("claude", None).await.map(|_| ()) },
        |c: DaemonClient| async move { c.list_claude_plugins().await.map(|_| ()) },
        |c: DaemonClient| async move { c.get_daemon_status(None).await.map(|_| ()) },
        |c: DaemonClient| async move { c.get_daemon_config().await.map(|_| ()) },
        |c: DaemonClient| async move { c.patch_daemon_config(json!({})).await.map(|_| ()) },
        |c: DaemonClient| async move { c.get_daemon_pairing_offer(None).await.map(|_| ()) },
        |c: DaemonClient| async move { c.get_daemon_security_posture(None).await.map(|_| ()) },
        |c: DaemonClient| async move {
            c.set_security_finding_acknowledged("f", true)
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move { c.get_host_metrics(None).await.map(|_| ()) },
        |c: DaemonClient| async move { c.collect_diagnostics().await.map(|_| ()) },
        |c: DaemonClient| async move { c.list_skills(None).await.map(|_| ()) },
        |c: DaemonClient| async move { c.get_skill_content("s").await.map(|_| ()) },
        |c: DaemonClient| async move { c.set_skill_enabled("s", false).await.map(|_| ()) },
        |c: DaemonClient| async move { c.list_owned_storage(true).await.map(|_| ()) },
        |c: DaemonClient| async move { c.clean_owned_storage("c").await.map(|_| ()) },
        |c: DaemonClient| async move { c.restart_server(Some("why")).await.map(|_| ()) },
        |c: DaemonClient| async move { c.update_daemon().await.map(|_| ()) },
        |c: DaemonClient| async move { c.check_daemon_update(None).await.map(|_| ()) },
        |c: DaemonClient| async move { c.start_daemon_update(None, None).await.map(|_| ()) },
        |c: DaemonClient| async move { c.get_daemon_update_status().await.map(|_| ()) },
        |c: DaemonClient| async move { c.get_dev_daemon_status().await.map(|_| ()) },
        |c: DaemonClient| async move { c.start_dev_daemon("/p").await.map(|_| ()) },
        |c: DaemonClient| async move { c.stop_dev_daemon(None).await.map(|_| ()) },
        |c: DaemonClient| async move { c.rebuild_dev_daemon("web", None).await.map(|_| ()) },
        |c: DaemonClient| async move { c.get_web_ui_status().await.map(|_| ()) },
        |c: DaemonClient| async move { c.start_web_ui().await.map(|_| ()) },
        |c: DaemonClient| async move { c.stop_web_ui().await.map(|_| ()) },
        |c: DaemonClient| async move { c.update_web_ui(Some(true), None).await.map(|_| ()) },
        |c: DaemonClient| async move { c.get_auth_settings().await.map(|_| ()) },
        |c: DaemonClient| async move { c.update_auth_settings(Some(true), None).await.map(|_| ()) },
        |c: DaemonClient| async move { c.set_daemon_password(None).await.map(|_| ()) },
        |c: DaemonClient| async move { c.list_devices().await.map(|_| ()) },
        |c: DaemonClient| async move { c.rename_device("d", "n").await.map(|_| ()) },
        |c: DaemonClient| async move { c.revoke_device("d").await.map(|_| ()) },
        |c: DaemonClient| async move { c.set_device_role("d", "viewer").await.map(|_| ()) },
        |c: DaemonClient| async move {
            c.create_pairing_code(Some("operator"), Some(600))
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move { c.list_pairing_requests().await.map(|_| ()) },
        |c: DaemonClient| async move {
            c.decide_pairing_request("p", "approve", None, None)
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move { c.fetch_companion_notebook().await.map(|_| ()) },
        |c: DaemonClient| async move { c.send_companion_message("hi").await },
        |c: DaemonClient| async move { c.plugins_list().await.map(|_| ()) },
        |c: DaemonClient| async move { c.plugins_repos_list().await.map(|_| ()) },
        |c: DaemonClient| async move {
            c.plugins_repos_add("https://r", None, None)
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move { c.plugins_repos_remove("https://r").await.map(|_| ()) },
        |c: DaemonClient| async move { c.plugins_get_catalog(true).await.map(|_| ()) },
        |c: DaemonClient| async move {
            c.plugins_install("p", "https://r", &s(&["net"]), None)
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move { c.plugins_uninstall("p").await.map(|_| ()) },
        |c: DaemonClient| async move { c.plugins_set_enabled("p", true).await.map(|_| ()) },
        |c: DaemonClient| async move { c.plugins_set_remote_control("p", false).await.map(|_| ()) },
        |c: DaemonClient| async move { c.plugins_update("p", None, None).await.map(|_| ()) },
        |c: DaemonClient| async move { c.plugins_dev_unlink("p").await.map(|_| ()) },
        |c: DaemonClient| async move { c.plugins_rpc_call("p", "m", None).await.map(|_| ()) },
        |c: DaemonClient| async move { c.plugins_get_contributions().await.map(|_| ()) },
        |c: DaemonClient| async move { c.plugins_settings_get("p").await.map(|_| ()) },
        |c: DaemonClient| async move {
            c.plugins_settings_set("p", serde_json::Map::new())
                .await
                .map(|_| ())
        },
        |c: DaemonClient| async move { c.ping(None).await.map(|_| ()) },
    );
    c.respond_to_permission("a", "perm1", json!({"behavior":"allow"}))
        .unwrap();
    c.subscribe_terminals("/p", Some("w")).unwrap();
    c.unsubscribe_terminal("t").unwrap();
    c.unsubscribe_checkout_diff("sub").unwrap();

    let mut bad = Vec::new();
    let sent = h.sent();
    assert!(sent.len() > 120, "{} messages", sent.len());
    for msg in sent {
        if let Err(e) = serde_json::from_value::<inbound::WsInboundMessage>(msg.clone()) {
            bad.push(format!("{}: {e}", msg["message"]["type"]));
        }
    }
    assert!(
        bad.is_empty(),
        "rejected by the inbound schema:\n{}",
        bad.join("\n")
    );
}

#[test]
fn relay_connection_is_end_to_end_encrypted() {
    let clock = ManualScheduler::new();
    let client = DaemonClient::with_options(
        config(),
        ClientOptions {
            scheduler: Rc::new(clock.clone()),
            ..Default::default()
        },
    );
    let daemon = KeyPair::generate().unwrap();
    let attempts: Attempts = Rc::default();
    let urls = Rc::new(RefCell::new(Vec::new()));
    let open: SocketOpener = {
        let inner = opener(attempts.clone());
        let urls = urls.clone();
        Rc::new(move |url: &str, p: &[String], sink| {
            urls.borrow_mut().push(url.to_owned());
            inner(url, p, sink)
        })
    };
    relay::connect_relay(
        &client,
        &RelayTarget {
            endpoint: "relay.test:443".into(),
            use_tls: true,
            server_id: "srv".into(),
            daemon_public_key_b64: crypto::export_key(&daemon.public_key),
        },
        ConnectOptions {
            password: Some("devtoken".into()),
            token: None,
        },
        open,
    )
    .unwrap();
    assert_eq!(
        urls.borrow()[0],
        "wss://relay.test:443/ws?serverId=srv&role=client&v=2"
    );
    let (sink, socket, protocols) = attempts.borrow()[0].clone();
    assert!(
        protocols.is_empty(),
        "relay sockets carry no bearer subprotocol"
    );
    sink.open();
    let hello: Value = serde_json::from_str(&socket.sent.borrow()[0]).unwrap();
    assert_eq!(hello["type"], "e2ee_hello");
    let client_pub = crypto::import_public_key(hello["key"].as_str().unwrap()).unwrap();
    let shared = crypto::derive_shared_key(&daemon.secret_key, &client_pub).unwrap();
    sink.text(r#"{"type":"e2ee_ready","capabilities":{"binaryCiphertext":true}}"#);

    // The app hello is encrypted and carries the token.
    let wire = socket.sent.borrow()[1].clone();
    let app_hello: Value =
        serde_json::from_slice(&crypto::decrypt(&shared, &STANDARD.decode(wire).unwrap()).unwrap())
            .unwrap();
    assert_eq!(app_hello["type"], "hello");
    assert_eq!(app_hello["auth"]["token"], "devtoken");

    // Encrypted server_info connects the client.
    let info = crypto::encrypt(&shared, SERVER_INFO.as_bytes()).unwrap();
    sink.text(&STANDARD.encode(info));
    assert_eq!(client.state(), ConnectionState::Connected);
}

#[test]
fn upload_cancel_ends_the_stream_short() {
    use frogg_client_core::binary::{decode_file_frame, FileFrame};
    let mut h = harness();
    h.open_and_greet();
    let flag = Rc::new(std::cell::Cell::new(false));
    let r = {
        let c = h.client.clone();
        let flag = flag.clone();
        h.spawn(async move {
            let data = [7u8; 10];
            let read = |a: u64, b: u64| {
                // Cancel once the first chunk has been read.
                flag.set(true);
                data[a as usize..b as usize].to_vec()
            };
            c.upload_file_stream_cancellable(
                FileUploadInput {
                    file_name: "a.bin".into(),
                    mime_type: "application/octet-stream".into(),
                    size: 10,
                    modified_at: None,
                    chunk_size: Some(4),
                    read: &read,
                    on_progress: None,
                },
                &|| flag.get(),
            )
            .await
        })
    };
    h.pool.run_until_stalled();
    assert!(matches!(
        r.borrow_mut().take().unwrap(),
        Err(Error::Cancelled)
    ));
    let frames: Vec<FileFrame> = h
        .socket()
        .binary
        .borrow()
        .iter()
        .map(|b| decode_file_frame(b).unwrap())
        .collect();
    assert_eq!(frames.len(), 3);
    assert!(matches!(frames[0], FileFrame::Begin { .. }));
    assert!(matches!(&frames[1], FileFrame::Chunk { payload, .. } if payload.len() == 4));
    assert!(matches!(frames[2], FileFrame::End { .. }));
}
