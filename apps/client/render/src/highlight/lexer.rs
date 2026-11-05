//! The tokenizers. Most languages share one configurable C-family scanner (`Spec`); the
//! markup and data formats (JSON keys, YAML, TOML, CSS, HTML, Markdown, diff) get small
//! line- or state-based scanners of their own. Spans are byte ranges on char boundaries.

#![allow(clippy::byte_char_slices, clippy::too_many_arguments)]

use super::Role;

/// A supported language.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lang {
    Rust,
    TypeScript,
    JavaScript,
    Python,
    Go,
    Json,
    Yaml,
    Toml,
    Bash,
    Css,
    Html,
    Markdown,
    Diff,
    Sql,
    C,
    Cpp,
    Java,
    CSharp,
    Kotlin,
    Swift,
    Ruby,
    Php,
    Lua,
}

impl Lang {
    /// A language from a fence info string, alias, extension, file name or path.
    pub fn detect(name: &str) -> Option<Lang> {
        let name = name.trim();
        let name = name.split([' ', ',', '{']).next().unwrap_or("");
        let base = name
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(name)
            .to_ascii_lowercase();
        match base.as_str() {
            "dockerfile" | "makefile" | ".bashrc" | ".zshrc" | ".profile" | ".env" => {
                return Some(Lang::Bash)
            }
            "cargo.lock" => return Some(Lang::Toml),
            _ => {}
        }
        let ext = base.rsplit('.').next().unwrap_or(&base);
        Some(match ext {
            "rs" | "rust" => Lang::Rust,
            "ts" | "tsx" | "mts" | "cts" | "typescript" => Lang::TypeScript,
            "js" | "jsx" | "mjs" | "cjs" | "javascript" | "node" => Lang::JavaScript,
            "py" | "pyi" | "python" | "py3" => Lang::Python,
            "go" | "golang" => Lang::Go,
            "json" | "jsonc" | "json5" | "jsonl" => Lang::Json,
            "yaml" | "yml" => Lang::Yaml,
            "toml" => Lang::Toml,
            "sh" | "bash" | "zsh" | "shell" | "console" | "shellscript" | "fish" | "ksh" => {
                Lang::Bash
            }
            "css" | "scss" | "less" => Lang::Css,
            "html" | "htm" | "xml" | "svg" | "xhtml" | "vue" | "svelte" | "astro" | "plist" => {
                Lang::Html
            }
            "md" | "markdown" | "mdx" => Lang::Markdown,
            "diff" | "patch" => Lang::Diff,
            "sql" | "psql" | "mysql" | "sqlite" => Lang::Sql,
            "c" | "h" => Lang::C,
            "cpp" | "cc" | "cxx" | "hpp" | "hh" | "hxx" | "c++" => Lang::Cpp,
            "java" => Lang::Java,
            "cs" | "csharp" | "c#" => Lang::CSharp,
            "kt" | "kts" | "kotlin" => Lang::Kotlin,
            "swift" => Lang::Swift,
            "rb" | "ruby" | "gemspec" => Lang::Ruby,
            "php" => Lang::Php,
            "lua" => Lang::Lua,
            _ => return None,
        })
    }
}

pub(crate) type Span = (usize, usize, Role);

pub(crate) fn lex(src: &str, lang: Lang) -> Vec<Span> {
    let mut out = Vec::new();
    match lang {
        Lang::Json => generic(src, 0, &JSON, &mut out),
        Lang::Yaml => yaml(src, &mut out),
        Lang::Toml => toml(src, &mut out),
        Lang::Css => css(src, &mut out),
        Lang::Html => html(src, &mut out),
        Lang::Markdown => markdown(src, &mut out),
        Lang::Diff => diff(src, &mut out),
        other => generic(src, 0, spec(other), &mut out),
    }
    out
}

// ---- the C-family scanner ----------------------------------------------------------------------

#[derive(Default)]
struct Spec {
    line: &'static [&'static str],
    block: Option<(&'static str, &'static str)>,
    quotes: &'static [u8],
    /// Quotes that may span lines (template literals, Go raw strings).
    multiline_quotes: &'static [u8],
    triple: bool,
    keywords: &'static [&'static str],
    types: &'static [&'static str],
    literals: &'static [&'static str],
    /// Keywords after which the next identifier is a function definition / a class.
    def_kw: &'static [&'static str],
    class_kw: &'static [&'static str],
    caps_types: bool,
    /// `#` at line start runs to end of line as meta (C preprocessor).
    preproc: bool,
    /// `@name` decorators / annotations.
    at_meta: bool,
    /// Rust: `#[attr]`, lifetimes, `name!` macros.
    rust: bool,
    /// `$name` variables (shell, PHP).
    dollar: bool,
    /// Keywords match case-insensitively (SQL).
    nocase: bool,
    /// A string followed by `:` is a property key (JSON).
    key_strings: bool,
}

