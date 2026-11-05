//! Browser WebSocket transport (WebView on desktop and Android, plain browser on the web).

use std::rc::Rc;

use wasm_bindgen::closure::Closure;
use wasm_bindgen::JsCast;
use web_sys::{Event, MessageEvent, WebSocket};

use crate::{DaemonClient, Transport};

struct WsTransport {
    socket: WebSocket,
}

impl Transport for WsTransport {
    fn send(&self, text: String) -> Result<(), String> {
        self.socket.send_with_str(&text).map_err(|e| format!("{e:?}"))
    }

    fn close(&self) {
        let _ = self.socket.close();
    }
}

/// Opens `url` (e.g. `ws://127.0.0.1:6767/ws`) and attaches it to `client`.
pub fn connect(client: &DaemonClient, url: &str) -> Result<(), String> {
    let socket = WebSocket::new(url).map_err(|e| format!("{e:?}"))?;

    let on_open = {
        let client = client.clone();
        Closure::<dyn FnMut(Event)>::new(move |_: Event| client.handle_open())
    };
    let on_message = {
        let client = client.clone();
        Closure::<dyn FnMut(Event)>::new(move |e: Event| {
            if let Some(text) = e
                .dyn_ref::<MessageEvent>()
                .and_then(|m| m.data().as_string())
            {
                client.handle_frame(&text);
            }
        })
    };
    let on_close = {
        let client = client.clone();
        Closure::<dyn FnMut(Event)>::new(move |_: Event| client.handle_close())
    };
    // Handed to JS so the socket owns them: dropping a Rust-owned closure from inside its own
    // `onclose` call (the client drops the transport there) would be a use-after-free.
    socket.set_onopen(Some(on_open.into_js_value().unchecked_ref()));
    socket.set_onmessage(Some(on_message.into_js_value().unchecked_ref()));
    socket.set_onclose(Some(on_close.into_js_value().unchecked_ref()));

    client.attach(Rc::new(WsTransport { socket }));
    Ok(())
}
