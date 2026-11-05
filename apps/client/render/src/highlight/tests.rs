use super::*;

fn roles(code: &str, lang: &str) -> Vec<(String, Option<&'static str>)> {
    highlight(code, lang)
        .into_iter()
        .flatten()
        .map(|t| (t.text, t.role.map(Role::name)))
        .collect()
}

fn role_of(code: &str, lang: &str, text: &str) -> Option<&'static str> {
    roles(code, lang)
        .into_iter()
        .find(|(t, _)| t == text)
        .unwrap_or_else(|| panic!("no token {text:?} in {:?}", roles(code, lang)))
        .1
}

#[test]
fn detects_languages() {
    assert_eq!(Lang::detect("src/main.rs"), Some(Lang::Rust));
    assert_eq!(Lang::detect("App.tsx"), Some(Lang::TypeScript));
    assert_eq!(Lang::detect("py"), Some(Lang::Python));
    assert_eq!(Lang::detect("Dockerfile"), Some(Lang::Bash));
    assert_eq!(Lang::detect("rust ignore"), Some(Lang::Rust));
    assert_eq!(Lang::detect("weird"), None);
}

#[test]
fn round_trips_text_and_lines() {
    let code = "fn main() {\n    let s = \"héllo\\n\"; // ✓\n}\n";
    for lang in [
        "rs", "ts", "py", "json", "yaml", "toml", "css", "html", "md", "diff", "sql",
    ] {
        let lines = highlight(code, lang);
        assert_eq!(lines.len(), 4, "{lang}");
        let back: Vec<String> = lines
            .iter()
            .map(|l| l.iter().map(|t| t.text.as_str()).collect())
            .collect();
        assert_eq!(back.join("\n"), code, "{lang}");
    }
}

#[test]
fn rust_roles() {
    let code = "#[derive(Debug)]\npub fn go<'a>(x: &'a str) -> Vec<u8> { println!(\"{}\", 42); Foo::new() }";
    assert_eq!(role_of(code, "rs", "#[derive(Debug)]"), Some("meta"));
    assert_eq!(role_of(code, "rs", "pub"), Some("keyword"));
    assert_eq!(role_of(code, "rs", "go"), Some("definition"));
    assert_eq!(role_of(code, "rs", "'a"), Some("type"));
    assert_eq!(role_of(code, "rs", "println!"), Some("function"));
    assert_eq!(role_of(code, "rs", "42"), Some("number"));
    assert_eq!(role_of(code, "rs", "Foo"), Some("type"));
    assert_eq!(role_of(code, "rs", "new"), Some("function"));
    assert_eq!(role_of(code, "rs", "u8"), Some("type"));
}

#[test]
fn ts_roles() {
    let code = "// hi\nexport class A extends B { x = `t ${1}`; f() { return null } }";
    assert_eq!(role_of(code, "ts", "// hi"), Some("comment"));
    assert_eq!(role_of(code, "ts", "A"), Some("class"));
    assert_eq!(role_of(code, "ts", "f"), Some("function"));
    assert_eq!(role_of(code, "ts", "null"), Some("literal"));
    assert_eq!(role_of(code, "ts", "`t ${1}`"), Some("string"));
}

#[test]
fn python_triple_strings_span_lines() {
    let lines = highlight("x = \"\"\"a\nb\"\"\"\ndef f(): pass", "py");
    assert_eq!(
        lines[1][0],
        Token {
            text: "b\"\"\"".into(),
            role: Some(Role::String)
        }
    );
    assert_eq!(role_of("def f(): pass", "py", "f"), Some("definition"));
}

#[test]
fn escapes_split_strings() {
    let r = roles(r#""a\nb""#, "js");
    assert_eq!(
        r,
        vec![
            ("\"a".into(), Some("string")),
            ("\\n".into(), Some("escape")),
            ("b\"".into(), Some("string"))
        ]
    );
}

#[test]
fn json_keys_are_properties() {
    let code = r#"{"name": "frogg", "n": 1, "ok": true}"#;
    assert_eq!(role_of(code, "json", "\"name\""), Some("property"));
    assert_eq!(role_of(code, "json", "\"frogg\""), Some("string"));
    assert_eq!(role_of(code, "json", "true"), Some("literal"));
}

#[test]
fn yaml_and_toml() {
    let y = "# c\nname: frogg\nlist:\n  - on: true\n";
    assert_eq!(role_of(y, "yaml", "name"), Some("property"));
    assert_eq!(role_of(y, "yaml", "# c"), Some("comment"));
    assert_eq!(role_of(y, "yaml", "true"), Some("literal"));
    let t = "[package]\nname = \"x\"\nn = 3";
    assert_eq!(role_of(t, "toml", "[package]"), Some("heading"));
    assert_eq!(role_of(t, "toml", "name"), Some("property"));
    assert_eq!(role_of(t, "toml", "\"x\""), Some("string"));
}

#[test]
fn css_html_md_diff_sql_bash() {
    let c = ".a:hover { color: #fff; margin: 4px }";
    assert_eq!(role_of(c, "css", ".a"), Some("class"));
    assert_eq!(role_of(c, "css", "color"), Some("property"));
    assert_eq!(role_of(c, "css", "#fff"), Some("number"));
    let h = "<div class=\"x\">&amp;</div>";
    assert_eq!(role_of(h, "html", "div"), Some("tag"));
    assert_eq!(role_of(h, "html", "class"), Some("attribute"));
    assert_eq!(role_of(h, "html", "&amp;"), Some("escape"));
    let m = "# Title\n```rust\nfn x() {}\n```\nsee `code`";
    assert_eq!(role_of(m, "md", "# Title"), Some("heading"));
    assert_eq!(role_of(m, "md", "fn"), Some("keyword"));
    assert_eq!(role_of(m, "md", "`code`"), Some("string"));
    let d = "@@ -1 +1 @@\n-a\n+b";
    assert_eq!(role_of(d, "diff", "+b"), Some("inserted"));
    assert_eq!(role_of(d, "diff", "-a"), Some("deleted"));
    assert_eq!(role_of("SELECT * FROM t", "sql", "SELECT"), Some("keyword"));
    let s = "echo $HOME # x\nexport A=1";
    assert_eq!(role_of(s, "sh", "$HOME"), Some("variable"));
    assert_eq!(role_of(s, "sh", "# x"), Some("comment"));
}

#[test]
fn unknown_language_is_plain() {
    assert_eq!(
        highlight("a\nb", "nope"),
        vec![
            vec![Token {
                text: "a".into(),
                role: None
            }],
            vec![Token {
                text: "b".into(),
                role: None
            }],
        ]
    );
}