const KW_RUST: &[&str] = &[
    "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum", "extern",
    "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref",
    "return", "self", "Self", "static", "struct", "super", "trait", "type", "unsafe", "use",
    "where", "while", "yield",
];
const TY_RUST: &[&str] = &[
    "i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize", "f32",
    "f64", "bool", "char", "str", "String", "Vec", "Option", "Result", "Box",
];
const KW_JS: &[&str] = &[
    "as",
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "export",
    "extends",
    "finally",
    "for",
    "from",
    "function",
    "get",
    "if",
    "implements",
    "import",
    "in",
    "instanceof",
    "interface",
    "keyof",
    "let",
    "new",
    "of",
    "private",
    "protected",
    "public",
    "readonly",
    "return",
    "satisfies",
    "set",
    "static",
    "super",
    "switch",
    "this",
    "throw",
    "try",
    "type",
    "typeof",
    "var",
    "void",
    "while",
    "with",
    "yield",
    "declare",
    "namespace",
    "abstract",
    "infer",
    "is",
];
const TY_TS: &[&str] = &[
    "string", "number", "boolean", "any", "unknown", "never", "object", "symbol", "bigint",
    "Record", "Partial", "Promise", "Array",
];
const LIT_JS: &[&str] = &["true", "false", "null", "undefined", "NaN", "Infinity"];
const KW_PY: &[&str] = &[
    "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif",
    "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda",
    "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield", "match",
    "case", "self",
];
const TY_PY: &[&str] = &[
    "int", "float", "str", "bool", "list", "dict", "set", "tuple", "bytes",
];
const LIT_PY: &[&str] = &["True", "False", "None"];
const KW_GO: &[&str] = &[
    "break",
    "case",
    "chan",
    "const",
    "continue",
    "default",
    "defer",
    "else",
    "fallthrough",
    "for",
    "func",
    "go",
    "goto",
    "if",
    "import",
    "interface",
    "map",
    "package",
    "range",
    "return",
    "select",
    "struct",
    "switch",
    "type",
    "var",
];
const TY_GO: &[&str] = &[
    "bool",
    "byte",
    "complex64",
    "complex128",
    "error",
    "float32",
    "float64",
    "int",
    "int8",
    "int16",
    "int32",
    "int64",
    "rune",
    "string",
    "uint",
    "uint8",
    "uint16",
    "uint32",
    "uint64",
    "uintptr",
    "any",
];
const LIT_GO: &[&str] = &["true", "false", "nil", "iota"];
const KW_SH: &[&str] = &[
    "if", "then", "else", "elif", "fi", "case", "esac", "for", "while", "until", "do", "done",
    "in", "function", "return", "local", "export", "readonly", "declare", "set", "unset", "shift",
    "exit", "source", "alias", "select", "time",
];
const LIT_SH: &[&str] = &["true", "false"];
const KW_SQL: &[&str] = &[
    "select",
    "from",
    "where",
    "and",
    "or",
    "not",
    "insert",
    "into",
    "values",
    "update",
    "set",
    "delete",
    "create",
    "table",
    "drop",
    "alter",
    "add",
    "index",
    "on",
    "join",
    "left",
    "right",
    "inner",
    "outer",
    "full",
    "cross",
    "group",
    "by",
    "order",
    "having",
    "limit",
    "offset",
    "as",
    "distinct",
    "union",
    "all",
    "primary",
    "key",
    "foreign",
    "references",
    "default",
    "unique",
    "constraint",
    "if",
    "exists",
    "in",
    "is",
    "like",
    "between",
    "case",
    "when",
    "then",
    "else",
    "end",
    "with",
    "returning",
    "begin",
    "commit",
    "rollback",
    "transaction",
    "view",
    "asc",
    "desc",
    "count",
    "sum",
    "avg",
    "min",
    "max",
    "coalesce",
    "cast",
];
const TY_SQL: &[&str] = &[
    "int",
    "integer",
    "bigint",
    "smallint",
    "text",
    "varchar",
    "char",
    "boolean",
    "bool",
    "real",
    "float",
    "double",
    "numeric",
    "decimal",
    "date",
    "time",
    "timestamp",
    "timestamptz",
    "json",
    "jsonb",
    "blob",
    "uuid",
    "serial",
];
const LIT_SQL: &[&str] = &["null", "true", "false"];
const KW_C: &[&str] = &[
    "auto",
    "break",
    "case",
    "const",
    "continue",
    "default",
    "do",
    "else",
    "enum",
    "extern",
    "for",
    "goto",
    "if",
    "inline",
    "register",
    "restrict",
    "return",
    "sizeof",
    "static",
    "struct",
    "switch",
    "typedef",
    "union",
    "volatile",
    "while",
    "class",
    "namespace",
    "template",
    "typename",
    "public",
    "private",
    "protected",
    "virtual",
    "override",
    "new",
    "delete",
    "this",
    "using",
    "try",
    "catch",
    "throw",
    "constexpr",
    "noexcept",
    "operator",
    "friend",
    "explicit",
];
const TY_C: &[&str] = &[
    "void", "char", "short", "int", "long", "float", "double", "signed", "unsigned", "bool",
    "size_t", "int8_t", "int16_t", "int32_t", "int64_t", "uint8_t", "uint16_t", "uint32_t",
    "uint64_t", "auto", "std", "string",
];
const LIT_C: &[&str] = &["true", "false", "NULL", "nullptr"];
const KW_JAVA: &[&str] = &[
    "abstract",
    "assert",
    "break",
    "case",
    "catch",
    "class",
    "continue",
    "default",
    "do",
    "else",
    "enum",
    "extends",
    "final",
    "finally",
    "for",
    "if",
    "implements",
    "import",
    "instanceof",
    "interface",
    "native",
    "new",
    "package",
    "private",
    "protected",
    "public",
    "return",
    "static",
    "super",
    "switch",
    "synchronized",
    "this",
    "throw",
    "throws",
    "try",
    "var",
    "volatile",
    "while",
    "record",
    "sealed",
    "permits",
    "yield",
    // C#, Kotlin and Swift share the scanner and most of this list.
    "namespace",
    "using",
    "async",
    "await",
    "override",
    "virtual",
    "readonly",
    "get",
    "set",
    "fun",
    "val",
    "object",
    "when",
    "is",
    "in",
    "out",
    "data",
    "companion",
    "init",
    "func",
    "let",
    "struct",
    "protocol",
    "extension",
    "guard",
    "defer",
    "where",
    "self",
    "internal",
    "open",
    "lateinit",
    "suspend",
    "inout",
    "mutating",
    "throws",
    "rethrows",
    "some",
];
const TY_JAVA: &[&str] = &[
    "boolean", "byte", "char", "short", "int", "long", "float", "double", "void", "String", "Int",
    "Long", "Double", "Float", "Bool", "Boolean", "Unit", "Any", "string", "object", "decimal",
];
const LIT_JAVA: &[&str] = &["true", "false", "null", "nil"];
const KW_RUBY: &[&str] = &[
    "alias",
    "and",
    "begin",
    "break",
    "case",
    "class",
    "def",
    "defined?",
    "do",
    "else",
    "elsif",
    "end",
    "ensure",
    "for",
    "if",
    "in",
    "module",
    "next",
    "not",
    "or",
    "redo",
    "rescue",
    "retry",
    "return",
    "self",
    "super",
    "then",
    "undef",
    "unless",
    "until",
    "when",
    "while",
    "yield",
    "require",
    "attr_reader",
    "attr_accessor",
    "puts",
];
const LIT_RUBY: &[&str] = &["true", "false", "nil"];
const KW_PHP: &[&str] = &[
    "abstract",
    "and",
    "as",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "declare",
    "default",
    "do",
    "echo",
    "else",
    "elseif",
    "extends",
    "final",
    "finally",
    "fn",
    "for",
    "foreach",
    "function",
    "global",
    "if",
    "implements",
    "include",
    "instanceof",
    "interface",
    "namespace",
    "new",
    "or",
    "private",
    "protected",
    "public",
    "require",
    "return",
    "static",
    "switch",
    "throw",
    "trait",
    "try",
    "use",
    "var",
    "while",
    "match",
    "readonly",
];
const KW_LUA: &[&str] = &[
    "and", "break", "do", "else", "elseif", "end", "for", "function", "goto", "if", "in", "local",
    "not", "or", "repeat", "return", "then", "until", "while",
];
const LIT_LUA: &[&str] = &["true", "false", "nil"];

