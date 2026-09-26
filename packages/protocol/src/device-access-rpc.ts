import { z } from "zod";

import {
  AuthSettingsSchema,
  ConnectedClientSchema,
  DEVICE_NAME_MAX_LENGTH,
  DeviceCredentialSchema,
  DeviceRoleSchema,
  PendingPairingRequestSchema,
  PresenceReportStateSchema,
  PresenceSnapshotSchema,
  PresenceTargetSchema,
} from "./device-access.js";

/**
 * Session RPCs for per-device access (gated on `features.deviceAccess`) and
 * session presence (gated on `features.sessionPresence`). See device-access.ts.
 */

const ErrorField = z.string().nullable();
const NameField = z.string().min(1).max(DEVICE_NAME_MAX_LENGTH);

// --- devices ---------------------------------------------------------------

export const AuthDeviceListRequestSchema = z.object({
  type: z.literal("auth.device.list.request"),
  requestId: z.string(),
});
export const AuthDeviceListResponseSchema = z.object({
  type: z.literal("auth.device.list.response"),
  payload: z.object({
    requestId: z.string(),
    devices: z.array(DeviceCredentialSchema),
    error: ErrorField,
  }),
});

export const AuthDeviceRenameRequestSchema = z.object({
  type: z.literal("auth.device.rename.request"),
  requestId: z.string(),
  deviceId: z.string().min(1),
  name: NameField,
});
export const AuthDeviceRenameResponseSchema = z.object({
  type: z.literal("auth.device.rename.response"),
  payload: z.object({
    requestId: z.string(),
    device: DeviceCredentialSchema.nullable(),
    error: ErrorField,
  }),
});

/** Revoking closes that device's live connections. Revoking the current device is allowed. */
export const AuthDeviceRevokeRequestSchema = z.object({
  type: z.literal("auth.device.revoke.request"),
  requestId: z.string(),
  deviceId: z.string().min(1),
});
export const AuthDeviceRevokeResponseSchema = z.object({
  type: z.literal("auth.device.revoke.response"),
  payload: z.object({
    requestId: z.string(),
    revoked: z.boolean(),
    error: ErrorField,
  }),
});

// --- pairing codes -----------------------------------------------------------

export const PairingEndpointSchema = z.object({
  host: z.string(),
  port: z.number().int(),
  deepLink: z.string(),
});

export const AuthPairingCodeCreateRequestSchema = z.object({
  type: z.literal("auth.pairing_code.create.request"),
  requestId: z.string(),
  /** Role the redeeming device gets; defaults to operator. Owner requires an owner caller. */
  role: DeviceRoleSchema.optional(),
  /** Clamped to 30..3600; default 600. */
  ttlSeconds: z.number().int().positive().optional(),
});
export const AuthPairingCodeCreateResponseSchema = z.object({
  type: z.literal("auth.pairing_code.create.response"),
  payload: z.object({
    requestId: z.string(),
    code: z.string().nullable(),
    expiresAt: z.string().nullable(),
    role: DeviceRoleSchema.nullable(),
    serverId: z.string(),
    fingerprint: z.string(),
    /** One per reachable host; the first is the best guess. */
    endpoints: z.array(PairingEndpointSchema),
    error: ErrorField,
  }),
});

// --- owner approval ---------------------------------------------------------

export const AuthPairingRequestListRequestSchema = z.object({
  type: z.literal("auth.pairing_request.list.request"),
  requestId: z.string(),
});
export const AuthPairingRequestListResponseSchema = z.object({
  type: z.literal("auth.pairing_request.list.response"),
  payload: z.object({
    requestId: z.string(),
    requests: z.array(PendingPairingRequestSchema),
    error: ErrorField,
  }),
});

export const AuthPairingRequestDecideRequestSchema = z.object({
  type: z.literal("auth.pairing_request.decide.request"),
  requestId: z.string(),
  pairingRequestId: z.string().min(1),
  decision: z.enum(["approve", "deny"]),
  role: DeviceRoleSchema.optional(),
  name: NameField.optional(),
});
export const AuthPairingRequestDecideResponseSchema = z.object({
  type: z.literal("auth.pairing_request.decide.response"),
  payload: z.object({
    requestId: z.string(),
    device: DeviceCredentialSchema.nullable(),
    error: ErrorField,
  }),
});

/** Push to `access.manage` sessions whenever the pending set changes. */
export const AuthPairingRequestUpdateMessageSchema = z.object({
  type: z.literal("auth.pairing_request.update"),
  payload: z.object({ requests: z.array(PendingPairingRequestSchema) }),
});

// --- settings ----------------------------------------------------------------

