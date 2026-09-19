import { z } from "zod";
import { AgentProviderSchema } from "./provider-manifest.js";

/**
 * Multi-sign-in ("provider accounts") support.
 *
 * Most supported CLI providers keep their per-user state in a single config
 * directory that can be redirected with one environment variable. A second
 * account is therefore a second config directory plus symlinks back into the
 * primary directory for the state that should stay shared (commands, skills,
 * agents, session history). Frogg models that as a declarative capability
 * manifest so enabling another provider later is a manifest/config edit rather
 * than new code.
 *
 * Some CLIs have no such variable and resolve their directory from the home
 * directory instead. Those declare `configDirMode: "home"`: the account
 * directory becomes a synthetic HOME for that provider's process only, with the
 * config dir nested inside it and `homeLinks` symlinked back to the real home.
 * That mode is strictly opt-in, because anything the CLI reads from home and is
 * not linked back will not be there.
 */

const ProviderAccountLoginCommandSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
});

/**
 * The environment variable a `configDirMode: "home"` capability redirects.
 *
 * Home mode exists for CLIs that derive their config directory from the user's
 * home directory with no dedicated override variable (see the `gemini` entry),
 * so the only lever left is `HOME` itself.
 */
export const PROVIDER_ACCOUNT_HOME_ENV = "HOME";

export const ProviderAccountCapabilitySchema = z.object({
  /** Provider id, matching the agent provider registry (`claude`, `codex`, ...). */
  provider: AgentProviderSchema,
  /**
   * How the provider's config directory is redirected.
   *
   * - `"env"` (the default, and what every entry predating this field means):
   *   `configDirEnv` is a dedicated variable naming the config directory, and
   *   the account directory *is* that config directory.
   * - `"home"`: the CLI has no config-dir variable and resolves its directory
   *   from the home directory, so the account directory is a synthetic HOME and
   *   `configDirEnv` is {@link PROVIDER_ACCOUNT_HOME_ENV}. The real config dir
   *   is `<accountDir>/<primaryDirName>`, and `homeLinks` names the home-relative
   *   entries symlinked back to the real home so the synthetic home is usable.
   *
   * Optional and additive on the wire: absent means `"env"`. Read it through
   * {@link providerAccountConfigDirMode} rather than directly.
   */
  configDirMode: z.enum(["env", "home"]).optional(),
  /**
   * Environment variable that redirects the provider's config directory. In
   * `"home"` mode this is always {@link PROVIDER_ACCOUNT_HOME_ENV}, so a client
   * that knows nothing about `configDirMode` still applies the right variable.
   */
  configDirEnv: z.string().min(1),
  /**
   * `"home"` mode only: home-relative files and directories symlinked from the
   * real home into each account's synthetic home, so repointing HOME does not
   * hide shared state. Must be absent (or empty) in `"env"` mode, where nothing
   * outside the config directory moves.
   */
  homeLinks: z.array(z.string().min(1)).optional(),
  /** Name of the primary (default) config directory inside the user's home. */
  primaryDirName: z.string().min(1),
  /** Sub-directories of the primary dir that are symlinked into each account dir. */
  linkableFolders: z.array(z.string().min(1)),
  /** Interactive command a client can launch so the user can sign in. */
  loginCommand: ProviderAccountLoginCommandSchema,
  /** Files whose presence inside the config dir means the account is signed in. */
  credentialFiles: z.array(z.string().min(1)),
  /** Whether the daemon accepts account management for this provider. */
  enabled: z.boolean(),
  /**
   * Whether `configDirEnv`, `primaryDirName`, `linkableFolders` and
   * `credentialFiles` were confirmed against a real install of the provider's
   * CLI, or are best-known guesses.
   *
   * Optional and additive on the wire: a daemon that predates this field sends
   * nothing and clients must not treat that as a warning, so only an explicit
   * `false` means "unverified". Use {@link isProviderAccountCapabilityUnverified}
   * rather than reading the field directly.
   */
  verified: z.boolean().optional(),
  /** Why the entry is unverified, shown to anyone enabling it. Only set when `verified` is false. */
  verificationNote: z.string().min(1).optional(),
});

export type ProviderAccountCapability = z.infer<typeof ProviderAccountCapabilitySchema>;

type ProviderAccountCapabilityBase = Omit<
  ProviderAccountCapability,
  "configDirMode" | "configDirEnv" | "homeLinks"
>;