const RUST: Spec = Spec {
    line: &["//"],
    block: Some(("/*", "*/")),
    quotes: &[b'"'],
    multiline_quotes: &[b'"'],
    keywords: KW_RUST,
    types: TY_RUST,
    literals: &["true", "false", "None", "Some", "Ok", "Err"],
    def_kw: &["fn"],
    class_kw: &["struct", "enum", "trait", "type", "impl", "mod"],
    caps_types: true,
    rust: true,
    ..EMPTY
};
const JS: Spec = Spec {
    line: &["//"],
    block: Some(("/*", "*/")),
    quotes: &[b'"', b'\'', b'`'],
    multiline_quotes: &[b'`'],
    keywords: KW_JS,
    types: &[],
    literals: LIT_JS,
    def_kw: &["function"],
    class_kw: &[
        "class",
        "interface",
        "type",
        "enum",
        "extends",
        "implements",
    ],
    caps_types: true,
    at_meta: true,
    ..EMPTY
};
const TS: Spec = Spec { types: TY_TS, ..JS };
const PY: Spec = Spec {
    line: &["#"],
    quotes: &[b'"', b'\''],
    triple: true,
    keywords: KW_PY,
    types: TY_PY,
    literals: LIT_PY,
    def_kw: &["def"],
    class_kw: &["class"],
    caps_types: true,
    at_meta: true,
    ..EMPTY
};
const GO: Spec = Spec {
    line: &["//"],
    block: Some(("/*", "*/")),
    quotes: &[b'"', b'\'', b'`'],
    multiline_quotes: &[b'`'],
    keywords: KW_GO,
    types: TY_GO,
    literals: LIT_GO,
    def_kw: &["func"],
    class_kw: &["type"],
    ..EMPTY
};
const SH: Spec = Spec {
    line: &["#"],
    quotes: &[b'"', b'\''],
    multiline_quotes: &[b'"', b'\''],
    keywords: KW_SH,
    literals: LIT_SH,
    def_kw: &["function"],
    dollar: true,
    ..EMPTY
};
const SQL: Spec = Spec {
    line: &["--"],
    block: Some(("/*", "*/")),
    quotes: &[b'\'', b'"', b'`'],
    keywords: KW_SQL,
    types: TY_SQL,
    literals: LIT_SQL,
    nocase: true,
    ..EMPTY
};
const C: Spec = Spec {
    line: &["//"],
    block: Some(("/*", "*/")),
    quotes: &[b'"', b'\''],
    keywords: KW_C,
    types: TY_C,
    literals: LIT_C,
    class_kw: &["struct", "class", "enum", "union", "namespace"],
    preproc: true,
    ..EMPTY
};
const JAVA: Spec = Spec {
    line: &["//"],
    block: Some(("/*", "*/")),
    quotes: &[b'"', b'\''],
    keywords: KW_JAVA,
    types: TY_JAVA,
    literals: LIT_JAVA,
    def_kw: &["fun", "func"],
    class_kw: &[
        "class",
        "interface",
        "enum",
        "record",
        "object",
        "struct",
        "protocol",
    ],
    caps_types: true,
    at_meta: true,
    ..EMPTY
};
const CSHARP: Spec = Spec {
    preproc: true,
    at_meta: false,
    ..JAVA
};
const RUBY: Spec = Spec {
    line: &["#"],
    quotes: &[b'"', b'\''],
    keywords: KW_RUBY,
    literals: LIT_RUBY,
    def_kw: &["def"],
    class_kw: &["class", "module"],
    caps_types: true,
    ..EMPTY
};
const PHP: Spec = Spec {
    line: &["//", "#"],
    block: Some(("/*", "*/")),
    quotes: &[b'"', b'\''],
    keywords: KW_PHP,
    literals: &["true", "false", "null", "TRUE", "FALSE", "NULL"],
    def_kw: &["function"],
    class_kw: &["class", "interface", "trait"],
    caps_types: true,
    dollar: true,
    ..EMPTY
};
const LUA: Spec = Spec {
    line: &["--"],
    quotes: &[b'"', b'\''],
    keywords: KW_LUA,
    literals: LIT_LUA,
    def_kw: &["function"],
    ..EMPTY
};
const JSON: Spec = Spec {
    line: &["//"],
    block: Some(("/*", "*/")),
    quotes: &[b'"'],
    literals: &["true", "false", "null"],
    key_strings: true,
    ..EMPTY
};
/// Values on the right of a YAML / TOML key.
const VALUE: Spec = Spec {
    line: &["#"],
    quotes: &[b'"', b'\''],
    literals: &[
        "true", "false", "null", "yes", "no", "on", "off", "~", "inf", "nan",
    ],
    ..EMPTY
};
const EMPTY: Spec = Spec {
    line: &[],
    block: None,
    quotes: &[],
    multiline_quotes: &[],
    triple: false,
    keywords: &[],
    types: &[],
    literals: &[],
    def_kw: &[],
    class_kw: &[],
    caps_types: false,
    preproc: false,
    at_meta: false,
    rust: false,
    dollar: false,
    nocase: false,
    key_strings: false,
};

