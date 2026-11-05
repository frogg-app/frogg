//! Browser WebSocket transport (WebView on desktop and Android, plain browser on the web).

use std::rc::Rc;

use wasm_bindgen::closure::Closure;
use wasm_bindgen::JsCast;
use web_sys::{BinaryType, CloseEvent, ErrorEvent, Event, MessageEvent, WebSocket};

use crate::relay::SocketOpener;
use crate::{ConnectOptions, DaemonClient, Transport, TransportSink};

struct WsTransport {
    socket: WebSocket,
}

impl Transport for WsTransport {
    fn send(&self, text: String) -> Result<(), String> {
        if self.socket.ready_state() != WebSocket::OPEN {
            return Err(format!(
                "WebSocket not open (readyState={})",
                self.socket.ready_state()
            ));
        }
        self.socket
            .send_with_str(&text)
            .map_err(|e| format!("{e:?}"))
    }

    fn send_binary(&self, bytes: Vec<u8>) -> Result<(), String> {
        if self.socket.ready_state() != WebSocket::OPEN {
            return Err("WebSocket not open".into());
        }
        self.socket
            .send_with_u8_array(&bytes)
            .map_err(|e| format!("{e:?}"))
    }

    fn close(&self) {
        let _ = self.socket.close();
    }

    fn close_with(&self, code: u16, reason: &str) {
        // Browsers accept only 1000 and 3000–4999.
        let code = if code == 1000 || (3000..=4999).contains(&code) {
            code
        } else {
            1000
        };
        let _ = self.socket.close_with_code_and_reason(code, reason);
    }

    fn buffered_amount(&self) -> u64 {
        self.socket.buffered_amount() as u64
    }
}

/// Opens a browser WebSocket reporting to `sink`.
pub fn open_socket(
    url: &str,
    protocols: &[String],
    sink: Rc<dyn TransportSink>,
) -> Result<Rc<dyn Transport>, String> {
    let socket = if protocols.is_empty() {
        WebSocket::new(url)
    } else {
        let arr = js_sys::Array::new();
        for p in protocols {
            arr.push(&p.into());
        }
        WebSocket::new_with_str_sequence(url, &arr)
    }
    .map_err(|e| format!("{e:?}"))?;
    socket.set_binary_type(BinaryType::Arraybuffer);

    let on_open = {
        let sink = sink.clone();
        Closure::<dyn FnMut(Event)>::new(move |_: Event| sink.open())
    };
    let on_message = {
        let sink = sink.clone();
        Closure::<dyn FnMut(MessageEvent)>::new(move |e: MessageEvent| {
            let data = e.data();
            if let Some(text) = data.as_string() {
                sink.text(&text);
            } else if let Some(buf) = data.dyn_ref::<js_sys::ArrayBuffer>() {
                sink.binary(&js_sys::Uint8Array::new(buf).to_vec());
            }
        })
    };
    let on_close = {
        let sink = sink.clone();
        Closure::<dyn FnMut(CloseEvent)>::new(move |e: CloseEvent| {
            sink.close(Some(e.code()), &e.reason())
        })
    };
    let on_error = {
        let sink = sink.clone();
        Closure::<dyn FnMut(Event)>::new(move |e: Event| {
            let message = e
                .dyn_ref::<ErrorEvent>()
                .map(|e| e.message())
                .unwrap_or_default();
            sink.error(&message)
        })
    };
    // Handed to JS so the socket owns them: dropping a Rust-owned closure from inside its own
    // `onclose` call (the client drops the transport there) would be a use-after-free.
    socket.set_onopen(Some(on_open.into_js_value().unchecked_ref()));
    socket.set_onmessage(Some(on_message.into_js_value().unchecked_ref()));
    socket.set_onclose(Some(on_close.into_js_value().unchecked_ref()));
    socket.set_onerror(Some(on_error.into_js_value().unchecked_ref()));

    Ok(Rc::new(WsTransport { socket }))
}

pub fn opener() -> SocketOpener {
    Rc::new(open_socket)
}

/// Connects `client` to `url` (e.g. `ws://127.0.0.1:6767/ws`) and keeps it connected:
/// reconnects with backoff, heartbeat, request timeouts. Any previous connection is closed.
pub fn connect(client: &DaemonClient, url: &str, options: ConnectOptions) -> Result<(), String> {
    if !(url.starts_with("ws://") || url.starts_with("wss://")) {
        return Err(format!("not a WebSocket URL: {url}"));
    }
    crate::relay::connect_direct(client, url, options, opener());
    Ok(())
}
