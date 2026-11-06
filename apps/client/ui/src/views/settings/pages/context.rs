//! "Context & clean cut" (ui-next `settings/pages/ContextCleanCut.tsx`): the host's `cleanCut`
//! config (auto triggers, idle threshold, summary model, per-provider overrides) and the device's
//! stale cache warning.

use leptos::prelude::*;
use serde_json::{json, Map, Value};

use crate::components::{Button, ButtonKind, Select, SelectOption};
use crate::state::config::{self, s};
use crate::state::Conn;
use crate::views::settings::kit::*;

const AUTO: &str = "__auto__";
const MAX_MIN: f64 = 30.0 * 24.0 * 60.0;

fn model_key(m: Option<&Value>) -> String {
    match m.filter(|m| m.is_object()) {
        Some(m) => format!("{}/{}", s(m, "provider"), s(m, "model")),
        None => AUTO.to_owned(),
    }
}

fn parse_model(v: &str) -> Value {
    if v == AUTO {
        return Value::Null;
    }
    let (p, m) = v.split_once('/').unwrap_or((v, ""));
    json!({ "provider": p, "model": m })
}

fn provider_entries() -> Vec<Value> {
    config::get().providers.with(|p| {
        p.as_ref()
            .and_then(|p| p.get("entries"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    })
}

/// Summary model options: all providers' models, or one provider's when `provider` is set.
fn model_options(provider: Option<&str>) -> Vec<SelectOption> {
    let mut out = vec![SelectOption::new(
        AUTO,
        if provider.is_some() {
            "Use the global setting"
        } else {
            "Automatic (cheapest on same provider)"
        },
    )];
    for e in provider_entries() {
        let ep = s(&e, "provider");
        if provider.is_some_and(|p| p != ep) {
            continue;
        }
        for m in e
            .get("models")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if m.get("isSelectable") == Some(&Value::Bool(false)) {
                continue;
            }
            let label = if provider.is_some() {
                s(m, "label")
            } else {
                format!("{ep} · {}", s(m, "label"))
            };
            out.push(SelectOption::new(format!("{ep}/{}", s(m, "id")), label));
        }
    }
    out
}

fn model_label(opts: &[SelectOption], m: Option<&Value>) -> Option<String> {
    let m = m.filter(|m| m.is_object())?;
    let key = model_key(Some(m));
    Some(
        opts.iter()
            .find(|o| o.value == key)
            .map(|o| o.label.clone())
            .unwrap_or_else(|| s(m, "model")),
    )
}

fn num(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64)
}

/// Why the clean cut rows are missing: no host, a failed read, an old daemon, or still loading.
fn clean_cut_state(online: bool, loaded: bool, failed: bool) -> &'static str {
    if !online {
        "connect a host to edit"
    } else if loaded {
        "needs a newer daemon"
    } else if failed {
        "couldn't load"
    } else {
        "loading…"
    }
}

#[component]
fn Override(provider: String) -> impl IntoView {
    let cfg = config::get();
    let open = RwSignal::new(false);
    let provider = StoredValue::new(provider);
    let ptr = format!("/cleanCut/providers/{}", provider.get_value());
    let settings = Memo::new(move |_| cfg.at(&ptr).unwrap_or(Value::Null));
    let patch = move |fields: Value| {
        let mut prov = Map::new();
        prov.insert(provider.get_value(), fields);
        cfg.patch(json!({ "cleanCut": { "providers": prov } }));
    };
    let hint = Signal::derive(move || {
        let st = settings.get();
        let opts = model_options(Some(&provider.get_value()));
        let mut parts = Vec::new();
        if let Some(t) = num(st.get("idleThresholdMinutes")).filter(|t| *t > 0.0) {
            parts.push(format!("Threshold {t} min"));
        }
        if let Some(l) = model_label(&opts, st.get("summaryModel")) {
            parts.push(format!("summary {l}"));
        }
        if parts.is_empty() {
            "No overrides".to_owned()
        } else {
            parts.join(" · ")
        }
    });
    view! {
        <Row label=provider.get_value() hint=hint>
            <Button
                label=Signal::derive(move || if open.get() { "Done".to_owned() } else { "Edit".to_owned() })
                on_press=Callback::new(move |_| open.update(|o| *o = !*o))
            />
        </Row>
        {move || open.get().then(|| view! {
            <Block>
                <div class="set-edit">
                    <span class="set-edit-l">"Idle threshold"</span>
                    <NumField
                        value=Signal::derive(move || num(settings.get().get("idleThresholdMinutes")))
                        on_change=Callback::new(move |v: Option<f64>| patch(json!({ "idleThresholdMinutes": v })))
                        unit="min"
                        min=1.0
                        max=MAX_MIN
                        placeholder="global"
                    />
                </div>
                <div class="set-edit">
                    <span class="set-edit-l">"Summary model"</span>
                    <div class="set-sel" style="width:240px">
                        <Select
                            options=model_options(Some(&provider.get_value()))
                            value=Signal::derive(move || model_key(settings.get().get("summaryModel")))
                            on_change=Callback::new(move |v: String| patch(json!({ "summaryModel": parse_model(&v) })))
                        />
                    </div>
                </div>
                <Acts>
                    <Button
                        kind=ButtonKind::Danger
                        label="Remove override"
                        on_press=Callback::new(move |_| patch(Value::Null))
                    />
                </Acts>
            </Block>
        })}
    }
}

