//! Why a host refuses this app, in words (ui-next `hosts/access.ts`).

use frogg_client_core::ErrorInfo;

/// The Frogg Next CLI on the host (ui-next `daemon/next-daemon.ts` `NEXT_CLI`).
pub const NEXT_CLI: &str = "frogg-next";

/// Installs the Frogg Next daemon (`NEXT_INSTALL_COMMAND`); pinned to the latest release here
/// since this client's version is not a daemon release tag.
pub const NEXT_INSTALL_COMMAND: &str =
    "curl -fsSL https://github.com/frogg-app/frogg/releases/latest/download/install.sh | bash";

/// Only an owner device may mint pairing codes or offers.
pub fn pairing_error_text(raw: &str, role: Option<&str>) -> String {
    if raw.contains("not authorized for auth.pairing_code.create")
        || raw.contains("not authorized for daemon.get_pairing_offer")
    {
        if let Some(r) = role.filter(|r| *r != "owner") {
            let a = if r == "operator" { "an" } else { "a" };
            return format!("Only an owner device can pair new devices, and this app is registered as {a} {r}. Ask an owner to change its role, or pair from an owner device.");
        }
        return "This host only hands out pairing codes to an owner device, and this app reaches it without a device credential. Edit this host and add the daemon password, or pair from a device that is already an owner.".to_owned();
    }
    if raw.contains("Only an owner device") {
        return "Only an owner device can create owner codes.".to_owned();
    }
    raw.to_owned()
}

/// How this device is registered on the daemon, when it is not a regular pairing.
pub fn registered_via(paired_via: Option<&str>) -> Option<&'static str> {
    match paired_via {
        Some("password") => Some("signed in with the daemon password"),
        Some("local") => Some("local to the host"),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefusalKind {
    Unclaimed,
    Missing,
    Rejected,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AuthRefusal {
    pub kind: RefusalKind,
    pub title: String,
    pub body: String,
    /// Label of the pairing action that fixes it.
    pub action: &'static str,
}

/// Why the daemon refused this app (WS close 4401), from its close reason.
pub fn auth_refusal(error: Option<&ErrorInfo>) -> Option<AuthRefusal> {
    let Some(ErrorInfo::PairingRequired {
        credential_rejected,
        reason,
    }) = error
    else {
        return None;
    };
    if *credential_rejected {
        let why = if reason.is_empty() {
            "rejected"
        } else {
            reason.as_str()
        };
        return Some(AuthRefusal {
            kind: RefusalKind::Rejected,
            title: "The host turned this app away".to_owned(),
            body: format!("It refused the saved credential ({why}): the device was revoked, or the password changed. Pair again, or enter the current password."),
            action: "Pair again…",
        });
    }
    if reason.to_lowercase().contains("pairing required") {
        return Some(AuthRefusal {
            kind: RefusalKind::Unclaimed,
            title: "This host isn't claimed yet".to_owned(),
            body: format!("No device owns this daemon, and it only admits registered devices. Run `{NEXT_CLI} daemon pair` (`frogg daemon pair` on a stable daemon) on the host and paste the link or code here to claim it as owner."),
            action: "Pair this app…",
        });
    }
    Some(AuthRefusal {
        kind: RefusalKind::Missing,
        title: "This app isn't paired with this host".to_owned(),
        body: "The daemon only admits registered devices, from any network. Pair this app with a code from an owner device, or add the daemon password to this host.".to_owned(),
        action: "Pair this app…",
    })
}

/// A different daemon answers at the saved address: (expected, actual) server ids.
pub fn identity_mismatch(error: Option<&ErrorInfo>) -> Option<(String, String)> {
    match error {
        Some(ErrorInfo::ServerIdentityMismatch {
            expected_server_id,
            actual_server_id,
        }) => Some((expected_server_id.clone(), actual_server_id.clone())),
        _ => None,
    }
}

/// Why a host is not connected, in one line.
pub fn offline_reason(error: Option<&ErrorInfo>, reason: Option<&str>) -> String {
    if let Some(r) = auth_refusal(error) {
        return r.title;
    }
    if identity_mismatch(error).is_some() {
        return "A different daemon is answering at this address".to_owned();
    }
    reason
        .filter(|r| !r.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| "No answer from the daemon".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_errors() {
        let raw = "not authorized for auth.pairing_code.create";
        assert!(pairing_error_text(raw, Some("operator")).contains("an operator"));
        assert!(pairing_error_text(raw, None).contains("daemon password"));
        assert_eq!(pairing_error_text("boom", None), "boom");
    }

    #[test]
    fn refusals() {
        let unclaimed = ErrorInfo::PairingRequired {
            credential_rejected: false,
            reason: "Pairing required".to_owned(),
        };
        let r = auth_refusal(Some(&unclaimed)).unwrap();
        assert_eq!(r.kind, RefusalKind::Unclaimed);
        assert!(r.body.contains("frogg-next daemon pair"));
        let rejected = ErrorInfo::PairingRequired {
            credential_rejected: true,
            reason: String::new(),
        };
        assert_eq!(
            auth_refusal(Some(&rejected)).unwrap().kind,
            RefusalKind::Rejected
        );
        let missing = ErrorInfo::PairingRequired {
            credential_rejected: false,
            reason: "no token".to_owned(),
        };
        assert_eq!(
            auth_refusal(Some(&missing)).unwrap().kind,
            RefusalKind::Missing
        );
        assert_eq!(offline_reason(None, None), "No answer from the daemon");
        let mm = ErrorInfo::ServerIdentityMismatch {
            expected_server_id: "a".to_owned(),
            actual_server_id: "b".to_owned(),
        };
        assert!(offline_reason(Some(&mm), None).starts_with("A different daemon"));
    }
}
