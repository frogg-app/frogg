//! First-run onboarding (ui-next `onboarding/model.ts`, `store.ts`, `nav.ts`): the steps, the
//! profile questions and how they tailor the walkthrough, and where this device is in it.
//! Device-local and persisted under ui-next's key and shape.

use std::cell::Cell;

use leptos::prelude::*;
use serde::{Deserialize, Serialize};

use super::storage;

const KEY: &str = "frogg.next.onboarding";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    New,
    Some,
    Expert,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Work {
    Web,
    Backend,
    Mobile,
    Data,
    Infra,
    Explore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Step {
    Level,
    Work,
    Host,
    Providers,
    Session,
    Concepts,
    Settings,
    Done,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    #[default]
    New,
    Active,
    Minimised,
    Hidden,
    Finished,
}

pub struct StepMeta {
    pub id: Step,
    pub label: &'static str,
    /// Sets something up on the host, so it can complete itself.
    pub setup: bool,
}

pub const STEPS: [StepMeta; 8] = [
    StepMeta {
        id: Step::Level,
        label: "About you",
        setup: false,
    },
    StepMeta {
        id: Step::Work,
        label: "Your work",
        setup: false,
    },
    StepMeta {
        id: Step::Host,
        label: "Connect a host",
        setup: true,
    },
    StepMeta {
        id: Step::Providers,
        label: "Agent providers",
        setup: true,
    },
    StepMeta {
        id: Step::Session,
        label: "First session",
        setup: true,
    },
    StepMeta {
        id: Step::Concepts,
        label: "Key concepts",
        setup: false,
    },
    StepMeta {
        id: Step::Settings,
        label: "Settings for you",
        setup: false,
    },
    StepMeta {
        id: Step::Done,
        label: "Ready",
        setup: false,
    },
];

pub fn meta(step: Step) -> &'static StepMeta {
    STEPS.iter().find(|m| m.id == step).unwrap_or(&STEPS[0])
}

pub fn index_of(step: Step) -> usize {
    STEPS.iter().position(|m| m.id == step).unwrap_or(0)
}

pub const LEVELS: [(Level, &str, &str); 3] = [
    (
        Level::New,
        "New to this",
        "Walk me through it. Explain hosts, agents and worktrees as we go.",
    ),
    (
        Level::Some,
        "Comfortable",
        "I use an editor and git daily. Short explanations, then let me work.",
    ),
    (
        Level::Expert,
        "Expert",
        "I run agents already. Show me where things are and get out of the way.",
    ),
];

pub const WORKS: [(Work, &str, &str); 6] = [
    (Work::Web, "Web & front end", "Sites, apps, UI"),
    (Work::Backend, "Back end & APIs", "Services, databases"),
    (Work::Mobile, "Mobile & desktop", "Native and desktop apps"),
    (Work::Data, "Data & ML", "Notebooks, pipelines, models"),
    (Work::Infra, "Infra & DevOps", "Servers, CI, deploys"),
    (Work::Explore, "Exploring", "Learning, side projects"),
];

/// The next step, skipping set-up steps that already finished for experts.
pub fn next_step(from: Step, done: &[Step], level: Option<Level>) -> Step {
    for m in STEPS.iter().skip(index_of(from) + 1) {
        if level == Some(Level::Expert) && done.contains(&m.id) && m.setup {
            continue;
        }
        return m.id;
    }
    Step::Done
}

pub fn prev_step(from: Step) -> Step {
    STEPS[index_of(from).saturating_sub(1)].id
}

/// One concept card; `deep` shows only to people who asked to be walked through.
#[derive(Debug, Clone, PartialEq)]
pub struct Concept {
    pub id: &'static str,
    pub title: &'static str,
    pub body: &'static str,
    pub deep: Option<&'static str>,
    /// Rail tool id or settings page for the "Show me" link.
    pub tool: Option<&'static str>,
    pub page: Option<&'static str>,
}

const fn concept(
    id: &'static str,
    title: &'static str,
    body: &'static str,
    deep: Option<&'static str>,
    tool: Option<&'static str>,
    page: Option<&'static str>,
) -> Concept {
    Concept {
        id,
        title,
        body,
        deep,
        tool,
        page,
    }
}

