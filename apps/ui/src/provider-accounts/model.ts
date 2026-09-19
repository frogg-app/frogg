import {
  PROVIDER_ACCOUNT_NAME_PATTERN,
  toProviderAccountSlug,
  type ProviderAccountCapability,
  type ProviderAccountState,
} from "@frogg/protocol/provider-accounts";

/**
 * Pure view model for the multi-sign-in settings surface. Everything here is
 * driven by the daemon's capability manifest — no provider id is special-cased,
 * so enabling another provider server-side lights the UI up with no change here.
 */

export type ProviderAccountNameStatus = "empty" | "invalid" | "duplicate" | "valid";

export interface ProviderAccountNameResult {
  status: ProviderAccountNameStatus;
  /** The slug the daemon would derive, or null when the name cannot be one. */
  slug: string | null;
}

/**
 * Mirrors the daemon's validation: names double as directory suffixes, so they
 * must be a lowercase slug and unique per provider.
 */
export function validateProviderAccountName(
  name: string,
  existingNames: readonly string[] = [],
): ProviderAccountNameResult {
  if (name.trim().length === 0) {
    return { status: "empty", slug: null };
  }
  const slug = toProviderAccountSlug(name);
  if (!slug) {
    return { status: "invalid", slug: null };
  }
  if (existingNames.includes(slug)) {
    return { status: "duplicate", slug };
  }
  return { status: "valid", slug };
}

export { PROVIDER_ACCOUNT_NAME_PATTERN };

/**
 * The directory the daemon will create: the primary config dir plus the slug.
 * Shown as a `~`-relative path because the daemon resolves it inside the home
 * directory of the account the daemon runs as, which the client cannot know.
 */
export function previewProviderAccountConfigDir(
  capability: ProviderAccountCapability,
  slug: string | null,
): string | null {
  if (!slug) {
    return null;
  }
  return `~/${capability.primaryDirName}-${slug}`;
}

export function selectProviderAccounts(
  accounts: readonly ProviderAccountState[],
  provider: string,
): ProviderAccountState[] {
  return accounts.filter((account) => account.provider === provider);
}

export interface ProviderAccountCreateInput {
  provider: string;
  name: string;
  linkedFolders: string[];
}

/**
 * The `provider.account.create` request body. The name is sent as the derived
 * slug and the folders are narrowed to the capability's own list, so a stale
 * client can never ask the daemon to link something it does not declare.
 */
export function buildProviderAccountCreatePayload(input: {
  capability: ProviderAccountCapability;
  name: string;
  selectedFolders: readonly string[];
}): ProviderAccountCreateInput | null {
  const slug = toProviderAccountSlug(input.name);
  if (!slug) {
    return null;
  }
  return {
    provider: input.capability.provider,
    name: slug,
    linkedFolders: input.capability.linkableFolders.filter((folder) =>
      input.selectedFolders.includes(folder),
    ),
  };
}
