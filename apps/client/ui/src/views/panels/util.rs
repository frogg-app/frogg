//! Pieces the panels share: a confirm dialog, browser downloads, dropped files, shell quoting.

use leptos::prelude::*;
use wasm_bindgen::JsCast;

use crate::components::{Button, ButtonKind, TextInput};

/// What a confirm dialog asks.
#[derive(Clone)]
pub struct Ask {
    pub title: String,
    pub body: String,
    pub action: String,
    pub danger: bool,
    pub run: Callback<()>,
}

impl Ask {
    pub fn new(
        title: impl Into<String>,
        body: impl Into<String>,
        action: impl Into<String>,
        run: impl Fn() + Send + Sync + 'static,
    ) -> Self {
        Self {
            title: title.into(),
            body: body.into(),
            action: action.into(),
            danger: false,
            run: Callback::new(move |_| run()),
        }
    }

    pub fn danger(mut self) -> Self {
        self.danger = true;
        self
    }
}

/// A confirm dialog slot (ui-next `useConfirm`): `ask.set(Some(..))` opens it.
#[component]
pub fn Confirm(ask: RwSignal<Option<Ask>>) -> impl IntoView {
    let open = Signal::derive(move || ask.with(|a| a.is_some()));
    let close = Callback::new(move |_| ask.set(None));
    view! {
        <Sheet open=open on_close=close width=400.0>
            {move || {
                ask.get()
                    .map(|a| {
                        let run = a.run;
                        let kind = if a.danger { ButtonKind::Danger } else { ButtonKind::Primary };
                        view! {
                            <div class="pn-confirm">
                                <span class="t-display pn-confirm-title">{a.title}</span>
                                <span class="pn-confirm-body">{a.body}</span>
                                <div class="pn-confirm-row">
                                    <Button label="Cancel" kind=ButtonKind::Ghost on_press=close />
                                    <Button
                                        label=a.action
                                        kind=kind
                                        on_press=Callback::new(move |_| {
                                            ask.set(None);
                                            run.run(());
                                        })
                                    />
                                </div>
                            </div>
                        }
                    })
            }}
        </Sheet>
    }
}

/// What a text prompt asks; `run` returns an error to show, or `None` to close.
#[derive(Clone)]
pub struct PromptSpec {
    pub eyebrow: String,
    pub title: String,
    pub initial: String,
    pub action: String,
    pub run: PromptRun,
}

/// The async action behind a [`PromptSpec`].
pub type PromptRun = std::sync::Arc<
    dyn Fn(String) -> std::pin::Pin<Box<dyn std::future::Future<Output = Option<String>>>>
        + Send
        + Sync,
>;

impl PromptSpec {
    pub fn new<F, Fut>(
        eyebrow: impl Into<String>,
        title: impl Into<String>,
        initial: impl Into<String>,
        action: impl Into<String>,
        run: F,
    ) -> Self
    where
        F: Fn(String) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Option<String>> + 'static,
    {
        Self {
            eyebrow: eyebrow.into(),
            title: title.into(),
            initial: initial.into(),
            action: action.into(),
            run: std::sync::Arc::new(move |v| Box::pin(run(v))),
        }
    }
}

/// A one-field prompt (ui-next `usePrompt`): `spec.set(Some(..))` opens it.
#[component]
pub fn Prompt(spec: RwSignal<Option<PromptSpec>>) -> impl IntoView {
    let open = Signal::derive(move || spec.with(|a| a.is_some()));
    let close = Callback::new(move |_| spec.set(None));
    let value = RwSignal::new(String::new());
    let error = RwSignal::new(None::<String>);
    let busy = RwSignal::new(false);
    Effect::new(move |_| {
        if let Some(s) = spec.get() {
            value.set(s.initial.clone());
            error.set(None);
        }
    });
    let submit = Callback::new(move |_| {
        let Some(s) = spec.get_untracked() else {
            return;
        };
        let v = value.get_untracked().trim().to_owned();
        if v.is_empty() || busy.get_untracked() {
            return;
        }
        busy.set(true);
        leptos::task::spawn_local(async move {
            let res = (s.run)(v).await;
            busy.set(false);
            match res {
                Some(e) => error.set(Some(e)),
                None => spec.set(None),
            }
        });
    });
    view! {
        <Sheet open=open on_close=close width=400.0>
            {move || {
                spec.get()
                    .map(|s| {
                        view! {
                            <div class="pn-confirm">
                                <span class="t-label">{s.eyebrow}</span>
                                <span class="t-display pn-confirm-title">{s.title}</span>
                                <TextInput value=value autofocus=true mono=true on_enter=submit />
                                {move || error.get().map(|e| view! { <span class="pn-error-inline t-mono">{e}</span> })}
                                <div class="pn-confirm-row">
                                    <Button label="Cancel" kind=ButtonKind::Ghost on_press=close />
                                    <Button
                                        label=s.action
                                        kind=ButtonKind::Primary
                                        disabled=Signal::derive(move || busy.get())
                                        on_press=submit
                                    />
                                </div>
                            </div>
                        }
                    })
            }}
        </Sheet>
    }
}