fn spec(lang: Lang) -> &'static Spec {
    match lang {
        Lang::Rust => &RUST,
        Lang::TypeScript => &TS,
        Lang::JavaScript => &JS,
        Lang::Python => &PY,
        Lang::Go => &GO,
        Lang::Bash => &SH,
        Lang::Sql => &SQL,
        Lang::C | Lang::Cpp => &C,
        Lang::Java | Lang::Kotlin | Lang::Swift => &JAVA,
        Lang::CSharp => &CSHARP,
        Lang::Ruby => &RUBY,
        Lang::Php => &PHP,
        Lang::Lua => &LUA,
        _ => &JSON,
    }
}

fn is_ident_start(b: u8) -> bool {
    b.is_ascii_alphabetic() || b == b'_'
}
fn is_ident(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}
/// Byte length of the UTF-8 char starting with `b`.
fn char_len(b: u8) -> usize {
    match b {
        0xF0..=0xFF => 4,
        0xE0..=0xEF => 3,
        0xC0..=0xDF => 2,
        _ => 1,
    }
}

fn contains(list: &[&str], word: &str, nocase: bool) -> bool {
    if nocase {
        list.iter().any(|k| k.eq_ignore_ascii_case(word))
    } else {
        list.contains(&word)
    }
}

/// Pushes a span, merging with the previous one when it has the same role and touches it.
fn push(out: &mut Vec<Span>, s: usize, e: usize, role: Role) {
    if s >= e {
        return;
    }
    if let Some(last) = out.last_mut() {
        if last.1 == s && last.2 == role {
            last.1 = e;
            return;
        }
    }
    out.push((s, e, role));
}

/// Scans a string body from `i` (just past the opening delimiter) to past `close`, emitting
/// string and escape spans. Returns the end.
fn string_body(
    b: &[u8],
    base: usize,
    start: usize,
    mut i: usize,
    close: &[u8],
    multiline: bool,
    escapes: bool,
    out: &mut Vec<Span>,
) -> usize {
    let mut run = start;
    while i < b.len() {
        if escapes && b[i] == b'\\' && i + 1 < b.len() {
            push(out, base + run, base + i, Role::String);
            let n = 1 + char_len(b[i + 1]);
            push(out, base + i, base + i + n, Role::Escape);
            i += n;
            run = i;
            continue;
        }
        if b[i..].starts_with(close) {
            i += close.len();
            break;
        }
        if b[i] == b'\n' && !multiline {
            break;
        }
        i += char_len(b[i]);
    }
    push(out, base + run, base + i, Role::String);
    i
}

