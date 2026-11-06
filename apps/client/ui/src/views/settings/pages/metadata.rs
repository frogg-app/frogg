//! Project › Generated text (ui-next `Metadata.tsx`): instructions for generated branch names,
//! commit messages and pull requests, written to `frogg.json`.

use leptos::prelude::*;
use serde_json::{json, Value};

use super::project::{obj_at, text_at, Area, ProjectCfg, ProjectSettings, SaveProject};
use crate::views::settings::kit::*;

#[component]
pub fn Metadata() -> impl IntoView {
    view! { <ProjectSettings editor=editor /> }
}

fn editor(p: ProjectCfg) -> AnyView {
    view! { <Editor p=p /> }.into_any()
}

const KINDS: [&str; 3] = ["branchName", "commitMessage", "pullRequest"];

#[component]
fn Editor(p: ProjectCfg) -> impl IntoView {
    let init = p.config.get_untracked().unwrap_or_default();
    let draft = KINDS.map(|k| {
        RwSignal::new(text_at(
            &init,
            &format!("/metadataGeneration/{k}/instructions"),
        ))
    });
    let next = Signal::derive(move || {
        let cfg = p.current();
        let mut m = obj_at(&cfg, "metadataGeneration");
        let mv = Value::Object(m.clone());
        for (k, d) in KINDS.iter().zip(draft) {
            let v = d.get();
            if v != text_at(&mv, &format!("/{k}/instructions")) {
                let mut entry = obj_at(&mv, k);
                entry.insert("instructions".into(), json!(v));
                m.insert((*k).into(), Value::Object(entry));
            }
        }
        let mut out = cfg.as_object().cloned().unwrap_or_default();
        if !m.is_empty() {
            out.insert("metadataGeneration".into(), Value::Object(m));
        }
        Value::Object(out)
    });
    let [branch, commit, pr] = draft;
    view! {
        <Section title="Instructions for generated text">
            <Block>
                <Row label="Branch names" />
                <Area value=branch placeholder="type/short-slug, e.g. feat/session-store" />
            </Block>
            <Block>
                <Row label="Commit messages" />
                <Area value=commit placeholder="Conventional commits. Imperative, ≤ 72 characters." />
            </Block>
            <Block>
                <Row label="Pull requests" />
                <Area value=pr placeholder="Summary, Why, Testing." />
            </Block>
        </Section>
        <SaveProject p=p next=next />
    }
}
