import { z } from "zod";
import { AgentProviderSchema } from "./provider-manifest.js";

/**
 * Multi-sign-in ("provider accounts") support.
 *
 * Every supported CLI provider keeps its per-user state in a single config
 * directory that can be redirected with one environment variable. A second
 * account is therefore a second config directory plus symlinks back into the
 * primary directory for the state that should stay shared (commands, skills,
 * agents, session history). Frogg models that as a declarative capability
 * manifest so enabling another provider later is a manifest/config edit rather
 * than new code.
 */

const ProviderAccountLoginCommandSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
});

export const ProviderAccountCapabilitySchema = z.object({
  /** Provider id, matching the agent provider registry (`claude`, `codex`, ...). */
  provider: AgentProviderSchema,
  /** Environment variable that redirects the provider's config directory. */
  configDirEnv: z.string().min(1),
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

/**
 * The shipped manifest. Only `claude` is enabled; the remaining entries are
 * declared so turning one on is a one-line change here (or a `config.json`
 * override) instead of new code.
 *
 * Every disabled entry also carries `verified: false`. Its directory names,
 * config-dir environment variable and credential filenames were never tested
 * against that CLI — they are best-known guesses, and acting on a wrong guess
 * means pointing a provider at the wrong directory or reporting an account as
 * signed in when it is not. Enabling one of these is a request to verify it
 * first: confirm the values against the CLI, then flip `verified` to true in
 * the same change. The daemon warns at startup when a `config.json` override
 * enables an unverified entry, and the settings UI labels it.
 */
export const PROVIDER_ACCOUNT_CAPABILITIES: readonly ProviderAccountCapability[] = [
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
    enabled: false,
    verified: false,
    verificationNote:
      "CODEX_HOME, ~/.codex, the shareable prompts folder and auth.json have not been confirmed against a codex install.",
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

export function findProviderAccountCapability(
  provider: string,
): ProviderAccountCapability | undefined {
  return PROVIDER_ACCOUNT_CAPABILITIES.find((entry) => entry.provider === provider);
}

/** A stored account. This is the shape persisted in `config.json`. */
export const ProviderAccountSchema = z.object({
  id: z.string().min(1),
  provider: AgentProviderSchema,
  name: z.string().min(1),
  configDir: z.string().min(1),
  linkedFolders: z.array(z.string().min(1)),
  createdAt: z.string().min(1),
  lastAuthenticatedAt: z.string().min(1).optional(),
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
