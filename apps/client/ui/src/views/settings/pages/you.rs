//! "You" pages: settings kept on this device (ui-next `Appearance.tsx`, `ChatComposer.tsx`,
//! `FilesEditor.tsx`, `Notifications.tsx`, `DesignOptions.tsx` and the shortcuts list).

use leptos::prelude::*;
use serde_json::{json, Value};

use crate::components::{Button, ButtonKind, Ico, Icon, Seg, Select, SelectOption};
use crate::state::look;
use crate::theme::themes::{find_theme, is_hex, OVERRIDABLE};
use crate::theme::{resolve, ThemeChoice};
use crate::views::settings::kit::*;

fn token_hint(key: &str) -> &'static str {
    match key {
        "bg" => "App background",
        "bg2" => "Sidebars and the rail",
        "panel" => "Panels and cards",
        "raise" => "Raised surfaces, inputs",
        "text" => "Primary text",
        "muted" => "Secondary text",
        "faint" => "Hints, placeholders",
        "cyan" => "Accent",
        "cyan2" => "Accent, light (links, focus)",
        "deep" => "Accent, deep (gradients)",
        "mint" => "Success, running",
        "violet" => "Secondary accent",
        "amber" => "Warning, needs you",
        "coral" => "Danger, failed",
        "onAccent" => "Text on accent fills",
        _ => "",
    }
}

#[component]
pub fn Appearance() -> impl IntoView {
    let app = crate::state::get();
    let prefs = app.prefs;
    view! {
        <ThemeSettings />
        <Section title="Look and feel">
            <Row label="Density" hint="Row height and padding in lists and panels">
                <Seg
                    options=opts(look::DENSITY)
                    value=Signal::derive(move || look::density(prefs))
                    on_change=Callback::new(move |v: String| prefs.set("density", v))
                />
            </Row>
            <Row label="Motion" hint="Rail indicator, bracket and panel transitions. Your system's reduced-motion setting always wins.">
                <Toggle
                    value=Signal::derive(move || look::motion(prefs))
                    on_change=Callback::new(move |v: bool| prefs.set("motion", v))
                    label="Motion"
                />
            </Row>
            <Row label="Interface font">
                <Seg
                    options=opts(look::FONT_BODY)
                    value=Signal::derive(move || look::font_body(prefs))
                    on_change=Callback::new(move |v: String| prefs.set("fontBody", v))
                />
            </Row>
            <Row label="Code font" hint="Transcripts, diffs, terminals and paths">
                <Seg
                    options=opts(look::FONT_MONO)
                    value=Signal::derive(move || look::font_mono(prefs))
                    on_change=Callback::new(move |v: String| prefs.set("fontMono", v))
                />
            </Row>
        </Section>
    }
}