#[component]
fn AddOverride(taken: Vec<String>) -> impl IntoView {
    let cfg = config::get();
    let options: Vec<SelectOption> = untrack(provider_entries)
        .iter()
        .map(|e| s(e, "provider"))
        .filter(|p| !taken.contains(p))
        .map(|p| SelectOption::new(p.clone(), p))
        .collect();
    view! {
        <Row label="Add override">
            <div class="set-sel" style="width:160px">
                <Select
                    options=options
                    value=String::new()
                    placeholder="Add…"
                    on_change=Callback::new(move |p: String| {
                        let mut prov = Map::new();
                        prov.insert(p, json!({ "idleThresholdMinutes": 60 }));
                        cfg.patch(json!({ "cleanCut": { "providers": prov } }));
                    })
                />
            </div>
        </Row>
    }
}

#[component]
pub fn ContextCleanCut() -> impl IntoView {
    let app = crate::state::get();
    let cfg = config::get();
    let has_cc = Memo::new(move |_| cfg.at("/cleanCut").is_some_and(|v| v.is_object()));
    // Re-render the provider list only when its keys change, not on every value edit.
    let providers = Memo::new(move |_| {
        cfg.at("/cleanCut/providers")
            .and_then(|v| {
                v.as_object().map(|o| {
                    o.iter()
                        .filter(|(_, v)| !v.is_null())
                        .map(|(k, _)| k.clone())
                        .collect::<Vec<_>>()
                })
            })
            .unwrap_or_default()
    });
    let flag = move |p: &'static str| Signal::derive(move || cfg.flag(p).unwrap_or(false));
    let set = |f: fn(bool) -> Value| Callback::new(move |v: bool| config::get().patch(f(v)));
    let options = Memo::new(move |_| {
        cfg.providers.track();
        model_options(None)
    });
    view! {
        <Section title="Clean cut">
            {move || if has_cc.get() {
                view! {
                    <Row label="Before resuming after a usage limit">
                        <Toggle value=flag("/cleanCut/auto/usageLimit") on_change=set(|v| json!({ "cleanCut": { "auto": { "usageLimit": v } } })) />
                    </Row>
                    <Row label="Before resuming after a restart">
                        <Toggle value=flag("/cleanCut/auto/daemonRestart") on_change=set(|v| json!({ "cleanCut": { "auto": { "daemonRestart": v } } })) />
                    </Row>
                    <Row label="Idle threshold" hint="Empty uses the provider’s cache lifetime (1 h for Claude and Codex)">
                        <NumField
                            value=Signal::derive(move || num(cfg.at("/cleanCut/idleThresholdMinutes").as_ref()))
                            on_change=Callback::new(move |v: Option<f64>| cfg.patch(json!({ "cleanCut": { "idleThresholdMinutes": v } })))
                            unit="min"
                            min=1.0
                            max=MAX_MIN
                        />
                    </Row>
                    <Row label="Summary model">
                        {move || view! {
                            <div class="set-sel" style="width:280px">
                                <Select
                                    options=options.get()
                                    value=Signal::derive(move || model_key(cfg.at("/cleanCut/summaryModel").as_ref()))
                                    on_change=Callback::new(move |v: String| cfg.patch(json!({ "cleanCut": { "summaryModel": parse_model(&v) } })))
                                />
                            </div>
                        }}
                    </Row>
                }.into_any()
            } else {
                let online = app.conn.active_link().conn == Conn::Online;
                let loaded = cfg.config.with(Option::is_some);
                let failed = cfg.error.with(Option::is_some);
                view! {
                    <Row label="Clean cut settings">
                        <Pill text=clean_cut_state(online, loaded, failed) />
                    </Row>
                }.into_any()
            }}
        </Section>
        {move || has_cc.get().then(|| view! {
            <Section title="Per provider">
                {move || {
                    let list = providers.get();
                    view! {
                        {list.iter().cloned().map(|p| view! { <Override provider=p /> }).collect_view()}
                        {
                            cfg.providers.track();
                            view! { <AddOverride taken=list.clone() /> }
                        }
                    }
                }}
            </Section>
        })}
        <Section title="Stale cache warning">
            <Row
                label="Warn when sending re-bills cached context"
                hint="Shows “Cache expired: sending re-bills N tokens” with a Clean cut button"
            >
                <PrefToggle key="staleCacheWarning" />
            </Row>
        </Section>
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_keys_round_trip() {
        assert_eq!(model_key(None), AUTO);
        assert_eq!(model_key(Some(&Value::Null)), AUTO);
        let m = json!({ "provider": "claude", "model": "haiku/x" });
        let k = model_key(Some(&m));
        assert_eq!(k, "claude/haiku/x");
        assert_eq!(parse_model(&k), m);
        assert_eq!(parse_model(AUTO), Value::Null);
    }

    #[test]
    fn state_text() {
        assert_eq!(
            clean_cut_state(false, true, false),
            "connect a host to edit"
        );
        assert_eq!(clean_cut_state(true, true, false), "needs a newer daemon");
        assert_eq!(clean_cut_state(true, false, true), "couldn't load");
    }
}