const CORE: [Concept; 5] = [
    concept("sessions", "Sessions", "A session is one agent working in one folder. It keeps running on the host when you close the app.", Some("Sessions that need you (a permission, a question) rise to the top of the list and badge the rail. Open one to read its transcript and reply."), Some("sessions"), None),
    concept("worktrees", "Worktrees", "Start a session on a new branch and Frogg gives it its own git worktree, so agents never edit your checkout.", Some("A worktree is a second working copy of the same repository. Several agents can each have one and work in parallel without stepping on each other."), None, Some("worktrees")),
    concept("permissions", "Permissions", "Agents ask before they run commands or edit files. The permission mode decides how often they ask.", Some("Start on Ask or Plan while you learn what an agent does; move to auto-accepting edits once you trust it on a project."), None, Some("modes")),
    concept("tools", "Tools", "The rail holds the tools around a session: files, source control, terminals, PRs and CI, tasks.", Some("Each tool opens beside the session it relates to. ⌘K opens the command palette when you know what you want."), Some("files"), None),
    concept("hosts", "Hosts", "The daemon on a host runs the agents. This app is a client: connect it to as many hosts as you like.", Some("Pair your phone with the same host to follow sessions and answer permissions away from your desk."), Some("hosts"), None),
];

fn by_work(w: Work) -> Concept {
    match w {
        Work::Web => concept("scripts", "Dev servers", "Define dev servers in frogg.json and each worktree runs them on its own ports.", None, None, Some("scripts")),
        Work::Backend => concept("terminals", "Terminals", "Terminals run on the host beside the agent, in the same checkout, and survive reconnects.", None, Some("terminals"), None),
        Work::Mobile => concept("prs", "PRs & CI", "Follow pull requests and CI runs for the session's branch without leaving the app.", None, Some("prs"), None),
        Work::Data => concept("files", "Files", "Browse and preview files on the host, including large outputs the agent wrote.", None, Some("files"), None),
        Work::Infra => concept("multi-host", "Many hosts", "Every saved host stays connected; sessions from all of them show together.", None, Some("hosts"), None),
        Work::Explore => concept("ask", "Just ask", "No project needed: ask a question from Home and an agent answers in a scratch session.", None, Some("sessions"), None),
    }
}

/// The core concept set (trimmed for experts) plus one per kind of work.
pub fn concepts_for(level: Option<Level>, work: &[Work]) -> Vec<Concept> {
    let mut out: Vec<Concept> = CORE
        .iter()
        .filter(|c| level != Some(Level::Expert) || c.id != "tools")
        .cloned()
        .collect();
    for w in work {
        let c = by_work(*w);
        if !out.iter().any(|x| x.id == c.id) {
            out.push(c);
        }
    }
    out
}

pub fn show_deep(level: Option<Level>) -> bool {
    level == Some(Level::New)
}

#[derive(Debug, Clone, PartialEq)]
pub struct SettingTip {
    pub page: &'static str,
    pub label: &'static str,
    pub why: &'static str,
}

fn tip(id: &str) -> Option<SettingTip> {
    let (page, label, why) = match id {
        "modes" => (
            "modes",
            "Permission modes",
            "Choose how often agents ask before acting.",
        ),
        "notify" => (
            "notify",
            "Notifications & inbox",
            "Get told when an agent needs you or finishes.",
        ),
        "providers" => (
            "providers",
            "Providers & models",
            "Default models, and providers you don't use.",
        ),
        "keys" => (
            "keys",
            "Keyboard shortcuts",
            "Palette, new session, approve, deny.",
        ),
        "worktrees" => (
            "worktrees",
            "Worktrees",
            "Where worktrees live and what runs when one is created.",
        ),
        "tools" => (
            "tools",
            "Tools, skills & prompts",
            "MCP servers, skills and reusable prompts.",
        ),
        "scripts" => (
            "scripts",
            "Scripts & services",
            "Dev servers and their ports per worktree.",
        ),
        "ci" => (
            "ci",
            "CI & release streams",
            "Which CI and branches to follow.",
        ),
        "devices" => (
            "devices",
            "Devices & access",
            "Pair a phone, review who can reach this host.",
        ),
        "security" => (
            "security",
            "Security",
            "LAN trust, password and claim mode.",
        ),
        "terminals" => (
            "terminals",
            "Terminal profiles",
            "Shells and environments for host terminals.",
        ),
        "resources" => (
            "resources",
            "Resources & storage",
            "Disk and memory the host's agents use.",
        ),
        "usage" => ("usage", "Usage & limits", "Plan usage meters and warnings."),
        _ => return None,
    };
    Some(SettingTip { page, label, why })
}

/// Settings pages worth a look for this profile, most relevant first, at most `max`.
pub fn settings_for(level: Option<Level>, work: &[Work], max: usize) -> Vec<SettingTip> {
    let mut ids: Vec<&str> = match level.unwrap_or(Level::Some) {
        Level::New => vec!["modes", "notify", "providers"],
        Level::Some => vec!["modes", "notify", "worktrees"],
        Level::Expert => vec!["keys", "worktrees", "tools"],
    };
    for w in work {
        ids.extend_from_slice(match w {
            Work::Web => &["scripts"][..],
            Work::Backend => &["terminals", "scripts"],
            Work::Mobile => &["ci", "devices"],
            Work::Data => &["resources", "terminals"],
            Work::Infra => &["security", "devices", "ci"],
            Work::Explore => &["usage"],
        });
    }
    let mut seen = Vec::new();
    for id in ids {
        if !seen.contains(&id) {
            seen.push(id);
        }
    }
    seen.into_iter().take(max).filter_map(tip).collect()
}

