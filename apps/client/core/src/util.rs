//! Small helpers shared across modules: ids, URL query encoding.

pub fn uuid_v4() -> Result<String, crate::crypto::CryptoError> {
    let mut b = crate::crypto::random_bytes::<16>()?;
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    ))
}

/// `application/x-www-form-urlencoded` value encoding, as `URLSearchParams` writes it.
pub fn encode_query_value(value: &str) -> String {
    let mut out = String::new();
    for b in value.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'*' | b'-' | b'.' | b'_' => {
                out.push(b as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

pub fn decode_query_value(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len()
                && bytes[i + 1].is_ascii_hexdigit()
                && bytes[i + 2].is_ascii_hexdigit() =>
            {
                let hex = [bytes[i + 1], bytes[i + 2]];
                out.push(u8::from_str_radix(std::str::from_utf8(&hex).unwrap(), 16).unwrap());
                i += 2;
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Parses a query string (no leading `?`) like `URLSearchParams`; first value wins in `get`.
pub fn parse_query(query: &str) -> Vec<(String, String)> {
    query
        .split('&')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let (k, v) = p.split_once('=').unwrap_or((p, ""));
            (decode_query_value(k), decode_query_value(v))
        })
        .collect()
}

pub fn query_get<'a>(params: &'a [(String, String)], key: &str) -> Option<&'a str> {
    params
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uuid_shape() {
        let u = uuid_v4().unwrap();
        assert_eq!(u.len(), 36);
        assert_eq!(&u[14..15], "4");
    }

    #[test]
    fn query_round_trip() {
        let v = "a b&c=d/é";
        assert_eq!(decode_query_value(&encode_query_value(v)), v);
        let q = parse_query("x=1&name=My+Box&e=%41");
        assert_eq!(query_get(&q, "name"), Some("My Box"));
        assert_eq!(query_get(&q, "e"), Some("A"));
        assert_eq!(decode_query_value("100%"), "100%");
    }
}