fn generic(src: &str, base: usize, sp: &Spec, out: &mut Vec<Span>) {
    let b = src.as_bytes();
    let mut i = 0;
    let mut pending: Option<Role> = None;
    let mut line_start = true;
    while i < b.len() {
        let c = b[i];
        if c == b'\n' {
            line_start = true;
            i += 1;
            continue;
        }
        if c == b' ' || c == b'\t' || c == b'\r' {
            i += 1;
            continue;
        }
        let at_line_start = line_start;
        line_start = false;
        let rest = &b[i..];
        // Comments.
        if let Some(l) = sp.line.iter().find(|l| rest.starts_with(l.as_bytes())) {
            // `#` comments in shell need a word boundary (`a#b` is a word).
            if !(sp.dollar && *l == "#" && i > 0 && !b[i - 1].is_ascii_whitespace()) {
                let end = memchr(b'\n', b, i).unwrap_or(b.len());
                push(out, base + i, base + end, Role::Comment);
                i = end;
                continue;
            }
        }
        if let Some((open, close)) = sp.block {
            if rest.starts_with(open.as_bytes()) {
                let end = find(b, i + open.len(), close.as_bytes())
                    .map(|e| e + close.len())
                    .unwrap_or(b.len());
                push(out, base + i, base + end, Role::Comment);
                i = end;
                continue;
            }
        }
        if sp.preproc && at_line_start && c == b'#' {
            let end = memchr(b'\n', b, i).unwrap_or(b.len());
            push(out, base + i, base + end, Role::Meta);
            i = end;
            continue;
        }
        if sp.rust && c == b'#' && (rest.starts_with(b"#[") || rest.starts_with(b"#![")) {
            let end = memchr(b']', b, i).map(|e| e + 1).unwrap_or(b.len());
            push(out, base + i, base + end, Role::Meta);
            i = end;
            continue;
        }
        // Strings.
        if sp.triple && (rest.starts_with(b"\"\"\"") || rest.starts_with(b"'''")) {
            let close = &rest[..3];
            let close = [close[0], close[1], close[2]];
            i = string_body(b, base, i, i + 3, &close, true, true, out);
            continue;
        }
        if sp.quotes.contains(&c) {
            if sp.rust && c == b'\'' {
                // handled below as char/lifetime
            } else {
                let multiline = sp.multiline_quotes.contains(&c);
                let escapes = !(sp.dollar && c == b'\'');
                let end = string_body(b, base, i, i + 1, &[c], multiline, escapes, out);
                if sp.key_strings && next_non_space(b, end) == Some(b':') {
                    // Re-tag the whole key (escapes included) as a property.
                    while out.last().is_some_and(|s| s.0 >= base + i) {
                        out.pop();
                    }
                    push(out, base + i, base + end, Role::Property);
                }
                i = end;
                continue;
            }
        }
        if sp.rust && c == b'\'' {
            // 'a' / '\n' are chars; 'a without a closing quote is a lifetime.
            let n = if i + 1 < b.len() {
                char_len(b[i + 1])
            } else {
                1
            };
            if i + 1 < b.len() && b[i + 1] == b'\\' {
                i = string_body(b, base, i, i + 1, b"'", false, true, out);
                continue;
            }
            if i + 1 + n < b.len() && b[i + 1 + n] == b'\'' {
                push(out, base + i, base + i + 2 + n, Role::String);
                i += 2 + n;
                continue;
            }
            let mut e = i + 1;
            while e < b.len() && is_ident(b[e]) {
                e += 1;
            }
            push(out, base + i, base + e.max(i + 1), Role::Type);
            i = e.max(i + 1);
            continue;
        }
        // Numbers.
        if c.is_ascii_digit() || (c == b'.' && rest.get(1).is_some_and(u8::is_ascii_digit)) {
            let mut e = i + 1;
            while e < b.len() {
                let d = b[e];
                let exp_sign = (d == b'+' || d == b'-')
                    && matches!(b[e - 1], b'e' | b'E')
                    && !b[i..e].starts_with(b"0x");
                if is_ident(d)
                    || exp_sign
                    || (d == b'.' && b.get(e + 1).is_some_and(u8::is_ascii_digit))
                {
                    e += 1;
                } else {
                    break;
                }
            }
            push(out, base + i, base + e, Role::Number);
            i = e;
            continue;
        }
        // Variables and decorators.
        if sp.dollar && c == b'$' {
            let mut e = i + 1;
            if b.get(e) == Some(&b'{') {
                e = memchr(b'}', b, e).map(|x| x + 1).unwrap_or(b.len());
            } else {
                while e < b.len() && (is_ident(b[e]) || matches!(b[e], b'@' | b'#' | b'?')) {
                    e += 1;
                    if !is_ident(b[e - 1]) {
                        break;
                    }
                }
            }
            push(out, base + i, base + e, Role::Variable);
            i = e;
            continue;
        }
        if sp.at_meta && c == b'@' && rest.get(1).is_some_and(|&x| is_ident_start(x)) {
            let mut e = i + 1;
            while e < b.len() && (is_ident(b[e]) || b[e] == b'.') {
                e += 1;
            }
            push(out, base + i, base + e, Role::Meta);
            i = e;
            continue;
        }
        // Words.
        if is_ident_start(c) || (c == b'$' && !sp.dollar) {
            let mut e = i + 1;
            while e < b.len() && (is_ident(b[e]) || b[e] == b'$' || (sp.dollar && b[e] == b'-')) {
                e += 1;
            }
            let word = &src[i..e];
            let after = next_non_space(b, e);
            let before = prev_non_space(b, i);
            let role = if contains(sp.keywords, word, sp.nocase) {
                pending = if contains(sp.def_kw, word, false) {
                    Some(Role::Definition)
                } else if contains(sp.class_kw, word, false) {
                    Some(Role::Class)
                } else {
                    None
                };
                Some(Role::Keyword)
            } else if contains(sp.literals, word, sp.nocase) {
                pending = None;
                Some(Role::Literal)
            } else if let Some(p) = pending.take() {
                Some(p)
            } else if contains(sp.types, word, sp.nocase) {
                Some(Role::Type)
            } else if sp.rust && b.get(e) == Some(&b'!') && b.get(e + 1) != Some(&b'=') {
                push(out, base + i, base + e + 1, Role::Function);
                i = e + 1;
                continue;
            } else if after == Some(b'(') {
                Some(Role::Function)
            } else if before == Some(b'.') {
                Some(Role::Property)
            } else if sp.caps_types && word.as_bytes()[0].is_ascii_uppercase() {
                if word.len() > 1 && word.bytes().all(|x| !x.is_ascii_lowercase()) {
                    None // CONSTANTS stay plain
                } else {
                    Some(Role::Type)
                }
            } else if sp.dollar && at_line_start {
                Some(Role::Function) // the command word in a shell line
            } else {
                None
            };
            if let Some(r) = role {
                push(out, base + i, base + e, r);
            }
            i = e;
            continue;
        }
        // Operators and punctuation.
        if b"+-*/%=<>!&|^~?:".contains(&c) {
            push(out, base + i, base + i + 1, Role::Operator);
            i += 1;
            continue;
        }
        if b"()[]{},;.".contains(&c) {
            push(out, base + i, base + i + 1, Role::Punctuation);
            i += 1;
            continue;
        }
        i += char_len(c);
    }
}

