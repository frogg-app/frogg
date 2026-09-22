import { describe, expect, test } from "vitest";
import { SessionInboundMessageSchema, type SessionInboundMessage } from "../messages.js";
import type { DeviceRecord } from "../claim-store.js";
import {
  DEVICE_ROLES,
  OWNER_PERMISSIONS,
  SESSION_TRANSPORTS,
  SessionAuthorization,
  defaultRoleForTransport,
  requiredRoleForInbound,
  roleSatisfies,
  type DeviceRole,
} from "./index.js";
import { admissionForPrincipal, resolveAdmissionRole } from "./admission.js";

function inboundTypes(): SessionInboundMessage["type"][] {
  return SessionInboundMessageSchema.options.map((option) => option.shape.type.value);
}

function message(type: SessionInboundMessage["type"]): SessionInboundMessage {
  return { type } as SessionInboundMessage;
}

/** Authority of a device whose credential grants everything, at the given role. */
function sessionAs(role: DeviceRole): SessionAuthorization {
  return new SessionAuthorization(OWNER_PERMISSIONS, role);
}

function device(role: DeviceRole, permissions: DeviceRecord["permissions"] = []): DeviceRecord {
  return {
    id: "cred-1",
    name: "Phone",
    role,
    principalId: "principal-1",
    principalLabel: "Sam",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: null,
    pairedVia: "code",
    permissions,
  };
}

describe("required roles are declared, not inferred", () => {
  test("every inbound RPC declares a role", () => {
    const undeclared = inboundTypes().filter(
      (type) => !DEVICE_ROLES.includes(requiredRoleForInbound(type)),
    );
    expect(undeclared).toEqual([]);
  });

  test("every transport resolves a role without a device credential", () => {
    for (const transport of SESSION_TRANSPORTS) {
      expect(DEVICE_ROLES).toContain(defaultRoleForTransport(transport));
    }
  });

  test("direct, relay and MCP admissions each resolve a role", () => {
    expect(resolveAdmissionRole(admissionForPrincipal({ kind: "trusted" }, "direct"))).toBe(
      "owner",
    );
    expect(resolveAdmissionRole(admissionForPrincipal({ kind: "password" }, "relay"))).toBe(
      "owner",
    );
    expect(resolveAdmissionRole(admissionForPrincipal({ kind: "password" }, "mcp"))).toBe(
      "operator",
    );
    // An agent over MCP drives work but never manages devices.
    expect(
      sessionAs(defaultRoleForTransport("mcp")).allowsInbound(
        message("auth.device.revoke.request"),
      ),
    ).toBe(false);
  });

  test("a paired device's role decides its admission, on any transport", () => {
    for (const role of DEVICE_ROLES) {
      for (const transport of SESSION_TRANSPORTS) {
        const admission = admissionForPrincipal(
          { kind: "device", device: device(role) },
          transport,
        );
        expect(resolveAdmissionRole(admission)).toBe(role);
        expect(admission.device?.credentialId).toBe("cred-1");
      }
    }
  });

  test("a legacy pairing without its own grant keeps full permissions at owner", () => {
    const admission = admissionForPrincipal({ kind: "device", device: device("owner") });
    expect(admission.permissions).toEqual(OWNER_PERMISSIONS);
    expect(resolveAdmissionRole(admission)).toBe("owner");
  });

  test("a device's own grant is not widened by its role", () => {
    const admission = admissionForPrincipal({
      kind: "device",
      device: device("owner", ["workspace.read"]),
    });
    expect(admission.permissions).toEqual(["workspace.read"]);
  });
});

describe("role denials", () => {
  const ownerOnly = [
    "auth.device.set_role.request",
    "auth.device.revoke.request",
    "auth.pairing_code.create.request",
    "auth.settings.update.request",
    "auth.password.set.request",
    "set_daemon_config_request",
    "daemon.update.start.request",
    "provider.account.create.request",
    "shutdown_server_request",
  ] as const;

  const operatorOnly = [
    "terminal_input",
    "send_agent_message_request",
    "create_terminal_request",
    "fs.file.write.request",
    "fs.entry.delete.request",
    "start_workspace_script_request",
    "checkout_push_request",
    "create_agent_request",
  ] as const;

  const readOnly = [
    "fetch_agents_request",
    "fetch_agent_timeline_request",
    "subscribe_terminal_request",
    "file_explorer_request",
    "checkout_status_request",
    "ping",
  ] as const;

  test("a viewer may read and may not act", () => {
    const viewer = sessionAs("viewer");
    for (const type of readOnly) expect(viewer.allowsInbound(message(type))).toBe(true);
    for (const type of operatorOnly) expect(viewer.allowsInbound(message(type))).toBe(false);
    for (const type of ownerOnly) expect(viewer.allowsInbound(message(type))).toBe(false);
  });

  test("a viewer cannot write over the binary channel either", () => {
    // Terminal stdin and file transfer frames are gated on this permission.
    expect(sessionAs("viewer").allowsPermission("workspace.write")).toBe(false);
    expect(sessionAs("operator").allowsPermission("workspace.write")).toBe(true);
  });

  test("an operator may act and may not administer the daemon", () => {
    const operator = sessionAs("operator");
    for (const type of readOnly) expect(operator.allowsInbound(message(type))).toBe(true);
    for (const type of operatorOnly) expect(operator.allowsInbound(message(type))).toBe(true);
    for (const type of ownerOnly) expect(operator.allowsInbound(message(type))).toBe(false);
    expect(operator.allowsPermission("daemon.manage")).toBe(false);
    expect(operator.allowsPermission("access.manage")).toBe(false);
  });

  test("an owner may do everything its permissions allow", () => {
    const owner = sessionAs("owner");
    expect(inboundTypes().every((type) => owner.allowsInbound(message(type)))).toBe(true);
  });

  test("a role never widens the permissions a principal was granted", () => {
    const viewerGrant = new SessionAuthorization(["workspace.read"], "owner");
    expect(viewerGrant.allowsInbound(message("terminal_input"))).toBe(false);
    expect(viewerGrant.allowsInbound(message("auth.device.revoke.request"))).toBe(false);
  });

  test("effective permissions are reported narrowed by role", () => {
    expect(sessionAs("viewer").listPermissions()).not.toContain("workspace.write");
    expect(sessionAs("operator").listPermissions()).not.toContain("access.manage");
    expect(sessionAs("owner").listPermissions()).toEqual([...OWNER_PERMISSIONS]);
  });

  test("roles are ordered owner over operator over viewer", () => {
    expect(roleSatisfies("owner", "operator")).toBe(true);
    expect(roleSatisfies("operator", "viewer")).toBe(true);
    expect(roleSatisfies("operator", "owner")).toBe(false);
    expect(roleSatisfies("viewer", "operator")).toBe(false);
  });
});
