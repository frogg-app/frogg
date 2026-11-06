//! "Voice & Companion" (ui-next `settings/pages/VoiceCompanion.tsx`): device voice prefs plus the
//! host's Companion model (`config.json` `companionModel`) and its plugin install.

use leptos::prelude::*;
use leptos::task::spawn_local;
use serde_json::{json, Value};

use crate::components::{Button, Select, SelectOption};
use crate::state::config::{self, s};
use crate::state::Conn;
use crate::views::settings::kit::*;

const LENGTH: &[(&str, &str)] = &[("brief", "Brief"), ("detailed", "Detailed")];
const UPDATES: &[(&str, &str)] = &[
    ("both", "Completions and failures"),
    ("completions", "Completions"),
    ("off", "Off"),
];
const AUDIO: &[(&str, &str)] = &[("call", "Call"), ("media", "Media")];
const PAUSE: &[(&str, &str)] = &[
    ("quick", "Quick"),
    ("natural", "Natural"),
    ("relaxed", "Relaxed"),
];
const BARGE: &[(&str, &str)] = &[
    ("instant", "Instantly"),
    ("short", "Short"),
    ("deliberate", "Deliberate"),
];
const DEFAULT: &str = "__default__";

/// A value from the active host's `server_info` payload by JSON pointer. Reactive on the link.
fn server_info(pointer: &str) -> Option<Value> {
    let app = crate::state::get();
    if app.conn.active_link().conn != Conn::Online {
        return None;
    }
    app.conn
        .client()
        .and_then(|c| c.server_info())
        .and_then(|i| i.raw.pointer(pointer).cloned())
}

/// The Companion plugin the host is missing (`capabilities.companion.plugin`), as (id, repoUrl).
fn missing_plugin() -> Option<(String, String)> {
    let p = server_info("/capabilities/companion/plugin").filter(Value::is_object)?;
    Some((s(&p, "id"), s(&p, "repoUrl")))
}

