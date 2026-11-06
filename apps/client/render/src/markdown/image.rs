//! Host-relative images (ui-next `markdown/HostImage.tsx`): URLs load directly; host files
//! (`file://`, absolute, `~/` or session-relative paths) are read through the daemon by the
//! loader an [`ImageRoot`] context supplies, so a remote host's screenshots render on any client.
//! A shimmer slot holds the place while loading, the picture fades in, and a failure names the
//! file.

use std::cell::RefCell;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;

use leptos::prelude::*;
use leptos::task::spawn_local;
use wasm_bindgen::JsCast;

use super::parse::{data_url, resolve_image, ImageSource};
use crate::icons::{ImageOffIcon, MaximizeIcon};

/// Largest host image read for a preview.
pub const MAX_IMAGE_BYTES: usize = 12 * 1024 * 1024;

/// A host file read: `(mime, bytes)` or an error message.
pub type ImageRead = Pin<Box<dyn Future<Output = Result<(String, Vec<u8>), String>>>>;
/// Reads `path` relative to `cwd` on the host.
pub type ImageLoader = Rc<dyn Fn(String, String) -> ImageRead>;

/// Where relative image paths resolve from (the session's working directory) and how host
/// files are read. Provide it with [`ImageRoot::provide`] above any [`Markdown`](super::Markdown)
/// or [`HostImage`]; without it only direct URLs load.
#[derive(Clone, Copy)]
pub struct ImageRoot {
    pub cwd: Signal<Option<String>>,
    /// Cache scope (the host id): reads are cached per scope and path for the connection.
    pub scope: Signal<String>,
    pub load: StoredValue<ImageLoader, LocalStorage>,
}

impl ImageRoot {
    pub fn provide(
        cwd: impl Into<Signal<Option<String>>>,
        scope: impl Into<Signal<String>>,
        load: impl Fn(String, String) -> ImageRead + 'static,
    ) {
        provide_context(ImageRoot {
            cwd: cwd.into(),
            scope: scope.into(),
            load: StoredValue::new_local(Rc::new(load) as ImageLoader),
        });
    }
}

thread_local! {
    /// Loaded data URLs by `scope\ncwd\npath`: a streamed reply re-renders its last block often.
    static CACHE: RefCell<HashMap<String, String>> = RefCell::new(HashMap::new());
}

/// Drops every cached host image (call on a host switch).
pub fn clear_image_cache() {
    CACHE.with(|c| c.borrow_mut().clear());
}

#[derive(Clone, Debug, PartialEq)]
enum State {
    Loading,
    Ready(String),
    Failed(String),
}

/// Checks a host read is a previewable image and turns it into a data URL.
pub fn image_data_url(mime: &str, bytes: &[u8]) -> Result<String, String> {
    if !mime.starts_with("image/") {
        return Err("Not an image".into());
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("Image too large to preview".into());
    }
    Ok(data_url(mime, bytes))
}

/// One markdown (or tool output) image.
#[component]
pub fn HostImage(#[prop(into)] src: String, #[prop(into)] alt: String) -> impl IntoView {
    let root = use_context::<ImageRoot>();
    let state = RwSignal::new(State::Loading);
    let gen = StoredValue::new(0u64);
    let src_for = src.clone();
    Effect::new(move |_| {
        let cwd = root.and_then(|r| r.cwd.get());
        let mine = gen.get_value() + 1;
        gen.set_value(mine);
        let target = resolve_image(&src_for, cwd.as_deref());
        let (cwd, path) = match target {
            None => return state.set(State::Failed("Unsupported image location".into())),
            Some(ImageSource::Uri(u)) => return state.set(State::Ready(u)),
            Some(ImageSource::Host { cwd, path }) => (cwd, path),
        };
        let Some(root) = root else {
            return state.set(State::Failed("Not connected".into()));
        };
        let key = format!("{}\n{cwd}\n{path}", root.scope.get_untracked());
        if let Some(u) = CACHE.with(|c| c.borrow().get(&key).cloned()) {
            return state.set(State::Ready(u));
        }
        state.set(State::Loading);
        let read = root.load.with_value(|l| l(cwd, path));
        spawn_local(async move {
            let res = read
                .await
                .and_then(|(mime, bytes)| image_data_url(&mime, &bytes));
            if gen.try_get_value() != Some(mine) {
                return;
            }
            match res {
                Ok(u) => {
                    CACHE.with(|c| c.borrow_mut().insert(key, u.clone()));
                    state.set(State::Ready(u));
                }
                // A failed read (offline, not yet written) retries on the next mount.
                Err(e) => state.set(State::Failed(e)),
            }
        });
    });
    let loaded = RwSignal::new(false);
    let enlarge = |ev: web_sys::MouseEvent| {
        // The lightbox listens for clicks on images: forward to the picture.
        let img = ev
            .current_target()
            .and_then(|t| t.dyn_into::<web_sys::Element>().ok())
            .and_then(|b| b.previous_element_sibling())
            .and_then(|i| i.dyn_into::<web_sys::HtmlElement>().ok());
        if let Some(img) = img {
            ev.stop_propagation();
            img.click();
        }
    };
    let label = if alt.is_empty() || alt == "Image" {
        "Image".to_owned()
    } else {
        alt.clone()
    };
    move || match state.get() {
        State::Loading => {
            view! { <span class="fr-md-img-slot" aria-label="Loading image"></span> }.into_any()
        }
        State::Ready(u) => view! {
            <span class="fr-md-pic" class:loaded=move || loaded.get()>
                <img
                    class="fr-md-img"
                    src=u
                    alt=alt.clone()
                    loading="lazy"
                    on:load=move |_| loaded.set(true)
                />
                <button
                    type="button"
                    class="fr-md-enlarge"
                    aria-label=format!("{label}, enlarge")
                    on:click=enlarge
                >
                    <MaximizeIcon />
                </button>
            </span>
        }
        .into_any(),
        State::Failed(why) => {
            let title = if alt.is_empty() || alt == "Image" {
                "Image could not be shown".to_owned()
            } else {
                alt.clone()
            };
            view! {
                <span class="fr-md-img-failed" role="img" aria-label=label.clone()>
                    <ImageOffIcon />
                    <span class="fr-md-img-failed-text">
                        <span class="fr-md-img-failed-title">
                            {title}<span class="fr-md-img-failed-why">{format!(" · {why}")}</span>
                        </span>
                        <span class="fr-md-img-failed-path">{src.clone()}</span>
                    </span>
                </span>
            }
            .into_any()
        }
    }
}