/**
 * The manifest entry shape, stricter than the wire type so an illegal
 * mode/field combination cannot be written down: env mode has no `homeLinks`,
 * and home mode must redirect HOME and must name at least one link back.
 *
 * The wire type stays a plain object with both fields optional, so an older
 * client (and the generated validators) keep accepting every entry.
 */
export type ProviderAccountCapabilityEntry = ProviderAccountCapabilityBase &
  (
    | { configDirMode?: "env"; configDirEnv: string; homeLinks?: never }
    | {
        configDirMode: "home";
        configDirEnv: typeof PROVIDER_ACCOUNT_HOME_ENV;
        homeLinks: [string, ...string[]];
      }
  );

/** The redirect mode of a capability, treating an absent field as `"env"`. */
export function providerAccountConfigDirMode(
  capability: Pick<ProviderAccountCapability, "configDirMode">,
): "env" | "home" {
  return capability.configDirMode === "home" ? "home" : "env";
}

/**
 * Home-relative entries to symlink back into a home-mode account directory.
 * Always empty for env-mode capabilities, even if a hand-edited manifest set
 * `homeLinks`, so a stray field cannot make an env-mode provider grow symlinks.
 */
export function providerAccountHomeLinks(
  capability: Pick<ProviderAccountCapability, "configDirMode" | "homeLinks">,
): readonly string[] {
  return providerAccountConfigDirMode(capability) === "home" ? (capability.homeLinks ?? []) : [];
}

/**
 * The shipped manifest. `claude` and `codex` are enabled and verified; the
 * remaining entries are declared so turning one on is a one-line change here (or
 * a `config.json` override) instead of new code.
 *
 * `gemini` is a special case: it has no entry in the agent provider registry
 * (`AGENT_PROVIDER_DEFINITIONS`) but is selectable through the ACP provider
 * catalog, launched as `npx -y @google/gemini-cli@<version> --acp`. Its values
 * are verified against that package, but it ships disabled because home mode
 * has side effects an operator must accept deliberately.
 *
 * Every other disabled entry carries `verified: false`. Its directory names,
 * config-dir environment variable and credential filenames were never tested
 * against that CLI — they are best-known guesses, and acting on a wrong guess
 * means pointing a provider at the wrong directory or reporting an account as
 * signed in when it is not. Enabling one of these is a request to verify it
 * first: confirm the values against the CLI, then flip `verified` to true in
 * the same change. The daemon warns at startup when a `config.json` override
 * enables an unverified entry, and the settings UI labels it.
 */
