//! Which proxied HTTP routes need a bearer and which role they need, mirroring
//! `shouldBypassBearerAuth` and `requiredRoleForHttpRoute` in `server/auth.ts`.

use crate::auth::Role;

/// Public or self-authenticating: `PUBLIC_ROUTES` + `SELF_AUTHENTICATING_ROUTES`.
const BEARER_FREE: [&str; 8] = [
    "/api/health",
    "/api/identity",
    "/api/identity/proof",
    "/api/setup/status",
    "/api/setup/claim",
    "/api/setup/request",
    "/api/auth/login",
    "/api/files/download",
];

pub fn bypasses_bearer(method: &str, path: &str) -> bool {
    method == "OPTIONS" || path.starts_with("/api/setup/request/") || BEARER_FREE.contains(&path)
}

/// `HTTP_ROUTE_ROLE`; anything unlisted needs an operator.
pub fn required_role(path: &str) -> Role {
    match path {
        "/api/status" | "/api/files/download" => Role::Viewer,
        // Mints an owner credential, so only an owner may ask for one.
        "/api/setup/offer" => Role::Owner,
        _ => Role::Operator,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_and_discovery_routes_are_bearer_free() {
        assert!(bypasses_bearer("GET", "/api/setup/status"));
        assert!(bypasses_bearer("POST", "/api/setup/request/abc"));
        assert!(bypasses_bearer("OPTIONS", "/api/anything"));
        assert!(!bypasses_bearer("POST", "/api/setup/offer"));
    }

    #[test]
    fn minting_an_offer_needs_an_owner() {
        assert_eq!(required_role("/api/setup/offer"), Role::Owner);
        assert_eq!(required_role("/api/status"), Role::Viewer);
        assert_eq!(required_role("/api/whatever"), Role::Operator);
    }
}
