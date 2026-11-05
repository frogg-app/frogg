//! Read-only smoke test against a running daemon over a native socket (tungstenite):
//! connects, prints server info, fetches agents and the providers snapshot, measures latency.
//!
//!   cargo run -p frogg-client-core --example live -- [ws://127.0.0.1:6791/ws]
//!
//! `FROGG_PASSWORD` (or a file named by `FROGG_PASSWORD_FILE`, e.g. `$FROGG_HOME/local-token`)
//! sets the bearer credential.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::io::ErrorKind;
use std::net::TcpStream;
use std::rc::Rc;
use std::time::{Duration, Instant};

use frogg_client_core::protocol::inbound;
use frogg_client_core::relay::{self, SocketOpener};
use frogg_client_core::timer::ManualScheduler;
use frogg_client_core::*;
use futures::executor::LocalPool;
use futures::task::LocalSpawnExt;
use tungstenite::client::IntoClientRequest;
use tungstenite::{Message, WebSocket};

enum Incoming {
    Open,
    Text(String),
    Binary(Vec<u8>),
    Close(Option<u16>, String),
    Error(String),
}

struct Socket {
    ws: RefCell<Option<WebSocket<TcpStream>>>,
}

impl Transport for Socket {
    fn send(&self, text: String) -> std::result::Result<(), String> {
        self.write(Message::text(text))
    }
    fn send_binary(&self, bytes: Vec<u8>) -> std::result::Result<(), String> {
        self.write(Message::binary(bytes))
    }
    fn close(&self) {
        if let Some(ws) = self.ws.borrow_mut().as_mut() {
            let _ = ws.close(None);
        }
    }
}

impl Socket {
    fn write(&self, m: Message) -> std::result::Result<(), String> {
        let mut ws = self.ws.borrow_mut();
        let ws = ws.as_mut().ok_or("closed")?;
        match ws.send(m) {
            Ok(()) => Ok(()),
            Err(tungstenite::Error::Io(e)) if e.kind() == ErrorKind::WouldBlock => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

type Live = Rc<RefCell<Vec<(Rc<Socket>, Rc<dyn TransportSink>, VecDeque<Incoming>)>>>;

fn opener(live: Live) -> SocketOpener {
    Rc::new(
        move |url: &str, protocols: &[String], sink: Rc<dyn TransportSink>| {
            let mut req = url.into_client_request().map_err(|e| e.to_string())?;
            if !protocols.is_empty() {
                req.headers_mut().insert(
                    "Sec-WebSocket-Protocol",
                    protocols.join(", ").parse().map_err(|_| "bad protocol")?,
                );
            }
            let host = req.uri().host().unwrap_or("127.0.0.1").to_owned();
            let port = req.uri().port_u16().unwrap_or(80);
            let mut events = VecDeque::new();
            let socket = match TcpStream::connect((host.as_str(), port)) {
                Ok(stream) => match tungstenite::client::client(req, stream) {
                    Ok((ws, _)) => {
                        ws.get_ref()
                            .set_nonblocking(true)
                            .map_err(|e| e.to_string())?;
                        events.push_back(Incoming::Open);
                        Some(ws)
                    }
                    Err(e) => {
                        events.push_back(Incoming::Error(e.to_string()));
                        events.push_back(Incoming::Close(Some(1006), String::new()));
                        None
                    }
                },
                Err(e) => {
                    events.push_back(Incoming::Error(e.to_string()));
                    events.push_back(Incoming::Close(Some(1006), String::new()));
                    None
                }
            };
            let socket = Rc::new(Socket {
                ws: RefCell::new(socket),
            });
            live.borrow_mut().push((socket.clone(), sink, events));
            Ok(socket as Rc<dyn Transport>)
        },
    )
}

fn pump(live: &Live) {
    let entries: Vec<_> = live
        .borrow()
        .iter()
        .map(|(s, k, _)| (s.clone(), k.clone()))
        .collect();
    for (i, (socket, sink)) in entries.into_iter().enumerate() {
        let queued: Vec<Incoming> = live.borrow_mut()[i].2.drain(..).collect();
        let mut events = queued;
        if let Some(ws) = socket.ws.borrow_mut().as_mut() {
            let _ = ws.flush();
            loop {
                match ws.read() {
                    Ok(Message::Text(t)) => events.push(Incoming::Text(t.to_string())),
                    Ok(Message::Binary(b)) => events.push(Incoming::Binary(b.to_vec())),
                    Ok(Message::Close(f)) => {
                        events.push(Incoming::Close(
                            f.as_ref().map(|f| f.code.into()),
                            f.map(|f| f.reason.to_string()).unwrap_or_default(),
                        ));
                        break;
                    }
                    Ok(_) => {}
                    Err(tungstenite::Error::Io(e)) if e.kind() == ErrorKind::WouldBlock => break,
                    Err(e) => {
                        events.push(Incoming::Close(Some(1006), e.to_string()));
                        break;
                    }
                }
            }
        }
        for e in events {
            match e {
                Incoming::Open => sink.open(),
                Incoming::Text(t) => sink.text(&t),
                Incoming::Binary(b) => sink.binary(&b),
                Incoming::Close(c, r) => {
                    socket.ws.borrow_mut().take();
                    sink.close(c, &r)
                }
                Incoming::Error(m) => sink.error(&m),
            }
        }
    }
}

fn run<T: 'static>(
    pool: &mut LocalPool,
    clock: &ManualScheduler,
    live: &Live,
    fut: impl std::future::Future<Output = T> + 'static,
) -> T {
    let out = Rc::new(RefCell::new(None));
    let o = out.clone();
    pool.spawner()
        .spawn_local(async move { *o.borrow_mut() = Some(fut.await) })
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        pump(live);
        clock.run_due_realtime();
        pool.run_until_stalled();
        if let Some(v) = out.borrow_mut().take() {
            return v;
        }
        assert!(Instant::now() < deadline, "timed out");
        std::thread::sleep(Duration::from_millis(5));
    }
}

fn main() {
    let url = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "ws://127.0.0.1:6791/ws".into());
    let clock = ManualScheduler::new();
    let client = DaemonClient::with_options(
        ClientConfig {
            client_id: identity::new_client_id(),
            client_type: inbound::HelloClientType::Cli,
            app_version: Some(env!("CARGO_PKG_VERSION").into()),
            device_name: Some("frogg-client-core live example".into()),
        },
        ClientOptions {
            scheduler: Rc::new(clock.clone()),
            ..Default::default()
        },
    );
    let live: Live = Rc::default();
    let password = std::env::var("FROGG_PASSWORD").ok().or_else(|| {
        std::env::var("FROGG_PASSWORD_FILE")
            .ok()
            .and_then(|p| std::fs::read_to_string(p).ok())
    });
    relay::connect_direct(
        &client,
        &url,
        ConnectOptions {
            password,
            token: None,
        },
        opener(live.clone()),
    );
    let mut pool = LocalPool::new();