export const PROVIDER_ACCOUNT_CAPABILITIES: readonly ProviderAccountCapabilityEntry[] = [
  {
    provider: "claude",
    configDirEnv: "CLAUDE_CONFIG_DIR",
    primaryDirName: ".claude",
    linkableFolders: ["commands", "skills", "agents", "projects", "sessions", "shell-snapshots"],
    // `claude` with no arguments is interactive; the user runs /login inside it.
    loginCommand: { command: "claude", args: [] },
    credentialFiles: [".credentials.json"],
    enabled: true,
    verified: true,
  },
  {
    provider: "codex",
    configDirEnv: "CODEX_HOME",
    primaryDirName: ".codex",
    linkableFolders: ["prompts"],
    loginCommand: { command: "codex", args: ["login"] },
    credentialFiles: ["auth.json"],
    enabled: true,
    verified: true,
  },
  {
    provider: "gemini",
    // Gemini CLI has NO config-dir environment variable. Verified against the
    // @google/gemini-cli@0.52.0 bundle: `GEMINI_DIR = ".gemini"` is an internal
    // string constant, and `Storage.getGlobalGeminiDir()` is
    // `path.join(os.homedir(), GEMINI_DIR)`. The only path-affecting variables
    // in the bundle are HOME, GEMINI_PROJECT_DIR (a project dir, not config)
    // and CLOUDSDK_CONFIG. Node's `os.homedir()` returns $HOME on POSIX, so a
    // per-account HOME is the only way to separate two sign-ins; setting
    // GEMINI_DIR would silently leave every account sharing ~/.gemini.
    configDirMode: "home",
    configDirEnv: PROVIDER_ACCOUNT_HOME_ENV,
    primaryDirName: ".gemini",
    linkableFolders: ["commands", "extensions"],
    /**
     * A synthetic HOME hides everything else in the real home, so each entry
     * here is state the agent would otherwise lose:
     *  - `.npm`, `.npmrc`: gemini is launched via `npx -y @google/gemini-cli`,
     *    so without the npm cache and registry config every launch re-downloads
     *    the package (and a private registry would stop resolving).
     *  - `.cache`: shared cache root used by npm/node tooling the agent shells out to.
     *  - `.gitconfig`: commit identity; without it commits are made by a
     *    different (or no) author than the daemon's other providers.
     *  - `.ssh`: git remotes over SSH. Same user's own keys, so no new access —
     *    but a symlink, not a copy, so nothing is duplicated onto disk.
     *  - `.config/gcloud`: CLOUDSDK_CONFIG's default location, which gemini
     *    reads for Vertex AI / application-default credentials. Linked
     *    specifically rather than linking all of `.config`, which would drag in
     *    unrelated providers' state.
     */
    homeLinks: [".npm", ".npmrc", ".cache", ".gitconfig", ".ssh", ".config/gcloud"],
    // No `gemini` binary exists on the daemon host; the ACP catalog launches it
    // through npx at this pinned version, so login has to take the same path.
    // Bare (no --acp) is the interactive TUI where the user picks a sign-in method.
    loginCommand: {
      command: "npx",
      args: ["-y", "@google/gemini-cli@0.52.0"],
    },
    // Relative to the account dir, which in home mode is the synthetic home:
    // the real config dir is `<accountDir>/.gemini`. Both names are verified
    // present in the bundle (`GOOGLE_ACCOUNTS_FILENAME = "google_accounts.json"`,
    // and oauth_creds.json alongside it under getGlobalGeminiDir()).
    credentialFiles: [".gemini/oauth_creds.json", ".gemini/google_accounts.json"],
    // OPT-IN ONLY: switch on via `providerAccounts.gemini.enabled` in config.json.
    enabled: false,
    verified: true,
    verificationNote:
      "Verified by unpacking @google/gemini-cli@0.52.0: no config-dir env var exists (GEMINI_DIR is an internal constant), ~/.gemini is derived from os.homedir(), and oauth_creds.json plus google_accounts.json are the credential files. NOT confirmed: no real Google sign-in was performed, so it is unproven that a second account under a synthetic HOME completes OAuth and writes those files there, and unproven that gemini reads nothing else from the home directory beyond the linked entries. Because the CLI has no config-dir variable, enabling this trades an isolated config dir for a synthetic HOME.",
  },
  {
    provider: "opencode",
    configDirEnv: "OPENCODE_CONFIG_DIR",
    primaryDirName: ".config/opencode",
    linkableFolders: [],
    loginCommand: { command: "opencode", args: ["auth", "login"] },
    credentialFiles: ["auth.json"],
    enabled: false,
    verified: false,
    verificationNote:
      "OPENCODE_CONFIG_DIR, ~/.config/opencode and auth.json have not been confirmed against an opencode install, and no shareable sub-directory layout is known.",
  },
  {
    provider: "pi",
    configDirEnv: "PI_CONFIG_DIR",
    primaryDirName: ".pi",
    linkableFolders: [],
    loginCommand: { command: "pi", args: ["login"] },
    credentialFiles: ["auth.json"],
    enabled: false,
    verified: false,
    verificationNote:
      "PI_CONFIG_DIR, ~/.pi and auth.json have not been confirmed against a pi install, and no shared-state folders are known.",
  },
  {
    provider: "copilot",
    configDirEnv: "COPILOT_CONFIG_DIR",
    primaryDirName: ".copilot",
    linkableFolders: [],
    loginCommand: { command: "copilot", args: [] },
    credentialFiles: ["apps.json", "hosts.json"],
    enabled: false,
    verified: false,
    verificationNote:
      "GitHub Copilot CLI stores credentials through the GitHub CLI host config; COPILOT_CONFIG_DIR, ~/.copilot and the per-account layout have not been confirmed.",
  },
];

/**
 * True when the manifest entry explicitly declares its directory and credential
 * values unverified. An absent `verified` field means "not stated" — an older
 * daemon, or an operator-supplied entry — and is deliberately not a warning.
 */
export function isProviderAccountCapabilityUnverified(
  capability: Pick<ProviderAccountCapability, "verified">,
): boolean {
  return capability.verified === false;
}

/**
 * Provider ids that a `config.json` override switches on while the shipped
 * manifest still marks them unverified. The daemon reports these at startup so
 * the guesses are seen by the person acting on them.
 *
 * @param overrides the `providerAccounts` section of `config.json`.
 */