/// Saves bytes as a file through the browser (`<a download>`).
pub fn download_bytes(name: &str, mime: &str, bytes: &[u8]) -> Result<(), String> {
    let arr = js_sys::Uint8Array::from(bytes);
    let parts = js_sys::Array::of1(&arr);
    let opts = web_sys::BlobPropertyBag::new();
    opts.set_type(mime);
    let blob = web_sys::Blob::new_with_u8_array_sequence_and_options(&parts, &opts)
        .map_err(|e| format!("{e:?}"))?;
    let url = web_sys::Url::create_object_url_with_blob(&blob).map_err(|e| format!("{e:?}"))?;
    let doc = web_sys::window()
        .and_then(|w| w.document())
        .ok_or("no document")?;
    let a: web_sys::HtmlAnchorElement = doc
        .create_element("a")
        .map_err(|e| format!("{e:?}"))?
        .unchecked_into();
    a.set_href(&url);
    a.set_download(name);
    a.click();
    let _ = web_sys::Url::revoke_object_url(&url);
    Ok(())
}

/// A dropped or picked file, read whole.
pub struct LocalFile {
    pub name: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}

/// Reads every file of a drop.
pub async fn dropped_files(dt: web_sys::DataTransfer) -> Vec<LocalFile> {
    let mut out = Vec::new();
    let Some(list) = dt.files() else { return out };
    for i in 0..list.length() {
        let Some(f) = list.get(i) else { continue };
        let Ok(buf) = wasm_bindgen_futures::JsFuture::from(f.array_buffer()).await else {
            continue;
        };
        out.push(LocalFile {
            name: f.name(),
            mime: f.type_(),
            bytes: js_sys::Uint8Array::new(&buf).to_vec(),
        });
    }
    out
}

/// A host path as typed into a shell (ui-next `terminalDrop.ts`).
pub fn shell_path(path: &str) -> String {
    let safe = !path.is_empty()
        && path
            .chars()
            .all(|c| c.is_alphanumeric() || "_@%+=:,./\\-".contains(c));
    if safe {
        return path.to_owned();
    }
    let b = path.as_bytes();
    let windows = (b.len() > 2 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'\\')
        || path.starts_with("\\\\");
    if windows {
        return format!("\"{}\"", path.replace('"', "\"\""));
    }
    format!("'{}'", path.replace('\'', "'\\''"))
}

/// What a drop types into the terminal: the paths, space separated, with a trailing space.
pub fn dropped_paths(paths: &[String]) -> String {
    if paths.is_empty() {
        return String::new();
    }
    let joined: Vec<String> = paths.iter().map(|p| shell_path(p)).collect();
    format!("{} ", joined.join(" "))
}

/// "3 files" / "1 file".
pub fn plural(n: usize, one: &str) -> String {
    format!("{n} {one}{}", if n == 1 { "" } else { "s" })
}

/// Bytes as `12 KB`.
pub fn human_size(n: u64) -> String {
    const U: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut v = n as f64;
    let mut i = 0;
    while v >= 1024.0 && i < U.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{n} B")
    } else {
        format!("{v:.1} {}", U[i])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_paths_like_a_terminal() {
        assert_eq!(shell_path("/tmp/a.png"), "/tmp/a.png");
        assert_eq!(shell_path("/tmp/a b.png"), "'/tmp/a b.png'");
        assert_eq!(shell_path("/tmp/it's"), "'/tmp/it'\\''s'");
        assert_eq!(shell_path("C:\\a b"), "\"C:\\a b\"");
        assert_eq!(dropped_paths(&["/a".into(), "/b c".into()]), "/a '/b c' ");
        assert_eq!(dropped_paths(&[]), "");
    }

    #[test]
    fn sizes() {
        assert_eq!(human_size(12), "12 B");
        assert_eq!(human_size(2048), "2.0 KB");
    }
}

/// The shared sheet (it portals itself to `<body>`).
pub use crate::components::Sheet;

/// "3m", "2h", "5d" since an ISO time (ui-next `util.ts` `ago`).
pub fn ago(iso: &str) -> String {
    let then = js_sys::Date::parse(iso);
    if !then.is_finite() {
        return String::new();
    }
    let s = ((js_sys::Date::now() - then) / 1000.0).max(0.0) as u64;
    if s < 60 {
        "now".into()
    } else if s < 3600 {
        format!("{}m", s / 60)
    } else if s < 86_400 {
        format!("{}h", s / 3600)
    } else if s < 2_592_000 {
        format!("{}d", s / 86_400)
    } else {
        format!("{}mo", s / 2_592_000)
    }
}
