//! Provider sign-in (ui-next `signin/store.ts`, `login-flow.ts`, `auth-error.ts`): what the
//! dialog signs in, and reading the login command's output.

use std::cell::Cell;

use leptos::prelude::*;

/// An account on a host to sign in, or a provider's account by name.
#[derive(Debug, Clone, PartialEq)]
pub struct SignInTarget {
    pub host_id: Option<String>,
    pub provider: String,
    pub account_id: Option<String>,
    pub account_name: Option<String>,
}

#[derive(Clone, Copy)]
pub struct SignIn {
    pub target: RwSignal<Option<SignInTarget>>,
}

thread_local! {
    static STORE: Cell<Option<SignIn>> = const { Cell::new(None) };
}

pub fn init() -> SignIn {
    let s = SignIn {
        target: RwSignal::new(None),
    };
    STORE.with(|c| c.set(Some(s)));
    s
}

pub fn get() -> SignIn {
    STORE
        .with(|c| c.get())
        .expect("state::signin::init() runs first")
}

pub fn open_sign_in(target: SignInTarget) {
    get().target.set(Some(target));
}

pub fn close_sign_in() {
    get().target.set(None);
}

/// Headless sign-in commands: each prints a URL (and a code or a code prompt) instead of a TUI.
pub fn login_command(provider: &str) -> Option<(&'static str, &'static [&'static str])> {
    match provider {
        "claude" => Some(("claude", &["auth", "login"])),
        "codex" => Some(("codex", &["login", "--device-auth"])),
        _ => None,
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct LoginState {
    pub url: Option<String>,
    /// A one-time code to type into the provider's page (device flow).
    pub user_code: Option<String>,
    /// The CLI waits for the code the provider's page shows after sign-in.
    pub wants_code: bool,
    pub done: bool,
    pub error: Option<String>,
}

/// Drops OSC, CSI and two-byte escapes; normalises line ends.
pub fn strip_ansi(raw: &str) -> String {
    let b: Vec<char> = raw.chars().collect();
    let mut out = String::with_capacity(raw.len());
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if c == '\x1b' && i + 1 < b.len() {
            match b[i + 1] {
                ']' => {
                    i += 2;
                    while i < b.len() {
                        if b[i] == '\x07' {
                            i += 1;
                            break;
                        }
                        if b[i] == '\x1b' && i + 1 < b.len() && b[i + 1] == '\\' {
                            i += 2;
                            break;
                        }
                        i += 1;
                    }
                }
                '[' => {
                    i += 2;
                    while i < b.len() && ('\x30'..='\x3f').contains(&b[i]) {
                        i += 1;
                    }
                    while i < b.len() && ('\x20'..='\x2f').contains(&b[i]) {
                        i += 1;
                    }
                    i += 1;
                }
                '@'..='Z' | '\\'..='_' => i += 2,
                _ => {
                    i += 1;
                }
            }
            continue;
        }
        if c == '\r' {
            out.push('\n');
            if b.get(i + 1) == Some(&'\n') {
                i += 1;
            }
        } else {
            out.push(c);
        }
        i += 1;
    }
    out
}

fn urls(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(at) = rest.find("https://") {
        let tail = &rest[at..];
        let end = tail
            .find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>'))
            .unwrap_or(tail.len());
        out.push(&tail[..end]);
        rest = &tail[end..];
    }
    out
}

/// A device code like `ABCD-12345`.
fn device_code(text: &str) -> Option<String> {
    let chars: Vec<char> = text.chars().collect();
    let ok = |c: char| c.is_ascii_uppercase() || c.is_ascii_digit();
    let n = chars.len();
    let mut i = 0;
    while i < n {
        let boundary = i == 0 || !chars[i - 1].is_alphanumeric();
        if boundary && i + 4 < n && chars[i..i + 4].iter().all(|c| ok(*c)) && chars[i + 4] == '-' {
            let mut j = i + 5;
            while j < n && ok(chars[j]) && j - (i + 5) < 6 {
                j += 1;
            }
            let len = j - (i + 5);
            let end_ok = j == n || !chars[j].is_alphanumeric();
            if (4..=6).contains(&len) && end_ok {
                return Some(chars[i..j].iter().collect());
            }
        }
        i += 1;
    }
    None
}

/// Reads the sign-in state from everything the login command has printed so far.
pub fn parse_login(raw: &str) -> LoginState {
    let text = strip_ansi(raw);
    let lower = text.to_lowercase();
    let all = urls(&text);
    let url = all
        .iter()
        .find(|u| {
            let l = u.to_lowercase();
            ["oauth", "authorize", "device", "login", "auth."]
                .iter()
                .any(|k| l.contains(k))
        })
        .or(all.first())
        .map(|s| s.to_string());
    let user_code = lower
        .find("one-time code")
        .and_then(|at| device_code(&text[at..]));
    let done = [
        "login successful",
        "successfully logged in",
        "logged in as",
        "logged in successfully",
        "signed in as",
    ]
    .iter()
    .any(|k| lower.contains(k));
    let error = if done {
        None
    } else {
        text.lines()
            .find(|l| {
                let l = l.to_lowercase();
                ["login failed", "oauth error", "invalid code", "error:"]
                    .iter()
                    .any(|k| l.contains(k))
            })
            .map(|l| l.trim().to_owned())
    };
    let wants_code = !done
        && error.is_none()
        && (lower.contains("paste code") || lower.contains("paste the code"));
    LoginState {
        url,
        user_code,
        wants_code,
        done,
        error,
    }
}

/// A provider error that means "sign in again"; returns (provider, account) the text names.
pub fn auth_problem(text: &str) -> Option<(Option<String>, Option<String>)> {
    let l = text.to_lowercase();
    let signed_out = [
        "could not be refreshed",
        "failed to authenticate",
        "is not signed in to provider",
        "not signed in",
        "not logged in",
        "please run /login",
        "please /login",
        "claude login",
        "claude auth login",
        "codex login",
        "invalid api key",
        "invalid bearer token",
        "invalid access token",
        "authentication_error",
    ]
    .iter()
    .any(|k| l.contains(k))
        || (l.contains("oauth") && (l.contains("expired") || l.contains("revoked")))
        || (l.contains("token") && (l.contains("expired") || l.contains("revoked")))
        || (l.contains("401") && (l.contains("unauthorized") || l.contains("unauthorised")));
    if !signed_out {
        return None;
    }
    if let Some(at) = text.find("Account \"") {
        let rest = &text[at + 9..];
        if let Some(end) = rest.find('"') {
            let account = rest[..end].to_owned();
            let provider = rest
                .find("provider \"")
                .map(|p| &rest[p + 10..])
                .and_then(|r| r.find('"').map(|e| r[..e].to_owned()));
            return Some((provider, Some(account)));
        }
    }
    let provider = [
        ("claude", "claude"),
        ("codex", "codex"),
        ("openai", "codex"),
        ("chatgpt", "codex"),
        ("gemini", "gemini"),
        ("copilot", "copilot"),
        ("opencode", "opencode"),
    ]
    .iter()
    .find(|(k, _)| l.contains(k))
    .map(|(_, p)| p.to_string());
    Some((provider, None))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_escapes() {
        assert_eq!(strip_ansi("\x1b[1mhi\x1b[0m\r\nthere"), "hi\nthere");
        assert_eq!(strip_ansi("\x1b]8;;https://x\x07link\x1b]8;;\x07"), "link");
    }

    #[test]
    fn reads_claude_flow() {
        let s = parse_login("Browser didn't open? Use the url below:\r\n\r\nhttps://claude.ai/oauth/authorize?code=true&x=1\r\n\r\nPaste code here if prompted > ");
        assert_eq!(
            s.url.as_deref(),
            Some("https://claude.ai/oauth/authorize?code=true&x=1")
        );
        assert!(s.wants_code);
        assert!(!s.done);
    }

    #[test]
    fn reads_codex_device_flow() {
        let s = parse_login(
            "Open https://auth.openai.com/codex/device\nEnter this one-time code: ABCD-12345\n",
        );
        assert_eq!(s.user_code.as_deref(), Some("ABCD-12345"));
        assert!(parse_login("Successfully logged in").done);
        assert_eq!(
            parse_login("Error: invalid code").error.as_deref(),
            Some("Error: invalid code")
        );
    }

    #[test]
    fn spots_auth_problems() {
        assert_eq!(
            auth_problem("Account \"work\" is not signed in to provider \"claude\""),
            Some((Some("claude".into()), Some("work".into())))
        );
        assert_eq!(
            auth_problem("OAuth token has expired for Codex"),
            Some((Some("codex".into()), None))
        );
        assert_eq!(auth_problem("all fine"), None);
    }
}