export const AuthSettingsGetRequestSchema = z.object({
  type: z.literal("auth.settings.get.request"),
  requestId: z.string(),
});
export const AuthSettingsGetResponseSchema = z.object({
  type: z.literal("auth.settings.get.response"),
  payload: z.object({
    requestId: z.string(),
    settings: AuthSettingsSchema.nullable(),
    error: ErrorField,
  }),
});

export const AuthSettingsUpdateRequestSchema = z.object({
  type: z.literal("auth.settings.update.request"),
  requestId: z.string(),
  claimMode: z.boolean().optional(),
  trustLan: z.boolean().optional(),
});
export const AuthSettingsUpdateResponseSchema = z.object({
  type: z.literal("auth.settings.update.response"),
  payload: z.object({
    requestId: z.string(),
    settings: AuthSettingsSchema.nullable(),
    error: ErrorField,
  }),
});

/** `password: null` turns password auth off. Minimum length 8. */
export const AuthPasswordSetRequestSchema = z.object({
  type: z.literal("auth.password.set.request"),
  requestId: z.string(),
  password: z.string().max(1024).nullable(),
});
export const AuthPasswordSetResponseSchema = z.object({
  type: z.literal("auth.password.set.response"),
  payload: z.object({
    requestId: z.string(),
    settings: AuthSettingsSchema.nullable(),
    error: ErrorField,
  }),
});

// --- presence ------------------------------------------------------------------

/** Clients re-report `viewing` at least every 30s; entries expire after 90s. */
export const PresenceReportRequestSchema = z.object({
  type: z.literal("presence.report.request"),
  requestId: z.string(),
  target: PresenceTargetSchema,
  state: PresenceReportStateSchema,
  /**
   * COMPAT(connectedClients): added in v1.5.51. The name this client wants to
   * be shown under, so renaming yourself does not need a reconnect. Ignored
   * for paired devices, whose name belongs to the device record.
   */
  deviceName: z.string().max(120).optional(),
});
export const PresenceReportResponseSchema = z.object({
  type: z.literal("presence.report.response"),
  payload: z.object({ requestId: z.string(), error: ErrorField }),
});

export const PresenceGetRequestSchema = z.object({
  type: z.literal("presence.get.request"),
  requestId: z.string(),
  target: PresenceTargetSchema,
});
export const PresenceGetResponseSchema = z.object({
  type: z.literal("presence.get.response"),
  payload: z.object({
    requestId: z.string(),
    snapshot: PresenceSnapshotSchema,
    error: ErrorField,
  }),
});

/** Pushed to every session when a target's participants or activity change. */
export const PresenceUpdateMessageSchema = z.object({
  type: z.literal("presence.update"),
  payload: PresenceSnapshotSchema,
});

/** Every client connected right now. Any session that may read workspaces may ask. */
export const PresenceListConnectionsRequestSchema = z.object({
  type: z.literal("presence.list_connections.request"),
  requestId: z.string(),
});
export const PresenceListConnectionsResponseSchema = z.object({
  type: z.literal("presence.list_connections.response"),
  payload: z.object({
    requestId: z.string(),
    connections: z.array(ConnectedClientSchema),
    error: ErrorField,
  }),
});

export type PresenceListConnectionsResponse = z.infer<typeof PresenceListConnectionsResponseSchema>;
export type AuthDeviceListResponse = z.infer<typeof AuthDeviceListResponseSchema>;
export type AuthDeviceRenameResponse = z.infer<typeof AuthDeviceRenameResponseSchema>;
export type AuthDeviceRevokeResponse = z.infer<typeof AuthDeviceRevokeResponseSchema>;
export type AuthPairingCodeCreateResponse = z.infer<typeof AuthPairingCodeCreateResponseSchema>;
export type AuthPairingRequestListResponse = z.infer<typeof AuthPairingRequestListResponseSchema>;
export type AuthPairingRequestDecideResponse = z.infer<
  typeof AuthPairingRequestDecideResponseSchema
>;
export type AuthPairingRequestUpdateMessage = z.infer<typeof AuthPairingRequestUpdateMessageSchema>;
export type AuthSettingsGetResponse = z.infer<typeof AuthSettingsGetResponseSchema>;
export type AuthSettingsUpdateResponse = z.infer<typeof AuthSettingsUpdateResponseSchema>;
export type AuthPasswordSetResponse = z.infer<typeof AuthPasswordSetResponseSchema>;
export type PresenceReportResponse = z.infer<typeof PresenceReportResponseSchema>;
export type PresenceGetResponse = z.infer<typeof PresenceGetResponseSchema>;
export type PresenceUpdateMessage = z.infer<typeof PresenceUpdateMessageSchema>;