async fn install_plugin() -> Result<(), String> {
    let Some((id, repo)) = untrack(missing_plugin) else {
        return Ok(());
    };
    config::need()?
        .plugins_install(&id, &repo, &[], None)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// "Default" plus the selectable models of the Companion's backend provider, keeping an unlisted
/// current model visible.
fn model_options(current: Option<&str>) -> Vec<SelectOption> {
    let cfg = config::get();
    let details = server_info("/capabilities/companionDetails");
    let backend = details
        .as_ref()
        .map(|d| s(d, "backend"))
        .unwrap_or_default();
    let provider = if backend == "codex" {
        "codex"
    } else {
        "claude"
    };
    let mut models: Vec<SelectOption> = cfg.providers.with(|p| {
        p.as_ref()
            .and_then(|p| p.get("entries"))
            .and_then(Value::as_array)
            .and_then(|es| es.iter().find(|e| s(e, "provider") == provider))
            .and_then(|e| e.get("models"))
            .and_then(Value::as_array)
            .map(|ms| {
                ms.iter()
                    .filter(|m| m.get("isSelectable") != Some(&Value::Bool(false)))
                    .map(|m| SelectOption::new(s(m, "id"), s(m, "label")))
                    .collect()
            })
            .unwrap_or_default()
    });
    if let Some(c) = current {
        if !models.iter().any(|m| m.value == c) {
            models.insert(0, SelectOption::new(c, c));
        }
    }
    let fallback = match details.as_ref().map(|d| s(d, "model")) {
        Some(m) if !m.is_empty() => format!("Default ({m})"),
        _ => "Default".to_owned(),
    };
    let mut out = vec![SelectOption::new(DEFAULT, fallback)];
    out.extend(models);
    out
}

#[component]
fn ModelPicker() -> impl IntoView {
    let cfg = config::get();
    move || {
        // COMPAT: older daemons do not report companionModel (absent, not null).
        let Some(current) = cfg
            .config
            .with(|c| c.as_ref()?.get("companionModel").cloned())
        else {
            return view! { <Pill text="needs a newer daemon" /> }.into_any();
        };
        let current = current.as_str().map(str::to_owned);
        let options = model_options(current.as_deref());
        let value = current.unwrap_or_else(|| DEFAULT.to_owned());
        view! {
            <div class="set-sel" style="width:220px">
                <Select
                    options=options
                    value=value
                    on_change=Callback::new(move |v: String| {
                        cfg.patch(json!({ "companionModel": if v == DEFAULT { Value::Null } else { Value::String(v) } }))
                    })
                />
            </div>
        }
        .into_any()
    }
}

/// Offers the Companion plugin install while the host is missing it.
#[component]
fn CompanionPluginRow() -> impl IntoView {
    let busy = RwSignal::new(false);
    let error = RwSignal::new(None::<String>);
    let install = move |_| {
        busy.set(true);
        error.set(None);
        spawn_local(async move {
            if let Err(e) = install_plugin().await {
                error.set(Some(e));
            }
            busy.set(false);
        });
    };
    move || {
        missing_plugin().map(|_| {
            view! {
                <Row
                    label="Companion plugin required"
                    hint=Signal::derive(move || error.get().unwrap_or_else(|| "This host runs the Companion once its plugin is installed.".to_owned()))
                >
                    <Button
                        label=Signal::derive(move || if busy.get() { "Installing…".to_owned() } else { "Install".to_owned() })
                        disabled=busy
                        on_press=Callback::new(install)
                    />
                </Row>
            }
        })
    }
}

#[component]
pub fn VoiceCompanion() -> impl IntoView {
    let app = crate::state::get();
    let prefs = app.prefs;
    let on = Signal::derive(move || prefs.flag("companion"));
    // Turning the Companion on also installs its plugin on a host that is missing it.
    let set_companion = Callback::new(move |v: bool| {
        prefs.set("companion", v);
        if v {
            spawn_local(async move {
                let _ = install_plugin().await;
            });
        }
    });
    let speed = Signal::derive(move || {
        prefs
            .all
            .with(|m| m.get("voiceSpeed").and_then(Value::as_f64))
    });
    let set_speed = Callback::new(move |v: Option<f64>| prefs.set("voiceSpeed", v.unwrap_or(1.0)));
    let host_hint = Signal::derive(move || {
        format!(
            "{} config.json",
            app.conn
                .active_link()
                .server_name
                .unwrap_or_else(|| "host".to_owned())
        )
    });
    view! {
        <div class="set-eyebrow-row">
            <span class="set-eyebrow">"COMPANION"</span>
            <Pill text="preview" tint="amber" />
        </div>
        <Section title="">
            <Row label="Enable Companion" hint="Talk to your sessions hands-free">
                <Toggle value=on on_change=set_companion label="Enable Companion" />
            </Row>
            {move || on.get().then(|| view! { <CompanionPluginRow /> })}
            <Row label="Conversation model" hint=host_hint>
                <ModelPicker />
            </Row>
            <Row label="Reply length"><PrefSeg key="replyLength" options=LENGTH /></Row>
            <Row label="Spoken task updates"><PrefSeg key="spokenUpdates" options=UPDATES /></Row>
            <Row label="Acknowledge tasks before working"><PrefToggle key="acknowledge" /></Row>
            <Row label="Audio mode"><PrefSeg key="audioMode" options=AUDIO /></Row>
            <Row label="Voice speed">
                <NumField value=speed on_change=set_speed unit="×" min=0.5 max=2.0 step=0.1 />
            </Row>
            <Row label="Pause before replying"><PrefSeg key="pause" options=PAUSE /></Row>
            <Row label="Let me interrupt by speaking"><PrefSeg key="bargeIn" options=BARGE /></Row>
            <Row label="Animate voice graphics"><PrefToggle key="animateVoice" /></Row>
            <Row label="Show reply text"><PrefToggle key="showReplyText" /></Row>
            <Row label="Codex voice" hint="Experimental"><PrefToggle key="codexVoice" /></Row>
        </Section>
        <Section title="Spoken alerts">
            <Row label="Auto-play spoken alerts"><PrefToggle key="autoplayAlerts" /></Row>
            <Row label="Confirm voice replies" hint="Shows the transcript for 2 s before sending">
                <PrefToggle key="confirmReplies" />
            </Row>
        </Section>
    }
}
