import { z } from "zod";

const slug = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  .max(48);
const text = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine(
    (value) => [...value].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127),
    "Control characters are not allowed",
  );
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const url = z.url().refine((value) => {
  const parsed = new URL(value);
  return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
}, "Expected an HTTP(S) URL without credentials");
const palette = z.strictObject({
  accent: color,
  accentForeground: color,
  background: color,
  foreground: color,
  accentBright: color.optional(),
});
const assetPath = z.string().min(1);
/** Windows installer copy: `{name}` expands to the brand name. */
const installerCopy = text.max(80);
const installer = z.strictObject({
  tagline: installerCopy.optional(),
  colors: z
    .strictObject({
      background: color.optional(),
      surface: color.optional(),
      foreground: color.optional(),
      mutedForeground: color.optional(),
      accent: color.optional(),
      accentBright: color.optional(),
      success: color.optional(),
      danger: color.optional(),
    })
    .optional(),
  copy: z
    .strictObject({
      installing: installerCopy.optional(),
      migrating: installerCopy.optional(),
      ready: installerCopy.optional(),
      launching: installerCopy.optional(),
      elevationRequired: text.max(240).optional(),
    })
    .optional(),
});

/**
 * Host settings sections a brand may hide. Mirrors HOST_SECTION_SLUGS in the
 * client (apps/ui/src/utils/host-routes.ts), which a test there keeps in step:
 * branding is built before the app and cannot import it.
 */
export const HOST_SETTINGS_SECTIONS = [
  "projects",
  "pair-device",
  "devices",
  "agents",
  "providers",
  // Retired: folded into Providers. Still accepted so existing brand.json and
  // config.json files parse; the app ignores it.
  "usage",
  "terminals",
  "host",
] as const;

/** Provider or model id pattern; `*` matches any run of characters. */
const idPattern = z
  .string()
  .regex(/^[A-Za-z0-9*][A-Za-z0-9._:/@*-]*$/)
  .max(160);
const modelPolicy = z.strictObject({
  allow: z.array(idPattern).optional(),
  deny: z.array(idPattern).optional(),
});

const applicationId = z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,}$/);
const daemonPort = z.number().int().min(1024).max(65535);

/** The release channels a distribution ships. Each one installs beside the others. */
export const RELEASE_CHANNELS = ["stable", "beta"] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

/**
 * Identity overrides for the beta channel build. Every field is optional: by default the beta
 * build derives a separate identity from the stable one (`<id>-beta`, `<applicationId>.beta`,
 * the next port down, `~/.<id>-beta`, ...) so both install side by side on one machine, and its
 * icons carry a "beta" badge.
 */
const channelOverrides = z.strictObject({
  name: text.optional(),
  fullName: text.optional(),
  applicationId: applicationId.optional(),
  daemonPort: daemonPort.optional(),
  cliName: slug.optional(),
  desktopBinaryName: slug.optional(),
  homeDir: z
    .string()
    .regex(/^\.[a-z][a-z0-9-]*$/)
    .optional(),
  envPrefix: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .optional(),
  scheme: slug.optional(),
  serviceName: slug.optional(),
  launchdLabel: z
    .string()
    .regex(/^[a-z][a-z0-9.-]*$/)
    .optional(),
  artifactPrefix: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9-]*$/)
    .optional(),
  /** Overlay a "beta" badge on the generated icons. Default true. */
  badge: z.boolean().optional(),
});