fn memchr(needle: u8, b: &[u8], from: usize) -> Option<usize> {
    b[from.min(b.len())..]
        .iter()
        .position(|&x| x == needle)
        .map(|p| p + from)
}
fn find(b: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
    if from > b.len() {
        return None;
    }
    b[from..]
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|p| p + from)
}
fn next_non_space(b: &[u8], from: usize) -> Option<u8> {
    b[from.min(b.len())..]
        .iter()
        .copied()
        .find(|c| *c != b' ' && *c != b'\t')
}
fn prev_non_space(b: &[u8], before: usize) -> Option<u8> {
    b[..before]
        .iter()
        .rev()
        .copied()
        .find(|c| *c != b' ' && *c != b'\t')
}

/// Calls `f(line, offset)` for every line (without its `\n`).
fn lines(src: &str, mut f: impl FnMut(&str, usize)) {
    let mut off = 0;
    for line in src.split('\n') {
        f(line, off);
        off += line.len() + 1;
    }
}

// ---- data formats -----------------------------------------------------------------------------

fn yaml(src: &str, out: &mut Vec<Span>) {
    lines(src, |line, off| {
        let t = line.trim_start();
        let ind = line.len() - t.len();
        if t.starts_with('#') {
            push(out, off + ind, off + line.len(), Role::Comment);
            return;
        }
        if t == "---" || t == "..." {
            push(out, off + ind, off + line.len(), Role::Meta);
            return;
        }
        let mut p = ind;
        if t.starts_with("- ") || t == "-" {
            push(out, off + p, off + p + 1, Role::Punctuation);
            p += 1;
            p += line[p..].len() - line[p..].trim_start().len();
        }
        let rest = &line[p..];
        // `key:` followed by space or end of line.
        if let Some(colon) = key_colon(rest) {
            push(out, off + p, off + p + colon, Role::Property);
            push(out, off + p + colon, off + p + colon + 1, Role::Punctuation);
            p += colon + 1;
        }
        let v = &line[p..];
        let vt = v.trim_start();
        let vp = p + (v.len() - vt.len());
        if vt.starts_with('&') || vt.starts_with('*') || vt.starts_with('!') {
            let e = vt.find(' ').unwrap_or(vt.len());
            push(out, off + vp, off + vp + e, Role::Meta);
            generic(&line[vp + e..], off + vp + e, &VALUE, out);
        } else if vt.starts_with('|') || vt.starts_with('>') {
            push(out, off + vp, off + line.len(), Role::Operator);
        } else {
            generic(v, off + p, &VALUE, out);
        }
    });
}

/// Index of the `:` ending a YAML mapping key at the start of `s`.
fn key_colon(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    if b.first().is_some_and(|c| matches!(c, b'"' | b'\'')) {
        let q = b[0];
        let close = b[1..].iter().position(|&c| c == q)? + 1;
        return (b.get(close + 1) == Some(&b':')).then_some(close + 1);
    }
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b':' if i > 0 && b.get(i + 1).is_none_or(|c| *c == b' ') => return Some(i),
            b'#' | b'{' | b'[' | b'"' | b'\'' => return None,
            _ => i += 1,
        }
    }
    None
}

