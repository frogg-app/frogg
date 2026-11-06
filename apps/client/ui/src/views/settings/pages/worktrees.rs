//! Project › Worktrees (ui-next `Worktrees.tsx`): base branch, setup and teardown commands and
//! the service port range for new worktrees, written to `frogg.json`.

use leptos::prelude::*;
use serde_json::Value;

use super::project::{
    lines_of, list_of, obj_at, put, text_at, Area, ProjectCfg, ProjectSettings, SaveProject,
};
use crate::views::settings::kit::*;

#[component]
pub fn Worktrees() -> impl IntoView {
    view! { <ProjectSettings editor=editor /> }
}

fn editor(p: ProjectCfg) -> AnyView {
    view! { <Editor p=p /> }.into_any()
}

#[component]
fn Editor(p: ProjectCfg) -> impl IntoView {
    let init = p.config.get_untracked().unwrap_or_default();
    let base = RwSignal::new(text_at(&init, "/worktree/baseBranch"));
    let setup = RwSignal::new(lines_of(init.pointer("/worktree/setup")));
    let teardown = RwSignal::new(lines_of(init.pointer("/worktree/teardown")));
    let range = RwSignal::new(text_at(&init, "/worktree/servicePorts/range"));
    let next = Signal::derive(move || {
        let cfg = p.current();
        let mut w = obj_at(&cfg, "worktree");
        let wv = Value::Object(w.clone());
        let b = base.get();
        if b != text_at(&wv, "/baseBranch") {
            let t = b.trim();
            put(&mut w, "baseBranch", (!t.is_empty()).then(|| t.into()));
        }
        let s = setup.get();
        if s != lines_of(wv.get("setup")) {
            w.insert("setup".into(), list_of(&s));
        }
        let t = teardown.get();
        if t != lines_of(wv.get("teardown")) {
            w.insert("teardown".into(), list_of(&t));
        }
        let r = range.get();
        if r != text_at(&wv, "/servicePorts/range") {
            let mut ports = obj_at(&wv, "servicePorts");
            let rt = r.trim();
            put(&mut ports, "range", (!rt.is_empty()).then(|| rt.into()));
            let keep = ports.contains_key("range")
                || ports.get("portScript").is_some_and(|v| !v.is_null());
            put(&mut w, "servicePorts", keep.then_some(Value::Object(ports)));
        }
        let mut out = cfg.as_object().cloned().unwrap_or_default();
        if !w.is_empty() {
            out.insert("worktree".into(), Value::Object(w));
        }
        Value::Object(out)
    });
    view! {
        <Section title="New worktrees">
            <Row label="Default base branch" hint="Blank uses the repository’s default branch">
                <Input value=base placeholder="Repository default" mono=true />
            </Row>
            <Block>
                <Row label="Setup commands" hint="Run in the new worktree" />
                <Area value=setup placeholder="npm ci" />
            </Block>
            <Block>
                <Row label="Teardown commands" />
                <Area value=teardown placeholder="One command per line" />
            </Block>
            <Row label="Port range" hint="Inclusive TCP ports for services, e.g. 5100-5199">
                <Input value=range placeholder="5100-5199" mono=true />
            </Row>
        </Section>
        <SaveProject p=p next=next />
    }
}