export const BrandManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: slug,
  name: text,
  applicationId,
  daemonPort,
  fullName: text.optional(),
  description: text.optional(),
  publisher: text.optional(),
  cliName: slug.optional(),
  desktopBinaryName: slug.optional(),
  homeDir: z
    .string()
    .regex(/^\.[a-z][a-z0-9-]*$/)
    .optional(),
  envPrefix: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .optional(),
  scheme: slug.optional(),
  serviceName: slug.optional(),
  launchdLabel: z
    .string()
    .regex(/^[a-z][a-z0-9.-]*$/)
    .optional(),
  artifactPrefix: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9-]*$/)
    .optional(),
  assets: z.strictObject({
    icon: assetPath,
    ios: assetPath.optional(),
    foreground: assetPath.optional(),
    notification: assetPath.optional(),
    splash: assetPath.optional(),
    faviconLight: assetPath.optional(),
    faviconDark: assetPath.optional(),
  }),
  colors: z.strictObject({ light: palette.optional(), dark: palette.optional() }).optional(),
  installer: installer.optional(),
  links: z
    .strictObject({
      website: url.optional(),
      support: url.optional(),
      docs: url.optional(),
      source: url.optional(),
      installer: url.optional(),
    })
    .optional(),
  services: z
    .strictObject({
      pairingUrl: url.optional(),
      allowedOrigins: z.array(url).optional(),
    })
    .optional(),
  distribution: z
    .strictObject({
      repository: z
        .string()
        .regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)
        .optional(),
      updates: z.enum(["disabled", "github-release", "tauri-signed"]).optional(),
      updaterPublicKey: z.string().min(1).optional(),
      dockerImage: z
        .string()
        .regex(/^[a-z0-9][a-z0-9./_-]*$/)
        .optional(),
      pairingImage: z
        .string()
        .regex(/^[a-z0-9][a-z0-9./_-]*$/)
        .optional(),
      iosStoreId: z.string().regex(/^\d+$/).optional(),
      expoProjectId: z.uuid().optional(),
    })
    .optional(),
  pairing: z
    .strictObject({
      // Pair a loopback `pair/direct` link that carries a pairing code without
      // the confirmation click, once the daemon has proved its key.
      autoConfirmLocal: z.boolean().optional(),
    })
    .optional(),
  projects: z
    .strictObject({
      defaultDirectory: z.string().min(1).optional(),
    })
    .optional(),
  hostSettings: z
    .strictObject({
      hiddenSections: z.array(z.enum(HOST_SETTINGS_SECTIONS)).optional(),
    })
    .optional(),
  daemon: z
    .strictObject({
      bind: z.enum(["all", "loopback"]).optional(),
      // Where workspace dev servers listen. Loopback for every brand unless a
      // manifest opts into the wide bind; reach them from another device
      // through the authenticated service proxy instead.
      workspaceServicesBind: z.enum(["all", "loopback"]).optional(),
      claimMode: z.boolean().optional(),
      // Treat private-network clients like loopback. Upstream default true;
      // any other brand defaults false.
      trustLan: z.boolean().optional(),
      // Who may claim an unclaimed daemon in claim mode: any reachable client,
      // or only a loopback client holding the daemon's local token.
      claimScope: z.enum(["any", "local"]).optional(),
      // Background checks for newer provider CLI releases. Default true.
      providerUpdateChecks: z.boolean().optional(),
    })
    .optional(),
  providers: z
    .strictObject({
      // Every provider id this build may run: builtins, derived profiles and
      // custom ACP entries alike. Omitted = no restriction.
      allowed: z.array(slug).min(1).optional(),
      // Per-provider model allow/deny patterns, matched against model ids.
      models: z.record(slug, modelPolicy).optional(),
    })
    .optional(),
  mobile: z.strictObject({ enabled: z.boolean().optional() }).optional(),
  channels: z.strictObject({ beta: channelOverrides.optional() }).optional(),
});
export type BrandManifest = z.infer<typeof BrandManifestSchema>;

export interface ResolveBrandOptions {
  /** Which build of the distribution to resolve. Default "stable". */
  channel?: ReleaseChannel;
}