/// Theme cards and per-token overrides. Themes switch live here (ui-next reloads).
#[component]
fn ThemeSettings() -> impl IntoView {
    let theme = crate::state::get().theme;
    let current = Memo::new(move |_| {
        let id = theme.choice.with(|c| c.id.clone());
        if id.is_empty() {
            "material".to_owned()
        } else {
            id
        }
    });
    let pick = move |id: &'static str| {
        let overrides = theme.choice.with_untracked(|c| c.overrides.clone());
        theme.set(ThemeChoice {
            id: id.to_owned(),
            overrides,
        });
    };
    let count = Memo::new(move |_| theme.choice.with(|c| c.overrides.len()));
    view! {
        <Section title="Theme">
            <div class="theme-cards">
                {move || theme
                    .list()
                    .into_iter()
                    .map(|t| {
                        let id = t.id;
                        let p = resolve(&ThemeChoice { id: id.to_owned(), ..Default::default() });
                        let c = |k: &str| p.get(k).to_owned();
                        let kw = t.syntax.iter().find(|(k, _)| *k == "keyword").map(|(_, v)| v.to_string()).unwrap_or_else(|| c("violet"));
                        let tok = |k: &str, d: &str| t.tokens.iter().find(|(n, _)| *n == k).map(|(_, v)| v.to_string()).unwrap_or_else(|| d.to_owned());
                        let r = tok("r-card", "0px");
                        // The card previews its own theme, so its colours are custom properties
                        // read by the `.mini*` rules rather than the active theme's.
                        let preview = format!(
                            "--m-bg:{};--m-bg2:{};--m-line:{};--m-panel:{};--m-text:{};--m-muted:{};--m-faint:{};--m-cyan:{};--m-mint:{};--m-amber:{};--m-coral:{};--m-kw:{kw};--m-r:{};--m-ri:{}",
                            c("bg"), c("bg2"), c("line"), c("panel"), c("text"), c("muted"), c("faint"), c("cyan"), c("mint"), c("amber"), c("coral"),
                            if r == "0px" { "0px".to_owned() } else { "8px".to_owned() },
                            if r == "0px" { "0px" } else { "2px" },
                        );
                        let on = move || current.get() == id;
                        view! {
                            <button
                                class="theme-card"
                                class:on=on
                                role="radio"
                                aria-checked=move || on().to_string()
                                aria-label=format!("{} theme", t.label)
                                on:click=move |_| pick(id)
                            >
                                <span class="mini" style=preview>
                                    <span class="mini-rail"><i></i><i></i><i></i></span>
                                    <span class="mini-body">
                                        <i class="mini-line"></i>
                                        <i class="mini-line"></i>
                                        <span class="mini-panel">
                                            <i class="mini-line"></i>
                                            <i class="mini-line"></i>
                                        </span>
                                        <span class="mini-foot"><i></i><i></i><i></i></span>
                                    </span>
                                </span>
                                <span class="theme-card-text">
                                    <span class="theme-card-t">{t.label}</span>
                                    {move || on().then(|| view! { <Icon ico=Ico::Check size=13.0 class="cyan2" /> })}
                                </span>
                                <span class="theme-card-d">{t.description}</span>
                            </button>
                        }
                    })
                    .collect_view()}
            </div>
        </Section>
        <Section title="Colour overrides">
            {OVERRIDABLE.iter().map(|k| view! { <TokenRow key=k /> }).collect_view()}
        </Section>
        <Note>
            "Overrides take a #rrggbb colour and sit on top of whichever theme is active; washes and hover tints follow the token they come from."
            {move || (count.get() > 0).then(|| format!(" {} set.", count.get()))}
        </Note>
        <Show when=move || count.get() != 0>
            <div class="set-acts end">
                <Button
                    label="Reset overrides"
                    on_press=Callback::new(move |_| {
                        let id = theme.choice.with_untracked(|c| c.id.clone());
                        theme.set(ThemeChoice { id, overrides: Default::default() });
                    })
                />
            </div>
        </Show>
    }
}

#[component]
fn TokenRow(key: &'static str) -> impl IntoView {
    let theme = crate::state::get().theme;
    let bad = RwSignal::new(false);
    let value = Memo::new(move |_| theme.choice.with(|c| resolve(c).get(key).to_owned()));
    let overridden = Memo::new(move |_| theme.choice.with(|c| c.overrides.contains_key(key)));
    let set = move |v: Option<String>| {
        let mut c = theme.choice.get_untracked();
        match v {
            Some(v) => c.overrides.insert(key.to_owned(), v),
            None => c.overrides.remove(key),
        };
        theme.set(c);
    };
    let change = Callback::new(move |v: String| {
        if v.is_empty() {
            bad.set(false);
            return set(None);
        }
        let hex = if v.starts_with('#') {
            v
        } else {
            format!("#{v}")
        };
        if is_hex(&hex) {
            bad.set(false);
            set(Some(hex.to_lowercase()));
        } else {
            bad.set(true);
        }
    });
    let _ = find_theme;
    view! {
        <Row
            label=key
            hint=Signal::derive(move || if bad.get() { "Use a #rrggbb colour.".to_owned() } else { token_hint(key).to_owned() })
            bad=bad
        >
            <span class="swatch" style=move || format!("background:{}", value.get())></span>
            <TextField
                value=Signal::derive(move || if overridden.get() { value.get() } else { String::new() })
                placeholder=Signal::derive(move || value.get())
                on_change=change
                width=92.0
                mono=true
            />
            <button
                class="icon-btn reset"
                class:off=move || !overridden.get()
                disabled=move || !overridden.get()
                aria-label=format!("Reset {key}")
                on:click=move |_| {
                    bad.set(false);
                    set(None);
                }
            >
                <Icon ico=Ico::RotateCcw size=12.0 />
            </button>
        </Row>
    }
}