fn toml(src: &str, out: &mut Vec<Span>) {
    lines(src, |line, off| {
        let t = line.trim_start();
        let ind = line.len() - t.len();
        if t.starts_with('#') {
            push(out, off + ind, off + line.len(), Role::Comment);
            return;
        }
        if t.starts_with('[') {
            let end = t.rfind(']').map(|e| e + 1).unwrap_or(t.len());
            push(out, off + ind, off + ind + end, Role::Heading);
            generic(&t[end..], off + ind + end, &VALUE, out);
            return;
        }
        let eq = t
            .find('=')
            .filter(|&e| !t[..e].contains(['"', '\'']) || t.starts_with(['"', '\'']));
        match eq {
            Some(e) => {
                let key = t[..e].trim_end();
                push(out, off + ind, off + ind + key.len(), Role::Property);
                push(out, off + ind + e, off + ind + e + 1, Role::Operator);
                generic(&t[e + 1..], off + ind + e + 1, &VALUE, out);
            }
            None => generic(t, off + ind, &VALUE, out),
        }
    });
}

fn css(src: &str, out: &mut Vec<Span>) {
    let b = src.as_bytes();
    let mut i = 0;
    let mut depth = 0usize;
    // Inside a declaration value (after `prop:` up to `;`/`}`).
    let mut in_value = false;
    while i < b.len() {
        let c = b[i];
        let rest = &b[i..];
        if rest.starts_with(b"/*") {
            let e = find(b, i + 2, b"*/").map(|e| e + 2).unwrap_or(b.len());
            push(out, i, e, Role::Comment);
            i = e;
            continue;
        }
        if c == b'"' || c == b'\'' {
            i = string_body(b, 0, i, i + 1, &[c], false, true, out);
            continue;
        }
        if c == b'@' {
            let mut e = i + 1;
            while e < b.len() && (is_ident(b[e]) || b[e] == b'-') {
                e += 1;
            }
            push(out, i, e, Role::Keyword);
            i = e;
            continue;
        }
        match c {
            b'{' => {
                depth += 1;
                in_value = false;
                push(out, i, i + 1, Role::Punctuation);
                i += 1;
                continue;
            }
            b'}' => {
                depth = depth.saturating_sub(1);
                in_value = false;
                push(out, i, i + 1, Role::Punctuation);
                i += 1;
                continue;
            }
            b';' => {
                in_value = false;
                push(out, i, i + 1, Role::Punctuation);
                i += 1;
                continue;
            }
            _ => {}
        }
        let word_start = |x: u8| is_ident_start(x) || x == b'-';
        if depth > 0 && !in_value {
            // A property name, or a nested selector (scss).
            if word_start(c) {
                let mut e = i;
                while e < b.len() && (is_ident(b[e]) || b[e] == b'-') {
                    e += 1;
                }
                if next_non_space(b, e) == Some(b':') {
                    push(out, i, e, Role::Property);
                    let colon = memchr(b':', b, e).unwrap();
                    push(out, colon, colon + 1, Role::Punctuation);
                    in_value = true;
                    i = colon + 1;
                } else {
                    push(out, i, e, Role::Tag);
                    i = e;
                }
                continue;
            }
        }
        if depth > 0 && in_value {
            if c == b'#' {
                let mut e = i + 1;
                while e < b.len() && b[e].is_ascii_hexdigit() {
                    e += 1;
                }
                push(out, i, e, Role::Number);
                i = e;
                continue;
            }
            if c.is_ascii_digit() || (c == b'.' && rest.get(1).is_some_and(u8::is_ascii_digit)) {
                let mut e = i + 1;
                while e < b.len() && (b[e].is_ascii_alphanumeric() || b[e] == b'.' || b[e] == b'%')
                {
                    e += 1;
                }
                push(out, i, e, Role::Number);
                i = e;
                continue;
            }
            if word_start(c) {
                let mut e = i;
                while e < b.len() && (is_ident(b[e]) || b[e] == b'-') {
                    e += 1;
                }
                let role = if b.get(e) == Some(&b'(') {
                    Role::Function
                } else if &src[i..e] == "!important" {
                    Role::Keyword
                } else {
                    Role::Literal
                };
                push(out, i, e, role);
                i = e;
                continue;
            }
        }
        // Selectors.
        if c == b'.' || c == b'#' || c == b':' || c == b'&' {
            let mut e = i + 1;
            while e < b.len() && (is_ident(b[e]) || b[e] == b'-' || (c == b':' && b[e] == b':')) {
                e += 1;
            }
            let role = match c {
                b'.' => Role::Class,
                b'#' => Role::Type,
                _ => Role::Meta,
            };
            push(out, i, e, role);
            i = e;
            continue;
        }
        if is_ident_start(c) {
            let mut e = i;
            while e < b.len() && (is_ident(b[e]) || b[e] == b'-') {
                e += 1;
            }
            push(out, i, e, Role::Tag);
            i = e;
            continue;
        }
        if b",>+~*".contains(&c) {
            push(out, i, i + 1, Role::Operator);
        }
        i += char_len(c);
    }
}