    let c = client.clone();
    run(&mut pool, &clock, &live, async move { c.ready().await }).expect("connect");
    let info = client.server_info().unwrap();
    let mut features: Vec<_> = info
        .features
        .iter()
        .filter(|(_, v)| **v == true)
        .map(|(k, _)| k.as_str())
        .collect();
    features.sort();
    println!(
        "connected: serverId={} hostname={:?} version={:?} role={:?}\n  features ({}): {}",
        info.server_id,
        info.hostname_str(),
        info.version_str(),
        info.caller_role,
        features.len(),
        features.join(", ")
    );

    let c = client.clone();
    let agents = run(&mut pool, &clock, &live, async move {
        c.fetch_agents(None).await
    })
    .expect("fetch_agents");
    println!(
        "fetch_agents: {} entries, hasMore={}",
        agents.entries.len(),
        agents.page_info.has_more
    );
    for e in agents.entries.iter().take(5) {
        println!("  - {} {:?}", e.agent.id, e.agent.title);
    }

    let c = client.clone();
    let snap = run(&mut pool, &clock, &live, async move {
        c.get_providers_snapshot(None, None).await
    })
    .expect("providers snapshot");
    println!("providers snapshot: {} providers", snap.entries.len());
    for e in &snap.entries {
        let models = e.models.as_ref().map_or(0, |m| m.len());
        println!("  - {} ({models} models)", e.provider);
    }

    let c = client.clone();
    let status = run(&mut pool, &clock, &live, async move {
        c.get_daemon_status(None).await
    });
    println!(
        "daemon status: {}",
        if status.is_ok() { "ok" } else { "error" }
    );
    if let Err(e) = status {
        println!("  {e}");
    }

    let c = client.clone();
    let ping = run(&mut pool, &clock, &live, async move { c.ping(None).await }).expect("ping");
    println!("ping rtt {:.1} ms", ping.rtt_ms);
    let c = client.clone();
    let rtt = run(&mut pool, &clock, &live, async move {
        c.measure_latency(None).await
    })
    .expect("latency");
    println!("envelope ping rtt {rtt:.1} ms");
    client.close();
}
