//! A tool call row (ui-next `ToolCall.tsx`): icon, verb, argument and meta on one line; opens to
//! its pane (command output, the file read, the edit's diff, search hits, a fetched page, a plan,
//! a subagent's log). Running calls carry a beam; a live settle draws the tick and sweeps once.

use frogg_render::markdown::{HostImage, ImageRoot, MAX_IMAGE_BYTES};
use frogg_render::{diff_texts, parse_unified, Code, DiffView, Markdown};
use leptos::prelude::*;
use serde_json::Value;

use super::item::on_link;
use super::subwork::{SpawnedElapsed, SpawnedLink};
use crate::components::{Ico, Icon, StatusGlyph};
use crate::state::timeline::Entry;
use crate::state::Bucket;

/// Expanded output taller than this (px) is clamped behind "Show more".
const BODY_CAP: u32 = 320;
const PRE_MAX_CHARS: usize = 12_000;
const SWEEP_MS: u64 = 460;

fn s<'a>(d: &'a Value, k: &str) -> Option<&'a str> {
    d.get(k).and_then(Value::as_str)
}

fn n(d: &Value, k: &str) -> Option<i64> {
    d.get(k).and_then(Value::as_i64)
}

fn short(p: &str) -> String {
    let parts: Vec<&str> = p.rsplit('/').take(2).collect();
    parts.into_iter().rev().collect::<Vec<_>>().join("/")
}

/// Icon, verb, one-line argument and meta of the collapsed row.
pub struct Summary {
    pub ico: Ico,
    pub verb: String,
    pub arg: String,
    pub meta: Option<String>,
}

pub fn summary(name: &str, d: &Value) -> Summary {
    let sum = |ico, verb: &str, arg: String, meta: Option<String>| Summary {
        ico,
        verb: verb.to_owned(),
        arg,
        meta,
    };
    match s(d, "type").unwrap_or("") {
        "shell" => sum(
            Ico::SquareTerminal,
            "Run",
            s(d, "command").unwrap_or("").to_owned(),
            n(d, "exitCode")
                .filter(|c| *c != 0)
                .map(|c| format!("exit {c}")),
        ),
        "read" => sum(
            Ico::FileText,
            "Read",
            short(s(d, "filePath").unwrap_or("")),
            n(d, "limit").map(|l| format!("{l} lines")),
        ),
        "edit" => {
            let diff = s(d, "unifiedDiff").unwrap_or("");
            let add = diff
                .lines()
                .filter(|l| l.starts_with('+') && !l.starts_with("+++"))
                .count();
            let del = diff
                .lines()
                .filter(|l| l.starts_with('-') && !l.starts_with("---"))
                .count();
            sum(
                Ico::FilePen,
                "Edit",
                short(s(d, "filePath").unwrap_or("")),
                (!diff.is_empty()).then(|| format!("+{add} -{del}")),
            )
        }
        "write" => sum(
            Ico::FilePlus,
            "Write",
            short(s(d, "filePath").unwrap_or("")),
            None,
        ),
        "search" => {
            let verb = match s(d, "toolName") {
                Some("web_search") => "Web search",
                Some("glob") => "Glob",
                _ => "Grep",
            };
            let meta = n(d, "numMatches")
                .map(|m| format!("{m} hits"))
                .or_else(|| n(d, "numFiles").map(|f| format!("{f} files")));
            sum(
                Ico::Search,
                verb,
                format!("\"{}\"", s(d, "query").unwrap_or("")),
                meta,
            )
        }
        "fetch" => sum(
            Ico::Globe,
            "Fetch",
            s(d, "url").unwrap_or("").to_owned(),
            n(d, "code").map(|c| c.to_string()),
        ),
        "sub_agent" => Summary {
            ico: Ico::Bot,
            verb: s(d, "subAgentType").unwrap_or("Subagent").to_owned(),
            arg: s(d, "description").unwrap_or("").to_owned(),
            meta: d
                .get("actions")
                .and_then(Value::as_array)
                .map(|a| format!("{} steps", a.len())),
        },
        "plan" => sum(
            Ico::ListChecks,
            "Plan",
            s(d, "text")
                .unwrap_or("")
                .lines()
                .next()
                .unwrap_or("")
                .to_owned(),
            None,
        ),
        "plain_text" => Summary {
            ico: Ico::Wrench,
            verb: s(d, "label").unwrap_or(name).to_owned(),
            arg: s(d, "text")
                .unwrap_or("")
                .lines()
                .next()
                .unwrap_or("")
                .to_owned(),
            meta: None,
        },
        "worktree_setup" => sum(
            Ico::SquareTerminal,
            "Set up worktree",
            s(d, "branchName").unwrap_or("").to_owned(),
            d.get("commands")
                .and_then(Value::as_array)
                .map(|c| format!("{} commands", c.len())),
        ),
        _ => sum(Ico::Wrench, name, String::new(), None),
    }
}