/// Up to three starter prompts for the picked kinds of work.
pub fn starters_for(work: &[Work]) -> Vec<&'static str> {
    let mut out: Vec<&'static str> = Vec::new();
    let picked = work.iter().map(|w| match w {
        Work::Web => "Find accessibility problems on the main page and fix the worst one",
        Work::Backend => "Add input validation and a test to one API endpoint",
        Work::Mobile => "Explain how navigation is structured in this app",
        Work::Data => "Summarise the data files here and suggest a first analysis",
        Work::Infra => "Review the CI config and suggest ways to make it faster",
        Work::Explore => "Explain how this project is organised",
    });
    for p in picked.chain([
        "Explain how this project is organised",
        "Find a small bug and fix it with a test",
    ]) {
        if !out.contains(&p) {
            out.push(p);
        }
    }
    out.truncate(3);
    out
}

/// What the host shows is already set up.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Live {
    pub online: bool,
    pub provider_ready: bool,
    pub has_session: bool,
}

/// Steps done: finished by hand plus what ticks itself from the live host.
pub fn done_set(seen: &[Step], live: Live) -> Vec<Step> {
    let mut done = seen.to_vec();
    for (on, step) in [
        (live.online, Step::Host),
        (live.provider_ready, Step::Providers),
        (live.has_session, Step::Session),
    ] {
        if on && !done.contains(&step) {
            done.push(step);
        }
    }
    done
}

