//! Messages one agent sends another arrive as user messages with a sender prefix (ui-next
//! `chat/relay.ts`):
//!   From Google Suite agent (cf989ce): …
//!   From the "Frogg Plugin: Google Suite" agent (cf989ce, worktree ~/.frogg/worktrees/…): …
//! And images written into a user message as markdown (`splitImages`).

#[derive(Debug, Clone, PartialEq)]
pub struct Relay {
    pub name: String,
    /// Short agent id (a prefix of the sender's id).
    pub id: String,
    /// Anything after the id inside the parentheses.
    pub place: Option<String>,
    pub body: String,
}

pub fn parse_relay(text: &str) -> Option<Relay> {
    let t = text.trim_start();
    let rest = t.strip_prefix("From ")?;
    let rest = rest.strip_prefix("the ").unwrap_or(rest);
    let quote = rest.chars().next().and_then(|c| match c {
        '"' => Some(('"', '"')),
        '“' => Some(('“', '”')),
        '\'' => Some(('\'', '\'')),
        _ => None,
    });
    let (name, rest) = if let Some((open, close)) = quote {
        let inner = &rest[open.len_utf8()..];
        let end = inner.find(close)?;
        let name = &inner[..end];
        if name.contains('\n') {
            return None;
        }
        (
            name,
            inner[end + close.len_utf8()..].strip_prefix(" agent (")?,
        )
    } else {
        let at = rest.find(" agent (")?;
        let name = &rest[..at];
        if name.is_empty() || name.contains(['\n', '(', ')']) {
            return None;
        }
        (name, &rest[at + " agent (".len()..])
    };
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    let id_end = rest
        .find(|c: char| !(c.is_alphanumeric() || c == '_' || c == '-'))
        .unwrap_or(rest.len());
    let id = &rest[..id_end];
    if id.chars().count() < 4 {
        return None;
    }
    let rest = &rest[id_end..];
    let (place, rest) = if let Some(r) = rest.strip_prefix(',') {
        let end = r.find(')')?;
        let w = &r[..end];
        if w.contains('\n') {
            return None;
        }
        (Some(w.trim()), &r[end..])
    } else {
        (None, rest)
    };
    let rest = rest.strip_prefix("):")?;
    let rest = rest.trim_start_matches([' ', '\t']);
    let body = rest.strip_prefix('\n').unwrap_or(rest);
    Some(Relay {
        name: name.to_owned(),
        id: id.to_owned(),
        place: place.filter(|w| !w.is_empty()).map(str::to_owned),
        body: body.to_owned(),
    })
}

/// The session whose id starts with the relay's short id, when exactly one does.
pub fn resolve_sender<'a>(id: &str, ids: impl IntoIterator<Item = &'a str>) -> Option<String> {
    let want = id.to_lowercase();
    let mut hit = None;
    for x in ids {
        if !x.to_lowercase().starts_with(&want) {
            continue;
        }
        if hit.is_some() {
            return None;
        }
        hit = Some(x.to_owned());
    }
    hit
}

#[derive(Debug, Clone, PartialEq)]
pub enum Piece {
    Text(String),
    Img { alt: String, src: String },
}

fn image_at(text: &str, at: usize) -> Option<(String, String, usize)> {
    let r = &text[at + 2..];
    let a = r.find("](")?;
    let alt = &r[..a];
    if alt.contains(['\n', ']']) {
        return None;
    }
    let r2 = &r[a + 2..];
    let b = r2.find(')')?;
    let src = &r2[..b];
    if src.is_empty() || src.contains(char::is_whitespace) {
        return None;
    }
    Some((alt.to_owned(), src.to_owned(), at + 2 + a + 2 + b + 1))
}

/// Splits `![alt](src)` images out of a user message's text.
pub fn split_images(text: &str) -> Vec<Piece> {
    let mut out = Vec::new();
    let mut pos = 0;
    let mut from = 0;
    while let Some(i) = text[from..].find("![") {
        let at = from + i;
        match image_at(text, at) {
            Some((alt, src, end)) => {
                if !text[pos..at].trim().is_empty() {
                    out.push(Piece::Text(text[pos..at].to_owned()));
                }
                out.push(Piece::Img { alt, src });
                pos = end;
                from = end;
            }
            None => from = at + 2,
        }
    }
    if !text[pos..].trim().is_empty() || out.is_empty() {
        out.push(Piece::Text(text[pos..].to_owned()));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relay_plain_and_quoted() {
        let r = parse_relay("From Google Suite agent (cf989ce): hi there").unwrap();
        assert_eq!(r.name, "Google Suite");
        assert_eq!(r.id, "cf989ce");
        assert_eq!(r.place, None);
        assert_eq!(r.body, "hi there");
        let r = parse_relay(
            "From the \"Frogg Plugin: Google Suite\" agent (cf989ce, worktree ~/x):\nbody",
        )
        .unwrap();
        assert_eq!(r.name, "Frogg Plugin: Google Suite");
        assert_eq!(r.place.as_deref(), Some("worktree ~/x"));
        assert_eq!(r.body, "body");
        assert!(parse_relay("From me: hello").is_none());
        assert!(parse_relay("From x agent (ab): y").is_none());
    }

    #[test]
    fn sender_is_unique_prefix() {
        let ids = ["abc123", "abd999", "abc777"];
        assert_eq!(resolve_sender("abd", ids), Some("abd999".into()));
        assert_eq!(resolve_sender("abc", ids), None);
    }

    #[test]
    fn images_split_out() {
        let p = split_images("look ![shot](data:x) done");
        assert_eq!(
            p,
            vec![
                Piece::Text("look ".into()),
                Piece::Img {
                    alt: "shot".into(),
                    src: "data:x".into()
                },
                Piece::Text(" done".into()),
            ]
        );
        assert_eq!(split_images("plain"), vec![Piece::Text("plain".into())]);
    }
}
