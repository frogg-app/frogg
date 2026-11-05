//! `$FROGG_HOME/local-token`, created the way `packages/server/src/server/local-token.ts`
//! creates it (`flt1.` + 32 random bytes, base64url, mode 0600, written atomically). The
//! supervised front creates it before the worker starts so loopback clients (the CLI, the
//! bench) can authenticate against the front from its first connection; the worker's
//! `ensure()` then reuses it.

use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;

const FILENAME: &str = "local-token";

pub fn ensure(home: &Path) -> std::io::Result<String> {
    let path = home.join(FILENAME);
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let existing = existing.trim();
        if !existing.is_empty() {
            return Ok(existing.to_string());
        }
    }
    let token = format!("flt1.{}", base64url(&random_bytes()?));
    let tmp = home.join(format!("{FILENAME}.{}.tmp", std::process::id()));
    {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)?;
        file.write_all(format!("{token}\n").as_bytes())?;
        file.sync_all()?;
    }
    std::fs::rename(&tmp, &path)?;
    Ok(token)
}

fn random_bytes() -> std::io::Result<[u8; 32]> {
    use std::io::Read;
    let mut bytes = [0u8; 32];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes)
}

fn base64url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16
            | (*chunk.get(1).unwrap_or(&0) as u32) << 8
            | *chunk.get(2).unwrap_or(&0) as u32;
        let chars = chunk.len() + 1;
        for i in 0..chars {
            out.push(ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_base64url_without_padding() {
        assert_eq!(base64url(b""), "");
        assert_eq!(base64url(b"f"), "Zg");
        assert_eq!(base64url(b"fo"), "Zm8");
        assert_eq!(base64url(b"foo"), "Zm9v");
        assert_eq!(base64url(&[0xfb, 0xff]), "-_8");
    }

    #[test]
    fn creates_a_private_token_once() {
        use std::os::unix::fs::PermissionsExt;
        let home = std::env::temp_dir().join(format!("frogg-local-token-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).unwrap();
        let first = ensure(&home).unwrap();
        assert!(first.starts_with("flt1.") && first.len() == 5 + 43);
        assert_eq!(ensure(&home).unwrap(), first);
        let mode = std::fs::metadata(home.join(FILENAME))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
