//! Project › CI & release streams (ui-next `Ci.tsx`): GitHub Actions, Jenkins and the release
//! branch names, written to `frogg.json`.

use leptos::prelude::*;
use serde_json::{json, Value};

use super::project::{obj_at, put, text_at, ProjectCfg, ProjectSettings, SaveProject};
use crate::views::settings::kit::*;

#[component]
pub fn Ci() -> impl IntoView {
    view! { <ProjectSettings editor=editor /> }
}

fn editor(p: ProjectCfg) -> AnyView {
    view! { <Editor p=p /> }.into_any()
}

fn text_or(v: &Value, pointer: &str, default: &str) -> String {
    v.pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or(default)
        .to_owned()
}

/// The problem that blocks saving, if any.
fn problem(url: &str, job: &str, dev: &str, stable: &str) -> Option<String> {
    if dev.trim().is_empty() || stable.trim().is_empty() {
        return Some("Both release branch names are required.".into());
    }
    let u = url.trim();
    if !url.is_empty()
        && (!(u.starts_with("http://") || u.starts_with("https://")) || job.trim().is_empty())
    {
        return Some("Enter an HTTP(S) Jenkins URL and a job path.".into());
    }
    None
}

#[component]
fn Editor(p: ProjectCfg) -> impl IntoView {
    let init = p.config.get_untracked().unwrap_or_default();
    let github = RwSignal::new(
        init.pointer("/ci/githubActions")
            .and_then(Value::as_bool)
            .unwrap_or(true),
    );
    let url = RwSignal::new(text_at(&init, "/ci/jenkins/url"));
    let job = RwSignal::new(text_at(&init, "/ci/jenkins/job"));
    let multi = RwSignal::new(
        init.pointer("/ci/jenkins/multibranch")
            .and_then(Value::as_bool)
            .unwrap_or(true),
    );
    let dev = RwSignal::new(text_or(&init, "/streams/development", "main"));
    let stable = RwSignal::new(text_or(&init, "/streams/stable", "stable"));
    let remote = RwSignal::new(text_at(&init, "/streams/upstream/remote"));
    let next = Signal::derive(move || {
        let cfg = p.current();
        let mut ci = obj_at(&cfg, "ci");
        ci.insert("githubActions".into(), json!(github.get()));
        let u = url.get();
        let jenkins = (!u.trim().is_empty()).then(|| {
            let mut j = obj_at(&Value::Object(ci.clone()), "jenkins");
            j.insert("url".into(), json!(u.trim()));
            j.insert("job".into(), json!(job.get().trim()));
            j.insert("multibranch".into(), json!(multi.get()));
            Value::Object(j)
        });
        put(&mut ci, "jenkins", jenkins);
        let mut streams = obj_at(&cfg, "streams");
        streams.insert("development".into(), json!(dev.get().trim()));
        streams.insert("stable".into(), json!(stable.get().trim()));
        let r = remote.get();
        let had = streams.get("upstream").is_some_and(|v| !v.is_null());
        let upstream = (!r.trim().is_empty() || had).then(|| {
            let mut up = obj_at(&Value::Object(streams.clone()), "upstream");
            put(
                &mut up,
                "remote",
                (!r.trim().is_empty()).then(|| json!(r.trim())),
            );
            Value::Object(up)
        });
        put(&mut streams, "upstream", upstream);
        let mut out = cfg.as_object().cloned().unwrap_or_default();
        out.insert("ci".into(), Value::Object(ci));
        out.insert("streams".into(), Value::Object(streams));
        Value::Object(out)
    });
    let error = Signal::derive(move || problem(&url.get(), &job.get(), &dev.get(), &stable.get()));
    view! {
        <Section title="CI">
            <Row label="GitHub Actions" hint="Read through gh for GitHub repositories">
                <Toggle value=github on_change=Callback::new(move |v| github.set(v)) label="GitHub Actions" />
            </Row>
            <Row label="Jenkins URL" hint="Blank disables Jenkins. Credentials stay in the daemon environment.">
                <Input value=url placeholder="https://jenkins.example.com" mono=true />
            </Row>
            <Row label="Jenkins job">
                <Input value=job placeholder="team/job" mono=true />
            </Row>
            <Row label="Multibranch">
                <Toggle
                    value=multi
                    on_change=Callback::new(move |v| multi.set(v))
                    disabled=Signal::derive(move || url.get().is_empty())
                    label="Multibranch"
                />
            </Row>
        </Section>
        <Section title="Release streams · developer">
            <Row label="Development branch" hint="Cuts beta releases">
                <Input value=dev mono=true />
            </Row>
            <Row label="Stable branch">
                <Input value=stable mono=true />
            </Row>
            <Row label="Upstream remote" hint="Optional, for forks">
                <Input value=remote placeholder="upstream" mono=true />
            </Row>
        </Section>
        <SaveProject p=p next=next error=error />
    }
}

#[cfg(test)]
mod tests {
    use super::problem;

    #[test]
    fn validates() {
        assert!(problem("", "", "main", "stable").is_none());
        assert!(problem("", "", "", "stable").is_some());
        assert!(problem("ftp://x", "j", "main", "stable").is_some());
        assert!(problem("https://x", "", "main", "stable").is_some());
        assert!(problem("https://x", "team/job", "main", "stable").is_none());
    }
}
