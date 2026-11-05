//! Syntax highlighting in pure Rust: a small hand-written tokenizer per language family,
//! emitting the same roles as `@frogg/highlight` (`packages/highlight/src/syntax-roles.ts`).
//!
//! Chosen over syntect (bundled syntax dumps plus fancy-regex) and tree-sitter (C grammars, no
//! clean wasm32-unknown-unknown build) because it adds tens of KB to the wasm rather than
//! megabytes; the colours are CSS classes (`tk-<role>`) mapped to the theme's syntax tokens.

mod lexer;

pub use lexer::Lang;

/// A highlight role; its CSS class is `tk-<name>`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Role {
    Keyword,
    Comment,
    String,
    Number,
    Literal,
    Function,
    Definition,
    Class,
    Type,
    Tag,
    Attribute,
    Property,
    Variable,
    Operator,
    Punctuation,
    Regexp,
    Escape,
    Meta,
    Heading,
    Link,
    /// Diff additions and removals (the diff language only).
    Inserted,
    Deleted,
}

impl Role {
    pub fn name(self) -> &'static str {
        match self {
            Role::Keyword => "keyword",
            Role::Comment => "comment",
            Role::String => "string",
            Role::Number => "number",
            Role::Literal => "literal",
            Role::Function => "function",
            Role::Definition => "definition",
            Role::Class => "class",
            Role::Type => "type",
            Role::Tag => "tag",
            Role::Attribute => "attribute",
            Role::Property => "property",
            Role::Variable => "variable",
            Role::Operator => "operator",
            Role::Punctuation => "punctuation",
            Role::Regexp => "regexp",
            Role::Escape => "escape",
            Role::Meta => "meta",
            Role::Heading => "heading",
            Role::Link => "link",
            Role::Inserted => "inserted",
            Role::Deleted => "deleted",
        }
    }

    pub fn class(self) -> &'static str {
        match self {
            Role::Keyword => "tk-keyword",
            Role::Comment => "tk-comment",
            Role::String => "tk-string",
            Role::Number => "tk-number",
            Role::Literal => "tk-literal",
            Role::Function => "tk-function",
            Role::Definition => "tk-definition",
            Role::Class => "tk-class",
            Role::Type => "tk-type",
            Role::Tag => "tk-tag",
            Role::Attribute => "tk-attribute",
            Role::Property => "tk-property",
            Role::Variable => "tk-variable",
            Role::Operator => "tk-operator",
            Role::Punctuation => "tk-punctuation",
            Role::Regexp => "tk-regexp",
            Role::Escape => "tk-escape",
            Role::Meta => "tk-meta",
            Role::Heading => "tk-heading",
            Role::Link => "tk-link",
            Role::Inserted => "tk-inserted",
            Role::Deleted => "tk-deleted",
        }
    }
}

/// One run of text with its role (`None` is plain text).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Token {
    pub text: String,
    pub role: Option<Role>,
}

/// Highlights `code` for a language name, alias or file name/path, one token list per line.
/// Unknown languages come back as one plain token per line.
pub fn highlight(code: &str, lang_or_path: &str) -> Vec<Vec<Token>> {
    let lang = Lang::detect(lang_or_path);
    let spans = match lang {
        Some(l) => lexer::lex(code, l),
        None => Vec::new(),
    };
    split_lines(code, &spans)
}

/// Splits flat `(start, end, role)` spans over `code` into per-line tokens; gaps are plain.
fn split_lines(code: &str, spans: &[(usize, usize, Role)]) -> Vec<Vec<Token>> {
    let mut lines: Vec<Vec<Token>> = vec![Vec::new()];
    let push = |lines: &mut Vec<Vec<Token>>, text: &str, role: Option<Role>| {
        let mut parts = text.split('\n');
        if let Some(first) = parts.next() {
            if !first.is_empty() {
                lines.last_mut().unwrap().push(Token {
                    text: first.into(),
                    role,
                });
            }
        }
        for part in parts {
            lines.push(Vec::new());
            if !part.is_empty() {
                lines.last_mut().unwrap().push(Token {
                    text: part.into(),
                    role,
                });
            }
        }
    };
    let mut pos = 0;
    for &(s, e, role) in spans {
        if s > pos {
            push(&mut lines, &code[pos..s], None);
        }
        push(&mut lines, &code[s..e], Some(role));
        pos = e;
    }
    if pos < code.len() {
        push(&mut lines, &code[pos..], None);
    }
    lines
}

#[cfg(test)]
mod tests;