#[component]
pub fn ChatComposer() -> impl IntoView {
    view! {
        <Section title="Sending">
            <Row label="While the agent is working, ⏎" hint=crate::state::kbd::kbd("⌘⏎") + " does the other one">
                <PrefSeg key="busyEnter" options=&[("steer", "Steer"), ("queue", "Queue"), ("interrupt", "Interrupt")] />
            </Row>
        </Section>
        <Section title="Transcript">
            <Row label="Tool calls"><PrefSeg key="toolCalls" options=&[("full", "Full detail"), ("summary", "Summary")] /></Row>
            <Row label="Expand reasoning"><PrefToggle key="expandReasoning" /></Row>
            <Row label="Chat outline" hint="Jump list of your messages at the right edge"><PrefToggle key="chatOutline" /></Row>
            <Row label="Open subagents"><PrefSeg key="subagents" options=&[("tab", "In a tab"), ("pane", "Side pane")] /></Row>
        </Section>
        <Section title="Links and files from chat">
            <Row label="Service URLs"><PrefSeg key="serviceUrls" options=&[("ask", "Ask"), ("frogg", "In Frogg"), ("external", "External browser")] /></Row>
            <Row label="Pull requests open in"><PrefSeg key="prLinks" options=&[("tool", "PRs & CI tool"), ("pane", "Side pane"), ("browser", "Browser")] /></Row>
            <Row label="Downloads"><PrefSeg key="downloads" options=&[("ask", "Ask every time"), ("folder", "Save to folder")] /></Row>
            <Row label="Show hidden folders in pickers"><PrefToggle key="hiddenFolders" /></Row>
        </Section>
        <Section title="Session list">
            <Row
                label="Order sessions by"
                hint="Attention first puts sessions that need you, failed or are ready above working and idle ones, in every grouping. Also in the list's filter menu."
            >
                <SortSeg />
            </Row>
        </Section>
    }
}

/// The session list's sort (shared with its filter menu; saved with the list's prefs).
#[component]
fn SortSeg() -> impl IntoView {
    let list = crate::state::sessions::get();
    view! {
        <Seg
            options=opts(&[("state", "Attention first"), ("recent", "Recent"), ("created", "Created"), ("title", "Title")])
            value=Signal::derive(move || list.prefs.with(|p| p.sort.clone()))
            on_change=Callback::new(move |v: String| list.prefs.update(|p| p.sort = v))
        />
    }
}

const WHERE: &[(&str, &str)] = &[("main", "Main area"), ("pane", "Side pane")];

#[component]
pub fn FilesEditor() -> impl IntoView {
    let prefs = crate::state::get().prefs;
    let editors = vec![
        SelectOption::new("vscode", "VS Code"),
        SelectOption::new("cursor", "Cursor"),
        SelectOption::new("zed", "Zed"),
        SelectOption::new("idea", "IntelliJ IDEA"),
        SelectOption::new("system", "System default"),
    ];
    view! {
        <Section title="Editor">
            <Row label="Vim keybindings"><PrefToggle key="vim" /></Row>
            <Row label="Open files from the explorer"><PrefSeg key="openFiles" options=WHERE /></Row>
            <Row
                label="Keep every opened file as a tab"
                hint="Off: a single click opens a preview tab (italic) that the next click replaces; edit it or double-click its tab to keep it"
            >
                <PrefToggle key="autoPinTabs" />
            </Row>
            <Row label="Open diffs"><PrefSeg key="openDiffs" options=WHERE /></Row>
            <Row label="Default external editor">
                <Select
                    options=editors
                    value=Signal::derive(move || prefs.text("externalEditor"))
                    on_change=Callback::new(move |v: String| prefs.set("externalEditor", v))
                />
            </Row>
        </Section>
        <Section title="Source control">
            <Row label="Branch graph column" hint="This branch's commits on their own lane, joining the base"><PrefToggle key="scmGraph" /></Row>
            <Row label="Commit hash column"><PrefToggle key="scmSha" /></Row>
            <Row label="Author column"><PrefToggle key="scmAuthor" /></Row>
            <Row label="Age column"><PrefToggle key="scmDate" /></Row>
            <Row label="Compact rows"><PrefToggle key="scmCompact" /></Row>
            <Row label="Show the base branch under the branch" hint="Its newest commits, to show where the branch forked"><PrefToggle key="scmBaseCommits" /></Row>
            <Row label="Stashes"><PrefToggle key="scmStashes" /></Row>
        </Section>
        <Section title="Terminal">
            <Row label="Scrollback" hint="0–1,000,000 lines">
                <NumField
                    value=Signal::derive(move || prefs.all.with(|m| m.get("scrollback").and_then(Value::as_f64)))
                    on_change=Callback::new(move |v: Option<f64>| prefs.set("scrollback", v.unwrap_or(10000.0) as u64))
                    unit="lines"
                    max=1_000_000.0
                    width=96.0
                />
            </Row>
            <Row label="Copy on select"><PrefToggle key="copyOnSelect" /></Row>
            <Row label="List terminals from every host" hint="Off: the Terminals panel lists only the active host's terminals"><PrefToggle key="terminalsAllHosts" /></Row>
            <Row label="Show terminals in the Sessions list" hint="Lists each host's terminals under its sessions, grouped by host, and hides the Terminals tool"><PrefToggle key="sessionsWithTerminals" /></Row>
            <Row label="Legacy renderer" hint="Use only if text renders incorrectly"><PrefToggle key="legacyRenderer" /></Row>
        </Section>
    }
}