export function findEnabledUnverifiedProviders(
  overrides: Record<string, { enabled?: boolean } | undefined> | undefined,
): string[] {
  if (!overrides) return [];
  return PROVIDER_ACCOUNT_CAPABILITIES.filter(
    (capability) =>
      isProviderAccountCapabilityUnverified(capability) &&
      overrides[capability.provider]?.enabled === true,
  )
    .map((capability) => capability.provider)
    .sort();
}

/**
 * Provider ids a `config.json` override switches on that use `configDirMode:
 * "home"`. These are verified but carry a real side effect — the provider's
 * process runs with a synthetic HOME — so the daemon reports them at startup
 * even though nothing about them is a guess.
 *
 * @param overrides the `providerAccounts` section of `config.json`.
 */
export function findEnabledHomeModeProviders(
  overrides: Record<string, { enabled?: boolean } | undefined> | undefined,
): string[] {
  if (!overrides) return [];
  return PROVIDER_ACCOUNT_CAPABILITIES.filter(
    (capability) =>
      providerAccountConfigDirMode(capability) === "home" &&
      overrides[capability.provider]?.enabled === true,
  )
    .map((capability) => capability.provider)
    .sort();
}

export function findProviderAccountCapability(
  provider: string,
): ProviderAccountCapability | undefined {
  return PROVIDER_ACCOUNT_CAPABILITIES.find((entry) => entry.provider === provider);
}

/**
 * COMPAT(providerAccountPreferences): added in v1.5.5, remove after 2027-09-19.
 * Per-account launch and display preferences. Every field is optional; absent
 * means "no preference" and the provider/host defaults apply.
 */
export const ProviderAccountPreferencesSchema = z.object({
  /** An identity colour name shared with host badges. Unknown values draw unthemed. */
  color: z.string().min(1).optional(),
  /** Appended to the agent's system prompt when an agent is launched as this account. */
  systemPrompt: z.string().optional(),
  /** Model a new agent on this account starts with, when the client has not picked one. */
  defaultModelId: z.string().min(1).optional(),
  /** Thinking option a new agent on this account starts with. */
  defaultThinkingOptionId: z.string().min(1).optional(),
});

export type ProviderAccountPreferences = z.infer<typeof ProviderAccountPreferencesSchema>;

/** Max length of {@link ProviderAccountPreferences.systemPrompt}. */
export const PROVIDER_ACCOUNT_SYSTEM_PROMPT_MAX_LENGTH = 20_000;

/** A stored account. This is the shape persisted in `config.json`. */
export const ProviderAccountSchema = z.object({
  id: z.string().min(1),
  provider: AgentProviderSchema,
  name: z.string().min(1),
  configDir: z.string().min(1),
  linkedFolders: z.array(z.string().min(1)),
  createdAt: z.string().min(1),
  lastAuthenticatedAt: z.string().min(1).optional(),
  /**
   * COMPAT(providerAccountAllowedModels): added in v1.4.2, remove after 2027-09-17.
   * Model ids this account may run. Absent/undefined means "no restriction, every
   * model the provider offers"; an empty array means no model is permitted and the
   * account cannot start an agent. The effective selectable set for an agent is
   * the provider's models intersected with this list.
   */
  allowedModels: z.array(z.string().min(1)).optional(),
  /** COMPAT(providerAccountPreferences): added in v1.5.5, remove after 2027-09-19. */
  preferences: ProviderAccountPreferencesSchema.optional(),
});

export type ProviderAccount = z.infer<typeof ProviderAccountSchema>;

/** What a client sees: the stored account plus daemon-computed live state. */
export const ProviderAccountStateSchema = z.object({
  id: z.string().min(1),
  provider: AgentProviderSchema,
  name: z.string().min(1),
  configDir: z.string().min(1),
  linkedFolders: z.array(z.string().min(1)),
  createdAt: z.string().min(1),
  lastAuthenticatedAt: z.string().min(1).optional(),
  /** True when one of the capability's `credentialFiles` exists in `configDir`. */
  authenticated: z.boolean(),
  /** True when this account supplies the env overlay for its provider. */
  isActive: z.boolean(),
  /**
   * COMPAT(providerAccountAllowedModels): added in v1.4.2, remove after 2027-09-17.
   * See {@link ProviderAccountSchema.shape.allowedModels}. Absent means unrestricted.
   */
  allowedModels: z.array(z.string().min(1)).optional(),
  /** COMPAT(providerAccountPreferences): added in v1.5.5, remove after 2027-09-19. */
  preferences: ProviderAccountPreferencesSchema.optional(),
});

