import { i18n } from "@/i18n/i18next";
import type { ProviderSnapshotAccount } from "@frogg/protocol/agent-types";

/**
 * COMPAT(perAgentProviderAccounts): added in v1.3.6, remove after 2027-09-17.
 *
 * The composer's provider account picker. `providerAccountId` is deliberately
 * three-valued and must never be read for truthiness:
 * - `undefined`: the field is absent from `create_agent_request.config`, so the
 *   daemon uses the provider's daemon-wide active account (today's behaviour).
 * - `null`: the explicit "Default" pick; the daemon pins the provider's primary
 *   config dir (`~/.claude`) so an active account cannot leak into this agent.
 * - a string: that account's config dir.
 */
export type ProviderAccountSelection = string | null | undefined;

/**
 * Sentinel option id for the "Default" row. The combobox is keyed by string ids
 * and `null` is not one, so the Default row needs an id no daemon-issued account
 * id can collide with.
 */
export const DEFAULT_PROVIDER_ACCOUNT_OPTION_ID = "frogg:provider-account:default";

export interface ProviderAccountOption {
  id: string;
  label: string;
  /** False only for accounts whose credentials are not on disk yet. */
  authenticated: boolean;
  isDefaultRow: boolean;
}

export interface ProviderAccountControlModel {
  options: ProviderAccountOption[];
  /** The combobox option id to highlight. Absent selections highlight Default. */
  selectedOptionId: string;
  /** The pill's value text. */
  displayLabel: string;
  /** True when the current selection names an account with no credentials yet. */
  selectedIsUnauthenticated: boolean;
}

/** The option id a selection maps to. */
export function toProviderAccountOptionId(selection: ProviderAccountSelection): string {
  return selection == null ? DEFAULT_PROVIDER_ACCOUNT_OPTION_ID : selection;
}

/** The wire value an option id maps to. Never returns `undefined`: picking is explicit. */
export function toProviderAccountSelection(optionId: string): string | null {
  return optionId === DEFAULT_PROVIDER_ACCOUNT_OPTION_ID ? null : optionId;
}

// The Default row sends `null`, which pins the provider's primary config dir
// (`~/.claude`) and deliberately ignores whichever account is marked active
// daemon-wide. Naming the active account here would therefore be a lie: that
// account has its own row, and picking this one does not select it.
function buildDefaultLabel(): string {
  return i18n.t("agentControls.account.default");
}

/**
 * The picker model for a provider, or `null` when the control must not render at
 * all. `accounts` is absent entirely unless the daemon advertises an enabled
 * accounts capability for the provider, and an empty array means the user has
 * not created any additional account — both look exactly like today.
 */
export function resolveProviderAccountControlModel(input: {
  accounts: readonly ProviderSnapshotAccount[] | undefined;
  defaultAccountId: string | null | undefined;
  selection: ProviderAccountSelection;
}): ProviderAccountControlModel | null {
  const { accounts, selection } = input;
  if (accounts === undefined || accounts.length === 0) {
    return null;
  }

  const options: ProviderAccountOption[] = [
    {
      id: DEFAULT_PROVIDER_ACCOUNT_OPTION_ID,
      label: buildDefaultLabel(),
      authenticated: true,
      isDefaultRow: true,
    },
    ...accounts.map((account) => ({
      id: account.id,
      label: account.name,
      authenticated: account.authenticated,
      isDefaultRow: false,
    })),
  ];

  // An absent selection means the field is left off the launch config, and the
  // daemon then runs the agent as the provider's daemon-wide active account —
  // NOT as the Default row, which is the separate explicit `null` pick. So an
  // absent selection resolves to that account here too: showing "Default" while
  // the agent would launch as someone else is precisely the lie that made a
  // session started on "Default" come up signed in as another account.
  const selectedOptionId =
    selection === undefined && input.defaultAccountId
      ? input.defaultAccountId
      : toProviderAccountOptionId(selection);
  const selected =
    options.find((option) => option.id === selectedOptionId) ??
    // The selected account was deleted while the composer was open. The daemon
    // falls back to default resolution, so show that rather than a stale name.
    options[0];

  return {
    options,
    selectedOptionId: selected.id,
    displayLabel: selected.label,
    selectedIsUnauthenticated: !selected.authenticated,
  };
}

/**
 * COMPAT(perAgentProviderAccounts): whether a launched agent's account shows as a
 * pill in the row above the composer. Once an agent is launched its account is
 * fixed, so it leaves the toolbar (which holds only controls that still change
 * something) and is shown here instead, whenever the provider has any account to
 * name. Pure so the visibility rule can be tested without standing up the pill or
 * the store it reads from.
 */
export function shouldShowProviderAccountPill(input: {
  /** A launched agent, bound to the config dir its provider process started with. */
  isRunning: boolean;
  accountsCount: number;
}): boolean {
  return input.isRunning && input.accountsCount > 0;
}