const SHORTCUTS: &[(&str, &str)] = &[
    ("Command palette", "⌘K"),
    ("New session", "⌘N"),
    ("Approve permission", "A"),
    ("Deny permission", "Esc"),
    ("Next / previous session", "J / K"),
    ("Filter sessions", "/"),
    ("New terminal", "⌃`"),
];

#[component]
pub fn Shortcuts() -> impl IntoView {
    view! {
        <Section title="Global">
            {SHORTCUTS
                .iter()
                .map(|(label, k)| view! {
                    <Row label=*label><span class="kbd-chip t-mono">{crate::state::kbd::kbd(k)}</span></Row>
                })
                .collect_view()}
        </Section>
    }
}

const CHANNELS: &[(&str, &str)] = &[
    ("inbox", "Inbox"),
    ("desktop", "Desktop"),
    ("push", "Push"),
    ("spoken", "Spoken"),
    ("sound", "Sound"),
];

const KINDS: &[(&str, &str)] = &[
    ("needsYou", "Needs you (permission, question, plan)"),
    ("failed", "Failed (agent error, CI failed)"),
    ("finished", "Finished"),
    ("host", "Host storage & security"),
    ("updates", "Updates available"),
    ("plugins", "Plugin notifications"),
    ("pairing", "Pairing requests"),
];