fn html(src: &str, out: &mut Vec<Span>) {
    let b = src.as_bytes();
    let mut i = 0;
    while i < b.len() {
        let rest = &b[i..];
        if rest.starts_with(b"<!--") {
            let e = find(b, i + 4, b"-->").map(|e| e + 3).unwrap_or(b.len());
            push(out, i, e, Role::Comment);
            i = e;
            continue;
        }
        if rest.starts_with(b"<!") || rest.starts_with(b"<?") {
            let e = memchr(b'>', b, i).map(|e| e + 1).unwrap_or(b.len());
            push(out, i, e, Role::Meta);
            i = e;
            continue;
        }
        if b[i] == b'&' {
            let e = b[i..].iter().take(12).position(|&c| c == b';');
            if let Some(e) = e {
                push(out, i, i + e + 1, Role::Escape);
                i += e + 1;
                continue;
            }
        }
        if b[i] == b'<' && rest.get(1).is_some_and(|&c| c == b'/' || is_ident_start(c)) {
            let mut p = i + 1;
            if b[p] == b'/' {
                p += 1;
            }
            push(out, i, p, Role::Punctuation);
            let mut e = p;
            while e < b.len() && (is_ident(b[e]) || b[e] == b'-' || b[e] == b':' || b[e] == b'.') {
                e += 1;
            }
            push(out, p, e, Role::Tag);
            i = e;
            // Attributes up to `>`.
            while i < b.len() && b[i] != b'>' {
                let c = b[i];
                if c == b'"' || c == b'\'' {
                    i = string_body(b, 0, i, i + 1, &[c], true, false, out);
                } else if c == b'=' {
                    push(out, i, i + 1, Role::Operator);
                    i += 1;
                } else if c == b'/' {
                    push(out, i, i + 1, Role::Punctuation);
                    i += 1;
                } else if c.is_ascii_whitespace() {
                    i += 1;
                } else {
                    let mut e = i;
                    while e < b.len() && !b[e].is_ascii_whitespace() && !b"=>/\"'".contains(&b[e]) {
                        e += 1;
                    }
                    let e = e.max(i + char_len(c));
                    push(out, i, e, Role::Attribute);
                    i = e;
                }
            }
            if i < b.len() {
                push(out, i, i + 1, Role::Punctuation);
                i += 1;
            }
            continue;
        }
        i += char_len(b[i]);
    }
}

fn markdown(src: &str, out: &mut Vec<Span>) {
    let mut fence: Option<(String, Option<Lang>, usize)> = None;
    lines(src, |line, off| {
        let t = line.trim_start();
        let ind = line.len() - t.len();
        if let Some((marker, lang, body_start)) = &fence {
            if t.starts_with(marker.as_str()) {
                if let Some(l) = lang {
                    let body = &src[*body_start..off.saturating_sub(1).max(*body_start)];
                    for (s, e, r) in lex(body, *l) {
                        push(out, body_start + s, body_start + e, r);
                    }
                } else {
                    push(out, *body_start, off, Role::String);
                }
                push(out, off + ind, off + line.len(), Role::Meta);
                fence = None;
            }
            return;
        }
        if t.starts_with("```") || t.starts_with("~~~") {
            let marker = t[..3].to_string();
            push(out, off + ind, off + line.len(), Role::Meta);
            fence = Some((marker, Lang::detect(&t[3..]), off + line.len() + 1));
            return;
        }
        if t.starts_with('#') {
            push(out, off + ind, off + line.len(), Role::Heading);
            return;
        }
        let mut p = ind;
        if t.starts_with("> ") || t == ">" {
            push(out, off, off + line.len(), Role::Comment);
            return;
        }
        if t.starts_with("- ") || t.starts_with("* ") || t.starts_with("+ ") {
            push(out, off + p, off + p + 1, Role::Punctuation);
            p += 1;
        } else if let Some(d) = t
            .find(". ")
            .filter(|&d| d > 0 && t[..d].bytes().all(|c| c.is_ascii_digit()))
        {
            push(out, off + p, off + p + d + 1, Role::Punctuation);
            p += d + 1;
        }
        md_inline(&line[p..], off + p, out);
    });
    if let Some((_, _, body_start)) = fence {
        if body_start < src.len() {
            push(out, body_start, src.len(), Role::String);
        }
    }
}

fn md_inline(s: &str, base: usize, out: &mut Vec<Span>) {
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'`' => {
                let e = memchr(b'`', b, i + 1).map(|e| e + 1).unwrap_or(b.len());
                push(out, base + i, base + e, Role::String);
                i = e;
            }
            b'*' | b'_' if b.get(i + 1) == Some(&b[i]) => {
                let m = [b[i], b[i]];
                if let Some(e) = find(b, i + 2, &m) {
                    push(out, base + i, base + e + 2, Role::Keyword);
                    i = e + 2;
                } else {
                    i += 2;
                }
            }
            b'[' => {
                let close = memchr(b']', b, i);
                match close {
                    Some(c) if b.get(c + 1) == Some(&b'(') => {
                        let e = memchr(b')', b, c).map(|e| e + 1).unwrap_or(b.len());
                        push(out, base + i, base + c + 1, Role::Link);
                        push(out, base + c + 1, base + e, Role::String);
                        i = e;
                    }
                    _ => i += 1,
                }
            }
            c => i += char_len(c),
        }
    }
}

fn diff(src: &str, out: &mut Vec<Span>) {
    lines(src, |line, off| {
        let role = if line.starts_with("+++")
            || line.starts_with("---")
            || line.starts_with("diff ")
            || line.starts_with("index ")
        {
            Role::Heading
        } else if line.starts_with("@@") {
            Role::Meta
        } else if line.starts_with('+') {
            Role::Inserted
        } else if line.starts_with('-') {
            Role::Deleted
        } else {
            return;
        };
        push(out, off, off + line.len(), role);
    });
}