export type ProviderAccountState = z.infer<typeof ProviderAccountStateSchema>;

export const PROVIDER_ACCOUNT_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Account names double as directory suffixes, so they are restricted to a
 * lowercase slug. Returns the slug, or null when the name cannot be one.
 */
export function toProviderAccountSlug(name: string): string | null {
  const slug = name.trim().toLowerCase();
  if (slug.length === 0 || slug.length > 64) {
    return null;
  }
  return PROVIDER_ACCOUNT_NAME_PATTERN.test(slug) ? slug : null;
}

/**
 * The id of a provider's implicit "Default" account — the one backed by the
 * provider's primary config directory (`~/.claude`, `~/.codex`, ...), which
 * exists whether or not anything is stored for it.
 *
 * The daemon synthesizes this account in listings. It only materialises a stored
 * record when something has to be persisted about it (today: a renamed display
 * name, or an `allowedModels` restriction). That stored record always keeps
 * `configDir` pointing at the primary directory.
 */
export function providerAccountDefaultId(provider: string): string {
  return `default:${provider}`;
}

/** The provider whose default account this id names, or null if it is a normal account id. */
export function parseProviderAccountDefaultId(accountId: string): string | null {
  if (!accountId.startsWith("default:")) return null;
  const provider = accountId.slice("default:".length);
  return provider.length > 0 ? provider : null;
}

/** The display name a default account carries until it is renamed. */
export const PROVIDER_ACCOUNT_DEFAULT_NAME = "default";

export const PROVIDER_ACCOUNT_DISPLAY_NAME_MAX_LENGTH = 64;

/**
 * Display names are only a label: unlike {@link toProviderAccountSlug}, which
 * constrains a *new* account's name because it becomes a directory suffix, a
 * rename never touches the directory, so any single-line, non-blank text up to
 * {@link PROVIDER_ACCOUNT_DISPLAY_NAME_MAX_LENGTH} characters is accepted.
 *
 * Returns the trimmed name, or null when it cannot be used.
 */
export function normalizeProviderAccountDisplayName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > PROVIDER_ACCOUNT_DISPLAY_NAME_MAX_LENGTH) {
    return null;
  }
  return /[\r\n\t ]/.test(trimmed) ? null : trimmed;
}

/** Current version of {@link ProviderAccountExportBundleSchema}. */
export const PROVIDER_ACCOUNT_EXPORT_BUNDLE_VERSION = 1;

/**
 * One exported account: its metadata plus the raw bytes of the capability's
 * credential files.
 *
 * SECRET MATERIAL. `credentials[].contents` are live provider credentials
 * (OAuth refresh tokens, API keys). Treat a bundle exactly like the credential
 * file itself: never log it, never write it to disk from the daemon, never send
 * it anywhere but the authenticated session that asked for it.
 */
export const ProviderAccountExportEntrySchema = z.object({
  /** The account's stored metadata. `configDir` is advisory: the importing daemon re-provisions its own. */
  account: ProviderAccountSchema,
  credentials: z.array(
    z.object({
      /** File name, relative to the account's config dir. Always one of the capability's `credentialFiles`. */
      file: z.string().min(1),
      /** Base64-encoded file contents. SECRET. */
      contentsBase64: z.string(),
    }),
  ),
});

export type ProviderAccountExportEntry = z.infer<typeof ProviderAccountExportEntrySchema>;

/**
 * A portable multi-account bundle, so a sign-in made on one daemon can be moved
 * to another. Versioned so an importer can reject a shape it does not know.
 *
 * SECRET MATERIAL — see {@link ProviderAccountExportEntrySchema}. This bundle
 * carries live credentials in plaintext (base64 is encoding, not encryption).
 * The daemon returns it over the authenticated session only and never persists
 * it; whoever holds it holds the sign-in.
 */
export const ProviderAccountExportBundleSchema = z.object({
  /** Bundle format version. Currently always 1. */
  version: z.number().int().positive(),
  /** The provider every entry belongs to. */
  provider: AgentProviderSchema,
  /** ISO timestamp of the export. */
  exportedAt: z.string().min(1),
  accounts: z.array(ProviderAccountExportEntrySchema),
});

export type ProviderAccountExportBundle = z.infer<typeof ProviderAccountExportBundleSchema>;