#[component]
pub fn Notifications() -> impl IntoView {
    let prefs = crate::state::get().prefs;
    let keep = vec![
        SelectOption::new("7", "7 days"),
        SelectOption::new("30", "30 days"),
        SelectOption::new("90", "90 days"),
        SelectOption::new("forever", "Forever"),
    ];
    let deliver = move |kind: &str, ch: &str| {
        prefs.all.with(|m| {
            m.get("deliver")
                .and_then(|d| d.get(kind))
                .and_then(|r| r.get(ch))
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
    };
    let set_deliver = move |kind: &'static str, ch: &'static str, on: bool| {
        prefs.all.update(|m| {
            let d = m.entry("deliver").or_insert_with(|| json!({}));
            if !d.get(kind).is_some_and(Value::is_object) {
                d[kind] = json!({});
            }
            d[kind][ch] = json!(on);
        });
    };
    view! {
        <Section title="Inbox">
            <Row label="Keep notifications for" hint="Everything below lands in the Inbox first; toasts and OS alerts are copies">
                <Select
                    options=keep
                    value=Signal::derive(move || prefs.text("keepDays"))
                    on_change=Callback::new(move |v: String| prefs.set("keepDays", v))
                />
            </Row>
            <Row label="Badge the rail with">
                <PrefSeg key="railBadge" options=&[("attention", "Needs you + failures"), ("unread", "All unread"), ("none", "Nothing")] />
            </Row>
        </Section>
        <Section title="Toasts">
            <Row label="Show toasts for" hint="Hovering a toast holds it; every toast is also kept in the Inbox">
                <Seg
                    options=opts(&[("3", "3s"), ("5", "5s"), ("8", "8s"), ("15", "15s"), ("0", "Until dismissed")])
                    value=Signal::derive(move || (prefs.toast_ms() / 1000).to_string())
                    on_change=Callback::new(move |v: String| prefs.set("toastSeconds", v.parse::<u32>().unwrap_or(5)))
                />
            </Row>
        </Section>
        <Section title="Deliver by type">
            <div class="set-table-wrap">
                <table class="set-table">
                    <thead>
                        <tr>
                            <th></th>
                            {CHANNELS.iter().map(|(_, l)| view! { <th class="t-label">{*l}</th> }).collect_view()}
                        </tr>
                    </thead>
                    <tbody>
                        {KINDS
                            .iter()
                            .map(|(k, label)| view! {
                                <tr>
                                    <td class="set-table-name">{*label}</td>
                                    {CHANNELS
                                        .iter()
                                        .map(|(c, cl)| view! {
                                            <td class="set-table-cell">
                                                <Toggle
                                                    value=Signal::derive(move || deliver(k, c))
                                                    on_change=Callback::new(move |v: bool| set_deliver(k, c, v))
                                                    label=format!("{label}: {cl}")
                                                />
                                            </td>
                                        })
                                        .collect_view()}
                                </tr>
                            })
                            .collect_view()}
                    </tbody>
                </table>
            </div>
        </Section>
        <Section title="This device">
            <Row label="OS notifications" hint="Desktop and push alerts while Frogg isn't focused">
                <NotifyPermission />
            </Row>
            <Row label="Play sound"><PrefToggle key="playSound" /></Row>
            <Row label="Quiet hours" hint="Hold desktop and push; Inbox still records">
                <TextField
                    value=Signal::derive(move || prefs.text("quietFrom"))
                    on_change=Callback::new(move |v: String| prefs.set("quietFrom", v))
                    width=70.0
                    mono=true
                />
                <span class="faint">"–"</span>
                <TextField
                    value=Signal::derive(move || prefs.text("quietTo"))
                    on_change=Callback::new(move |v: String| prefs.set("quietTo", v))
                    width=70.0
                    mono=true
                />
            </Row>
        </Section>
    }
}

/// Whether OS notifications are allowed on this device, with a button to ask.
#[component]
fn NotifyPermission() -> impl IntoView {
    let allowed = RwSignal::new(None::<bool>);
    let check = move || {
        leptos::task::spawn_local(async move {
            allowed.set(Some(crate::native::notify_permission().await));
        });
    };
    // The web reads the state without prompting; the shell asks the OS when undecided.
    if crate::native::is_tauri() {
        check();
    } else {
        allowed.set(Some(
            web_sys::Notification::permission() == web_sys::NotificationPermission::Granted,
        ));
    }
    move || {
        match allowed.get() {
        Some(true) => view! { <Pill text="allowed" tint="mint" /> }.into_any(),
        _ => view! { <Button label="Allow notifications" on_press=Callback::new(move |_| check()) /> }
            .into_any(),
    }
    }
}

/// A live sample of what a design pick changes (ui-next `DesignOptions.tsx` previews), for
/// the picks whose components live here; the rest show in the app as you change them.
fn design_preview(key: &str) -> Option<AnyView> {
    use crate::shell::toast::{Toast, ToastKind};
    let app = crate::state::get();
    let prefs = app.prefs;
    match key {
        "buttonStyle" => Some(
            view! {
                <Button kind=ButtonKind::Primary label="Create session" icon=Ico::Plus />
                <Button kind=ButtonKind::Primary label="Approve" kbd="⌘↵" />
                <Button label="Cancel" />
                <Button kind=ButtonKind::Danger label="Deny" />
                <Button label="Refresh" icon=Ico::RefreshCw />
            }
            .into_any(),
        ),
        "logoMotion" => Some(
            view! {
                <crate::components::Logo size=48.0 motion=Signal::derive(move || prefs.text("logoMotion")) />
                <crate::components::Logo size=26.0 motion=Signal::derive(move || prefs.text("logoMotion")) />
                <span class="faint">"Hover or click the gems."</span>
            }
            .into_any(),
        ),
        "toastStyle" => Some(
            view! {
                <Button label="Show done" on_press=Callback::new(move |_| {
                    app.toasts.push(Toast::new(ToastKind::Done, "Fix flaky session list finished").detail("Ready to review"));
                }) />
                <Button label="Needs you" on_press=Callback::new(move |_| {
                    app.toasts.push(Toast::new(ToastKind::Needs, "Release notes needs you"));
                }) />
                <Button label="Error" on_press=Callback::new(move |_| {
                    app.toasts.push(Toast::new(ToastKind::Error, "Agent crashed").detail("exit code 137 while running npm test"));
                }) />
            }
            .into_any(),
        ),
        "shapeLang" => Some(view! { <super::design_previews::ShapePreview /> }.into_any()),
        "stateStyle" => Some(view! { <super::design_previews::StateCards /> }.into_any()),
        "subworkStyle" => Some(view! { <super::design_previews::SubWorkPreview /> }.into_any()),
        "textReveal" => Some(view! { <super::design_previews::StreamPreview /> }.into_any()),
        "headingReveal" => Some(view! { <super::design_previews::HeadingPreview /> }.into_any()),
        _ => None,
    }
}

type Opts = &'static [(&'static str, &'static str)];

const DESIGN: &[(&str, &str, Opts)] = &[
    (
        "Primary button style",
        "buttonStyle",
        &[
            ("gradient", "Gradient"),
            ("solid", "A Flat cyan"),
            ("mint", "B Flat mint"),
            ("outline", "C Outline"),
            ("bar", "D Accent bar"),
            ("bracket", "E Brackets"),
            ("tint", "F Wash"),
        ],
    ),
    (
        "Logo motion",
        "logoMotion",
        &[
            ("none", "None"),
            ("ripple", "Ripple"),
            ("split", "Split"),
            ("sweep", "Sweep"),
            ("turn", "Turn"),
        ],
    ),
    (
        "Shape language",
        "shapeLang",
        &[
            ("chamfer", "A Chamfer"),
            ("bar", "B Edge bar"),
            ("brackets", "C Brackets"),
            ("tab", "D Notch tab"),
            ("soft", "E Soft"),
            ("hud", "F HUD"),
        ],
    ),
    (
        "Toast style",
        "toastStyle",
        &[
            ("bracket", "A Bracket"),
            ("hud", "B HUD"),
            ("facet", "C Facet"),
        ],
    ),
    (
        "Session state card",
        "stateStyle",
        &[
            ("edge", "A Edge"),
            ("bracket", "B Bracket"),
            ("banner", "C Banner"),
        ],
    ),
    (
        "Sub-work indicator",
        "subworkStyle",
        &[
            ("chip", "A Count chip"),
            ("dots", "B Mini-glyph dots"),
            ("tree", "C Tree"),
        ],
    ),
    (
        "Streaming text reveal",
        "textReveal",
        &[
            ("none", "Off"),
            ("fade", "Word fade"),
            ("blur", "Blur-in"),
            ("caret", "Caret"),
            ("scramble", "Scramble"),
            ("wipe", "Wipe"),
            ("slide", "Slide"),
            ("type", "Typewriter"),
            ("glow", "Glow"),
        ],
    ),
    (
        "Heading reveal",
        "headingReveal",
        &[
            ("none", "Off"),
            ("stagger", "Letter stagger"),
            ("scramble", "Scramble"),
            ("wipe", "Wipe"),
        ],
    ),
];

/// Prototype picks kept on this device, each with its live preview (ui-next `DesignOptions.tsx`).
#[component]
pub fn DesignOptions() -> impl IntoView {
    let prefs = crate::state::get().prefs;
    view! {
        <Note>"Prototype picks, applied app-wide as you change them and kept on this device."</Note>
        {DESIGN
            .iter()
            .map(|(title, key, options)| {
                let key = *key;
                view! {
                    <Section title=*title>
                        <Block>
                            <div class="chips">
                                {options
                                    .iter()
                                    .map(|(v, l)| view! {
                                        <button
                                            class="choice"
                                            class:on=move || prefs.text(key) == *v
                                            on:click=move |_| prefs.set(key, *v)
                                        >
                                            {*l}
                                        </button>
                                    })
                                    .collect_view()}
                            </div>
                        </Block>
                        {design_preview(key).map(|p| view! { <Block><div class="design-preview">{p}</div></Block> })}
                    </Section>
                }
            })
            .collect_view()}
        <Section title="Reset">
            <Block>
                <Button
                    label="Restore shipping defaults"
                    kind=ButtonKind::Ghost
                    on_press=Callback::new(move |_| {
                        let d = crate::state::prefs::defaults();
                        prefs.all.update(|m| {
                            for (_, key, _) in DESIGN {
                                if let Some(v) = d.get(*key) {
                                    m.insert((*key).to_owned(), v.clone());
                                }
                            }
                        });
                    })
                />
            </Block>
        </Section>
    }
}