export function resolveBrandManifest(input: unknown, options: ResolveBrandOptions = {}) {
  const base = BrandManifestSchema.parse(input);
  const channel = options.channel ?? "stable";
  // Behaviour follows the product, identity follows the channel: frogg beta keeps upstream
  // frogg's open defaults and theme, but installs under its own names beside frogg.
  const stock = base.id === "frogg";
  const manifest = channel === "beta" ? betaManifest(base) : base;
  const distribution = resolveDistribution(manifest);
  const repository = distribution.repository;
  const light = manifest.colors?.light ?? {
    accent: "#525252",
    accentForeground: "#ffffff",
    background: "#fafafa",
    foreground: "#171717",
  };
  const dark = manifest.colors?.dark ?? {
    accent: "#a3a3a3",
    accentForeground: "#171717",
    background: "#171717",
    foreground: "#fafafa",
  };
  for (const [appearance, values] of Object.entries({ light, dark })) {
    if (
      contrast(values.accent, values.accentForeground) < 4.5 ||
      contrast(values.background, values.foreground) < 4.5
    ) {
      throw new Error(`${appearance} brand colors require text contrast of at least 4.5:1`);
    }
  }
  return {
    ...resolveIdentity(manifest),
    colors: {
      light: { ...light, accentBright: light.accentBright ?? light.accent },
      dark: { ...dark, accentBright: dark.accentBright ?? dark.accent },
    },
    ...resolveLinksAndServices(manifest, repository),
    installer: resolveInstaller(manifest, dark),
    distribution,
    pairing: resolvePairing(manifest),
    projects: resolveProjects(manifest),
    hostSettings: resolveHostSettings(manifest),
    daemon: resolveDaemonDefaults(manifest, stock),
    providers: resolveProviders(manifest, stock),
    // "Does this brand ship a mobile app". Today the only consumer is the CLI,
    // which stops printing a pairing QR nobody could scan; nothing else in the
    // daemon or the apps reads it.
    mobile: { enabled: manifest.mobile?.enabled ?? true },
    channel,
    /** Built from the upstream frogg brand, whichever channel. Selects frogg's own theme. */
    stockFrogg: stock,
    /** Overlay the beta badge on generated icons. */
    channelBadge: channel === "beta" && (base.channels?.beta?.badge ?? true),
    /** Every channel's install identity, so each build can point at its siblings. */
    channels: {
      stable: channelSummary(base),
      beta: channelSummary(betaManifest(base)),
    },
  };
}

function channelSummary(manifest: BrandManifest) {
  const identity = resolveIdentity(manifest);
  return {
    id: identity.id,
    name: identity.name,
    applicationId: identity.applicationId,
    cliName: identity.cliName,
    scheme: identity.scheme,
    daemonPort: identity.daemonPort,
    homeDir: identity.homeDir,
    serviceName: identity.serviceName,
  };
}

/** "frogg" → "frogg beta", "Acme Studio" → "Acme Studio Beta": follow the name's own casing. */
function betaName(name: string): string {
  return /[A-Z]/.test(name) ? `${name} Beta` : `${name} beta`;
}

/**
 * The beta build's manifest: the stable manifest with every install identity moved aside, so a
 * beta daemon, CLI, desktop app and mobile app install next to the stable ones without sharing a
 * port, state directory, service, URL scheme, environment namespace or application id.
 */