/// Makes host files in markdown and image tool rows load through `host`'s daemon, relative paths
/// from the session's `cwd` (ui-next `ImageRoot`). Call once in the chat pane.
pub fn provide_image_root(host: String, cwd: Signal<Option<String>>) {
    let scope = host.clone();
    ImageRoot::provide(
        cwd,
        Signal::derive(move || scope.clone()),
        move |cwd, path| {
            let c = crate::state::get().conn.client_of(&host);
            Box::pin(async move {
                let c = c.ok_or_else(|| "Not connected".to_owned())?;
                let r = c
                    .read_file(&cwd, &path, Some(MAX_IMAGE_BYTES as u64))
                    .await
                    .map_err(|e| e.to_string())?;
                if r.size > MAX_IMAGE_BYTES as u64 {
                    return Err("Image too large to preview".into());
                }
                Ok((r.mime, r.bytes))
            })
        },
    );
}

/// A picture the agent looked at shows as the picture, not its bytes.
fn is_image_file(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]
        .iter()
        .any(|e| lower.ends_with(e))
}

fn pre(text: &str) -> AnyView {
    let text = if text.len() > PRE_MAX_CHARS {
        let mut cut = PRE_MAX_CHARS;
        while !text.is_char_boundary(cut) {
            cut -= 1;
        }
        format!("{}\n…", &text[..cut])
    } else {
        text.to_owned()
    };
    view! { <pre class="tool-pre">{text}</pre> }.into_any()
}

fn code(text: &str, file: &str) -> AnyView {
    let text = text.to_owned();
    let file = file.to_owned();
    view! { <div class="tool-code"><Code code=text lang=file /></div> }.into_any()
}

fn markdown(text: &str) -> AnyView {
    let text = text.to_owned();
    view! { <div class="tool-pad"><Markdown text=text on_link=on_link() /></div> }.into_any()
}