/// (finished tasks, tasks); "done" is the finish line, not a task.
pub fn progress_of(done: &[Step]) -> (usize, usize) {
    let tasks: Vec<Step> = STEPS
        .iter()
        .map(|m| m.id)
        .filter(|s| *s != Step::Done)
        .collect();
    (
        tasks.iter().filter(|t| done.contains(t)).count(),
        tasks.len(),
    )
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Saved {
    #[serde(default)]
    pub status: Status,
    #[serde(default = "first")]
    pub step: Step,
    #[serde(default)]
    pub level: Option<Level>,
    #[serde(default)]
    pub work: Vec<Work>,
    #[serde(default)]
    pub seen: Vec<Step>,
}

fn first() -> Step {
    Step::Level
}

impl Default for Saved {
    fn default() -> Self {
        Self {
            status: Status::New,
            step: Step::Level,
            level: None,
            work: Vec::new(),
            seen: Vec::new(),
        }
    }
}

/// Parses saved state leniently: unknown values fall back, so another build can't wedge it.
pub fn sanitize(raw: &serde_json::Value) -> Saved {
    let pick = |k: &str| raw.get(k).cloned().unwrap_or(serde_json::Value::Null);
    let list = |k: &str| -> Vec<serde_json::Value> {
        raw.get(k)
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
    };
    Saved {
        status: serde_json::from_value(pick("status")).unwrap_or_default(),
        step: serde_json::from_value(pick("step")).unwrap_or(Step::Level),
        level: serde_json::from_value(pick("level")).ok(),
        work: list("work")
            .into_iter()
            .filter_map(|v| serde_json::from_value(v).ok())
            .collect(),
        seen: list("seen")
            .into_iter()
            .filter_map(|v| serde_json::from_value(v).ok())
            .collect(),
    }
}

/// The walkthrough's state on this device.
#[derive(Clone, Copy)]
pub struct Onboarding {
    pub state: RwSignal<Saved>,
    /// The step the user left the walkthrough to do in the app (not persisted).
    pub away: RwSignal<Option<Step>>,
}

thread_local! {
    static STORE: Cell<Option<Onboarding>> = const { Cell::new(None) };
}

pub fn init() -> Onboarding {
    let saved = storage::get_json::<serde_json::Value>(KEY)
        .map(|v| sanitize(&v))
        .unwrap_or_default();
    let store = Onboarding {
        state: RwSignal::new(saved),
        away: RwSignal::new(None),
    };
    Effect::new(move |_| storage::set_json(KEY, &store.state.get()));
    STORE.with(|s| s.set(Some(store)));
    store
}

pub fn get() -> Onboarding {
    STORE
        .with(|s| s.get())
        .expect("state::onboarding::init() runs first")
}

impl Onboarding {
    fn set(&self, f: impl FnOnce(&mut Saved)) {
        self.state.update(f);
    }

    /// Opens the walkthrough at `step`, or where it was left (a finished one restarts).
    pub fn open(&self, step: Option<Step>) {
        self.set(|s| {
            let at = step.unwrap_or(if s.status == Status::Finished {
                Step::Level
            } else {
                s.step
            });
            s.status = Status::Active;
            s.step = at;
        });
    }

    pub fn minimise(&self) {
        self.set(|s| s.status = Status::Minimised);
    }

    pub fn hide(&self) {
        self.set(|s| s.status = Status::Hidden);
    }

    pub fn finish(&self) {
        self.mark_seen(Step::Done);
        self.set(|s| {
            s.status = Status::Finished;
            s.step = Step::Done;
        });
    }

    pub fn restart(&self) {
        self.set(|s| {
            s.status = Status::Active;
            s.step = Step::Level;
            s.seen.clear();
        });
    }

    pub fn reset(&self) {
        self.state.set(Saved {
            status: Status::Hidden,
            ..Saved::default()
        });
    }

    pub fn go(&self, step: Step) {
        self.set(|s| s.step = step);
    }

    pub fn mark_seen(&self, step: Step) {
        self.set(|s| {
            if !s.seen.contains(&step) {
                s.seen.push(step);
            }
        });
    }

    pub fn set_level(&self, level: Level) {
        self.set(|s| s.level = Some(level));
        self.mark_seen(Step::Level);
    }

    pub fn toggle_work(&self, w: Work) {
        self.set(|s| {
            if let Some(i) = s.work.iter().position(|x| *x == w) {
                s.work.remove(i);
            } else {
                s.work.push(w);
            }
            let has = !s.work.is_empty();
            let seen = s.seen.contains(&Step::Work);
            if has && !seen {
                s.seen.push(Step::Work);
            } else if !has && seen {
                s.seen.retain(|x| *x != Step::Work);
            }
        });
    }

    /// Leave the walkthrough (it stays resumable) to do `step` in the app.
    pub fn away(&self, step: Step, run: impl FnOnce()) {
        self.minimise();
        self.away.set(Some(step));
        run();
    }
}

/// The live host state that ticks set-up steps (reactive).
pub fn live() -> Live {
    let app = super::get();
    let cfg = super::config::get();
    Live {
        online: app.conn.active_link().conn == super::Conn::Online,
        provider_ready: cfg.providers.with(|p| {
            p.as_ref()
                .and_then(|p| p.get("entries"))
                .and_then(|e| e.as_array())
                .is_some_and(|e| {
                    e.iter().any(|x| {
                        x.get("status").and_then(|s| s.as_str()) == Some("ready")
                            && x.get("enabled") != Some(&serde_json::Value::Bool(false))
                    })
                })
        }),
        has_session: !app.sessions().is_empty(),
    }
}

/// Steps done on this device right now (reactive).
pub fn done() -> Vec<Step> {
    let seen = get().state.with(|s| s.seen.clone());
    done_set(&seen, live())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn next_skips_done_setup_for_experts() {
        let done = [Step::Host, Step::Providers];
        assert_eq!(
            next_step(Step::Work, &done, Some(Level::Expert)),
            Step::Session
        );
        assert_eq!(next_step(Step::Work, &done, Some(Level::New)), Step::Host);
        assert_eq!(next_step(Step::Settings, &[], None), Step::Done);
        assert_eq!(next_step(Step::Done, &[], None), Step::Done);
        assert_eq!(prev_step(Step::Level), Step::Level);
    }

    #[test]
    fn tailors() {
        assert!(!concepts_for(Some(Level::Expert), &[])
            .iter()
            .any(|c| c.id == "tools"));
        let c = concepts_for(None, &[Work::Web, Work::Web]);
        assert_eq!(c.iter().filter(|c| c.id == "scripts").count(), 1);
        let tips = settings_for(Some(Level::New), &[Work::Infra], 6);
        assert_eq!(tips[0].page, "modes");
        assert!(tips.len() <= 6);
        assert_eq!(starters_for(&[]).len(), 2);
        assert_eq!(starters_for(&[Work::Explore]).len(), 2);
        assert_eq!(starters_for(&[Work::Web, Work::Data]).len(), 3);
    }

    #[test]
    fn progress_counts_live() {
        let live = Live {
            online: true,
            provider_ready: false,
            has_session: true,
        };
        let done = done_set(&[Step::Level], live);
        assert_eq!(progress_of(&done), (3, 7));
    }

    #[test]
    fn sanitizes_ui_next_state() {
        let raw = serde_json::json!({ "status": "minimised", "step": "bogus", "level": "expert", "work": ["web", "x"], "seen": ["level", 3] });
        let s = sanitize(&raw);
        assert_eq!(s.status, Status::Minimised);
        assert_eq!(s.step, Step::Level);
        assert_eq!(s.level, Some(Level::Expert));
        assert_eq!(s.work, vec![Work::Web]);
        assert_eq!(s.seen, vec![Step::Level]);
    }
}