function betaManifest(base: BrandManifest): BrandManifest {
  const overrides = base.channels?.beta ?? {};
  const stable = resolveIdentity(base);
  const id = `${base.id}-beta`;
  const appId = overrides.applicationId ?? `${base.applicationId}.beta`;
  const derived = {
    ...base,
    id,
    name: overrides.name ?? betaName(base.name),
    fullName: overrides.fullName ?? (base.fullName ? betaName(base.fullName) : undefined),
    applicationId: appId,
    daemonPort: overrides.daemonPort ?? (base.daemonPort > 1024 ? base.daemonPort - 1 : 1025),
    cliName: overrides.cliName ?? `${stable.cliName}-beta`,
    desktopBinaryName: overrides.desktopBinaryName ?? `${stable.desktopBinaryName}-beta`,
    homeDir: overrides.homeDir ?? `${stable.homeDir}-beta`,
    envPrefix: overrides.envPrefix ?? `${stable.envPrefix}_BETA`,
    scheme: overrides.scheme ?? `${stable.scheme}-beta`,
    serviceName: overrides.serviceName ?? `${id}-daemon`,
    launchdLabel: overrides.launchdLabel ?? `${appId}-daemon`,
    artifactPrefix: overrides.artifactPrefix ?? `${stable.artifactPrefix}-beta`,
    distribution: base.distribution
      ? // A store listing belongs to one application id; the beta app has its own.
        { ...base.distribution, iosStoreId: undefined }
      : undefined,
  };
  const parsed = BrandManifestSchema.safeParse(derived);
  if (!parsed.success) {
    throw new Error(
      `The beta channel identity derived from "${base.id}" is invalid; set it under channels.beta: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  if (parsed.data.daemonPort === base.daemonPort) {
    throw new Error("channels.beta.daemonPort must differ from the stable daemonPort");
  }
  return parsed.data;
}

/**
 * Fresh-install access defaults. The upstream `frogg` brand binds every
 * interface, trusts the LAN and leaves claim mode off; any other brand
 * defaults locked down (loopback bind, LAN untrusted, claim mode on) unless its
 * manifest says otherwise. All are defaults only: the matching env var and
 * config.json key (`daemon.listen`, `daemon.auth.*`, `providerUpdates.checkEnabled`) win.
 */
function resolveDaemonDefaults(manifest: BrandManifest, upstream: boolean) {
  const bind = manifest.daemon?.bind ?? (upstream ? "all" : "loopback");
  // Workspace services default to loopback for every brand, upstream included:
  // a dev server is reached through the daemon's authenticated service proxy,
  // not by binding it onto the network.
  const workspaceServicesBind = manifest.daemon?.workspaceServicesBind ?? "loopback";
  return {
    bind,
    bindHost: bind === "all" ? "0.0.0.0" : "127.0.0.1",
    workspaceServicesBind,
    workspaceServicesBindHost: workspaceServicesBind === "all" ? "0.0.0.0" : "127.0.0.1",
    claimMode: manifest.daemon?.claimMode ?? !upstream,
    trustLan: manifest.daemon?.trustLan ?? upstream,
    claimScope: manifest.daemon?.claimScope ?? "any",
    providerUpdateChecks: manifest.daemon?.providerUpdateChecks ?? true,
  };
}

/**
 * OpenCode's own `opencode/*` models run on OpenCode's hosted service, free
 * ones included. A branded build ships them off unless its manifest names an
 * OpenCode model policy, so enabling OpenCode for local models does not also
 * open a path to an external endpoint.
 */
const BRANDED_DEFAULT_MODEL_POLICIES: Record<string, { allow: string[]; deny: string[] }> = {
  opencode: { allow: [], deny: ["opencode/*"] },
};

/**
 * Which providers and models this build may run. Unlike the daemon defaults
 * this is a lock: config.json cannot add a provider outside `allowed` or select
 * a model the policy rejects, and the client leaves them out entirely.
 */
function resolveProviders(manifest: BrandManifest, upstream: boolean) {
  const models: Record<string, { allow: string[]; deny: string[] }> = upstream
    ? {}
    : { ...BRANDED_DEFAULT_MODEL_POLICIES };
  for (const [provider, policy] of Object.entries(manifest.providers?.models ?? {})) {
    models[provider] = { allow: policy.allow ?? [], deny: policy.deny ?? [] };
  }
  return { allowed: manifest.providers?.allowed ?? null, models };
}

/** Installer presentation defaults follow the dark palette so a brand needs no extra fields. */
function resolveInstaller(manifest: BrandManifest, dark: z.infer<typeof palette>) {
  const input = manifest.installer ?? {};
  const name = manifest.name;
  const expand = (value: string) => value.replaceAll("{name}", name);
  const colors = {
    background: dark.background,
    surface: mix(dark.background, dark.foreground, 0.06),
    foreground: dark.foreground,
    mutedForeground: mix(dark.foreground, dark.background, 0.4),
    accent: dark.accent,
    accentBright: dark.accentBright ?? dark.accent,
    success: "#3fcf8e",
    danger: "#f87171",
    ...input.colors,
  };
  if (contrast(colors.background, colors.foreground) < 4.5)
    throw new Error("installer colors require text contrast of at least 4.5:1");
  const copy = {
    installing: "Installing {name}",
    migrating: "Moving {name} to your account",
    ready: "{name} is ready",
    launching: "Launching {name}",
    elevationRequired:
      "{name} is installed for all users. Approve the administrator prompt so it can move to your account without leaving a second copy.",
    ...input.copy,
  };
  const distinctFullName = manifest.fullName !== name ? manifest.fullName : undefined;
  return {
    tagline: expand(input.tagline ?? distinctFullName ?? "Run and monitor AI coding agents"),
    colors,
    copy: Object.fromEntries(
      Object.entries(copy).map(([key, value]) => [key, expand(value)]),
    ) as typeof copy,
  };
}

function mix(from: string, to: string, amount: number): string {
  const channel = (value: string, offset: number) =>
    Number.parseInt(value.slice(offset, offset + 2), 16);
  return (
    "#" +
    [1, 3, 5]
      .map((offset) =>
        Math.round(channel(from, offset) + (channel(to, offset) - channel(from, offset)) * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export type Brand = ReturnType<typeof resolveBrandManifest>;

function luminance(value: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const component = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
export function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/**
 * Sections of a host's settings this build ships hidden. A deployment that
 * manages its own hosts has no use for the ones that ask the user to set a host
 * up — but hiding is a default, not a lock: the daemon's own config decides for
 * the host it runs on, and an admin can turn any of these back on there.
 */
function resolveHostSettings(manifest: BrandManifest) {
  return { hiddenSections: manifest.hostSettings?.hiddenSections ?? [] };
}

/**
 * Where "Add project" starts browsing on the daemon. A deployment that keeps
 * every checkout in one place (a provisioned sandbox, a build box) can name it
 * here so the picker opens there instead of the user's home directory. The path
 * is resolved on the daemon, so `~` and absolute paths both work, and it is only
 * a starting point: the picker falls back to the home directory when the
 * directory does not exist on that host.
 */
function resolveProjects(manifest: BrandManifest) {
  return { defaultDirectory: manifest.projects?.defaultDirectory ?? "~" };
}

function resolveDistribution(manifest: BrandManifest) {
  const distribution = manifest.distribution ?? {};
  const updateMode =
    distribution.updates ?? (distribution.repository ? "github-release" : "disabled");
  if (updateMode !== "disabled" && !distribution.repository) {
    throw new Error("distribution.repository is required when updates are enabled");
  }
  if (updateMode === "tauri-signed" && !distribution.updaterPublicKey) {
    throw new Error("distribution.updaterPublicKey is required for signed updates");
  }
  const repository = distribution.repository ?? null;
  return {
    repository,
    updateMode,
    updaterPublicKey: distribution.updaterPublicKey ?? null,
    releasesApi: repository ? `https://api.github.com/repos/${repository}/releases` : null,
    releaseBase: repository ? `https://github.com/${repository}/releases` : null,
    dockerImage: distribution.dockerImage ?? null,
    pairingImage: distribution.pairingImage ?? null,
    iosStoreId: distribution.iosStoreId ?? null,
    expoProjectId: distribution.expoProjectId ?? null,
  };
}

/**
 * `autoConfirmLocal` lets a managed install pair with a daemon on the same
 * machine from a `<scheme>://pair/direct?…` link alone. It applies only when
 * the link's host is loopback, it carries a pairing code (which only an owner
 * of that daemon can mint), and the daemon proves the key behind the link's
 * fingerprint; any other link still asks. Off unless the brand opts in.
 */
function resolvePairing(manifest: BrandManifest) {
  return { autoConfirmLocal: manifest.pairing?.autoConfirmLocal ?? false };
}

function resolveIdentity(manifest: BrandManifest) {
  const id = manifest.id;
  const cliName = manifest.cliName ?? id;
  return {
    schemaVersion: manifest.schemaVersion,
    id,
    name: manifest.name,
    fullName: manifest.fullName ?? manifest.name,
    description: manifest.description ?? `${manifest.name}: run and monitor AI coding agents.`,
    publisher: manifest.publisher ?? manifest.name,
    applicationId: manifest.applicationId,
    daemonPort: manifest.daemonPort,
    cliName,
    desktopBinaryName: manifest.desktopBinaryName ?? (id === "frogg" ? cliName : `${id}-desktop`),
    homeDir: manifest.homeDir ?? `.${id}`,
    envPrefix: (manifest.envPrefix ?? id.replaceAll("-", "_").toUpperCase()).replace(/_+$/, ""),
    scheme: manifest.scheme ?? id,
    serviceName: manifest.serviceName ?? `${id}-daemon`,
    launchdLabel: manifest.launchdLabel ?? `${manifest.applicationId}-daemon`,
    artifactPrefix: manifest.artifactPrefix ?? id,
    daemonArtifactPrefix: `${id}-daemon`,
    storagePrefix: id === "frogg" ? "" : `${manifest.applicationId}:`,
    legacyFrogg: id === "frogg",
  };
}

function resolveLinksAndServices(manifest: BrandManifest, repository: string | null) {
  return {
    links: {
      website: manifest.links?.website ?? null,
      docs: manifest.links?.docs ?? null,
      support: manifest.links?.support ?? null,
      source: manifest.links?.source ?? (repository ? `https://github.com/${repository}` : null),
      installer: manifest.links?.installer ?? null,
    },
    services: {
      pairingUrl: manifest.services?.pairingUrl ?? null,
      allowedOrigins: manifest.services?.allowedOrigins ?? [],
    },
  };
}