/// The expanded pane for one tool detail.
pub fn body(d: &Value) -> AnyView {
    let path = s(d, "filePath").unwrap_or("");
    match s(d, "type").unwrap_or("") {
        "shell" => match s(d, "output").filter(|o| !o.is_empty()) {
            Some(o) => view! {
                <div class="tool-shell">
                    <div class="tool-cmd t-mono">
                        <span class="cyan2">"$ "</span>{s(d, "command").unwrap_or("").to_owned()}
                    </div>
                    {pre(o)}
                </div>
            }
            .into_any(),
            None => ().into_any(),
        },
        "read" if is_image_file(path) => {
            let src = path.to_owned();
            view! { <div class="tool-pad tool-img"><HostImage src=src alt="" /></div> }.into_any()
        }
        "read" | "write" => s(d, "content")
            .map(|c| code(c, path))
            .unwrap_or_else(|| ().into_any()),
        "edit" => {
            let files = match (
                s(d, "unifiedDiff").filter(|u| !u.is_empty()),
                s(d, "oldString"),
                s(d, "newString"),
            ) {
                (Some(u), _, _) => parse_unified(u),
                (None, Some(o), Some(nw)) => vec![diff_texts(o, nw, path, 3)],
                (None, None, Some(nw)) => return code(nw, path),
                _ => return ().into_any(),
            };
            view! { <div class="tool-diff"><DiffView files=files no_headers=true /></div> }
                .into_any()
        }
        "search" => {
            if let Some(c) = s(d, "content").filter(|c| !c.is_empty()) {
                return pre(c);
            }
            if let Some(web) = d.get("webResults").and_then(Value::as_array) {
                let md = web
                    .iter()
                    .map(|r| {
                        format!(
                            "- [{}]({})",
                            s(r, "title").unwrap_or(""),
                            s(r, "url").unwrap_or("")
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                if !md.is_empty() {
                    return markdown(&md);
                }
            }
            let paths: Vec<&str> = d
                .get("filePaths")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .collect();
            if paths.is_empty() {
                ().into_any()
            } else {
                pre(&paths.join("\n"))
            }
        }
        "fetch" => s(d, "result")
            .map(|r| markdown(&r.chars().take(4000).collect::<String>()))
            .unwrap_or_else(|| ().into_any()),
        "plan" => markdown(s(d, "text").unwrap_or("")),
        "sub_agent" => s(d, "log")
            .filter(|l| !l.is_empty())
            .map(pre)
            .unwrap_or_else(|| ().into_any()),
        "plain_text" => s(d, "text")
            .filter(|l| !l.is_empty())
            .map(pre)
            .unwrap_or_else(|| ().into_any()),
        "worktree_setup" => pre(s(d, "log").unwrap_or("")),
        "unknown" => {
            let v = serde_json::json!({ "input": d.get("input"), "output": d.get("output") });
            pre(&serde_json::to_string_pretty(&v).unwrap_or_default())
        }
        _ => ().into_any(),
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Settle {
    None,
    Done,
    Failed,
}

#[component]
pub fn ToolCall(entry: ArcRwSignal<Entry>) -> impl IntoView {
    let open = RwSignal::new(false);
    let e = entry.clone();
    let status = Memo::new(move |_| e.with(|e| e.str("status").unwrap_or("running").to_owned()));
    let e = entry.clone();
    let head = Memo::new(move |_| {
        e.with(|e| {
            let d = e.item.get("detail").cloned().unwrap_or(Value::Null);
            let sm = summary(e.str("name").unwrap_or("tool"), &d);
            (sm.ico, sm.verb, sm.arg, sm.meta)
        })
    });
    let e = entry.clone();
    let child = Memo::new(move |_| {
        e.with(|e| {
            e.item
                .get("detail")
                .filter(|d| s(d, "type") == Some("sub_agent"))
                .and_then(|d| s(d, "childSessionId"))
                .map(str::to_owned)
        })
    });
    // A subagent call links to its live sub-work row (ticking run time, "Open subagent").
    let e = entry.clone();
    let sub_call = Memo::new(move |_| {
        e.with(|e| {
            e.item
                .get("detail")
                .filter(|d| s(d, "type") == Some("sub_agent"))
                .and_then(|_| e.str("callId"))
                .map(str::to_owned)
        })
    });
    // Plays once on a live running → completed/failed transition, never on mount.
    let settle = RwSignal::new(Settle::None);
    Effect::new(move |prev: Option<String>| {
        let now = status.get();
        if prev.as_deref() == Some("running") && (now == "completed" || now == "failed") {
            settle.set(if now == "failed" {
                Settle::Failed
            } else {
                Settle::Done
            });
            set_timeout(
                move || settle.set(Settle::None),
                std::time::Duration::from_millis(SWEEP_MS),
            );
        }
        now
    });
    let failed = move || status.get() == "failed";
    let running = move || status.get() == "running";
    let box_class = move || {
        format!(
            "tool m-enter{}{}{}",
            if failed() { " failed" } else { "" },
            match settle.get() {
                Settle::Done => " settle-done",
                Settle::Failed => " settle-fail",
                Settle::None => "",
            },
            if open.get() { " open" } else { "" },
        )
    };
    // The pane rebuilds only when the detail or error changes, not on every streamed update.
    let e = entry.clone();
    let detail =
        Memo::new(move |_| e.with(|e| e.item.get("detail").cloned().unwrap_or(Value::Null)));
    let e = entry.clone();
    let error = Memo::new(move |_| {
        e.with(|e| {
            (e.str("status") == Some("failed"))
                .then(|| e.item.get("error").cloned())
                .flatten()
                .filter(|x| !x.is_null())
                .map(|x| match x {
                    Value::String(s) => s,
                    other => other.to_string(),
                })
        })
    });
    let pane = move || {
        view! {
            {move || error.get().map(|m| view! { <div class="tool-err t-mono">{m}</div> })}
            <Clamp>{move || detail.with(body)}</Clamp>
        }
    };
    let ui = crate::state::get().ui;
    view! {
        <div class=box_class>
            <Show when=running>
                <span class="tool-beam"></span>
            </Show>
            <span class="tool-sweep"></span>
            <button
                class="tool-row"
                aria-expanded=move || open.get().to_string()
                on:click=move |_| open.update(|o| *o = !*o)
            >
                <Icon ico=Signal::derive(move || head.get().0) size=14.0 class="tool-ico" />
                <span class="tool-verb">{move || head.get().1}</span>
                <span class="tool-arg">{move || head.get().2}</span>
                {move || head.get().3.map(|m| view! { <span class="tool-meta t-mono">{m}</span> })}
                {move || sub_call.get().map(|c| view! { <SpawnedElapsed call_id=c /> })}
                {move || {
                    if running() {
                        view! { <StatusGlyph bucket=Bucket::Working size=7.0 /> }.into_any()
                    } else {
                        let live = settle.get() != Settle::None;
                        view! {
                            <span class="tool-done" class:live=live class:fail=failed()>
                                <Icon
                                    ico=if failed() { Ico::X } else { Ico::Check }
                                    size=13.0
                                    stroke=2.0
                                />
                            </span>
                        }
                        .into_any()
                    }
                }}
                <Icon ico=Ico::ChevronRight size=13.0 class="tool-chev" />
            </button>
            <Show when=move || open.get()>
                <div class="tool-body">
                    {pane}
                    {move || sub_call.get().map(|c| view! { <SpawnedLink call_id=c /> })}
                    {move || child.get().map(|id| view! {
                        <button class="tool-link" on:click=move |_| ui.select(Some(id.clone()))>
                            <Icon ico=Ico::ArrowUpRight size=12.0 />
                            "Open the subagent's session"
                        </button>
                    })}
                </div>
            </Show>
        </div>
    }
}

/// Content only this much taller than the cap shows in full: a toggle for a few lines is noise.
const CLAMP_SLACK: i32 = 64;

/// A see more / see less glide: quick for short reveals, capped for huge ones.
fn clamp_ms(dist: i32) -> i32 {
    (200.0 + f64::from(dist.abs()) / 8.0).min(420.0).round() as i32
}

/// Caps tall content at `BODY_CAP` with a fade and a "Show more" bar (ui-next `chat/Clamp.tsx`).
/// The height glides open to the full content and back; a ResizeObserver remeasures as the
/// content grows (streamed output, images loading). Content that fits renders as is.
#[component]
pub fn Clamp(children: Children) -> impl IntoView {
    use wasm_bindgen::closure::Closure;
    use wasm_bindgen::JsCast;
    let cap = BODY_CAP as i32;
    let open = RwSignal::new(false);
    let full = RwSignal::new(0i32);
    // Animate only after the first measure: the initial layout is instant.
    let placed = RwSignal::new(false);
    let el = NodeRef::<leptos::html::Div>::new();
    let observer = StoredValue::new_local(None::<(web_sys::ResizeObserver, Closure<dyn FnMut()>)>);
    Effect::new(move |_| {
        let Some(d) = el.get() else { return };
        let d2 = d.clone();
        let cb = Closure::<dyn FnMut()>::new(move || {
            let h = d2.offset_height();
            if full.try_get_untracked() != Some(h) {
                let _ = full.try_set(h);
            }
        });
        if let Ok(ro) = web_sys::ResizeObserver::new(cb.as_ref().unchecked_ref()) {
            ro.observe(&d);
            observer.set_value(Some((ro, cb)));
        }
        full.set(d.offset_height());
        request_animation_frame(move || {
            let _ = placed.try_set(true);
        });
    });
    on_cleanup(move || {
        if let Some((ro, _)) = observer.try_update_value(Option::take).flatten() {
            ro.disconnect();
        }
    });
    let clamps = move || full.get() > cap + CLAMP_SLACK;
    let style = move || {
        let f = full.get();
        if !clamps() {
            return "height:auto".to_owned();
        }
        let to = if open.get() { f } else { cap };
        if placed.get() {
            format!(
                "height:{to}px;transition:height {ms}ms var(--ease)",
                ms = clamp_ms(f - cap)
            )
        } else {
            format!("height:{to}px")
        }
    };
    view! {
        <div class="clamp" class:open=move || open.get()>
            <div class="clamp-clip" style=style>
                <div class="clamp-inner" node_ref=el>{children()}</div>
                <Show when=clamps>
                    <div class="clamp-veil" aria-hidden="true"></div>
                </Show>
            </div>
            <Show when=clamps>
                <button
                    class="clamp-more"
                    aria-expanded=move || open.get().to_string()
                    on:click=move |_| open.update(|m| *m = !*m)
                >
                    <Icon ico=Ico::ChevronDown size=13.0 class="clamp-chev" />
                    <span>{move || if open.get() { "Show less" } else { "Show more" }}</span>
                </button>
            </Show>
        </div>
    }
}
