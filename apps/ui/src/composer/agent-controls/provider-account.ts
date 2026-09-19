import { i18n } from "@/i18n/i18next";
import type { ProviderSnapshotAccount } from "@frogg/protocol/agent-types";
import {
  PROVIDER_ACCOUNT_DEFAULT_NAME,
  parseProviderAccountDefaultId,
} from "@frogg/protocol/provider-accounts";

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
 * The listed default account's label: its own name once it has been renamed,
 * and the translated "Default" while it still carries the reserved protocol
 * name, which is an id rather than something to show a person.
 */
function defaultAccountLabel(account: ProviderSnapshotAccount): string {
  return account.name === PROVIDER_ACCOUNT_DEFAULT_NAME ? buildDefaultLabel() : account.name;
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

  // The daemon lists the provider's implicit default account itself, under its
  // own name once it has been renamed. Adding the synthetic Default row on top
  // of it would list the same sign-in twice — once under the name the user gave
  // it and once as "Default".
  const listedDefault = accounts.find((account) => parseProviderAccountDefaultId(account.id));
  const accountRows = accounts.map((account) => ({
    id: account.id,
    label: account.id === listedDefault?.id ? defaultAccountLabel(account) : account.name,
    authenticated: account.authenticated,
    isDefaultRow: account.id === listedDefault?.id,
  }));
  const options: ProviderAccountOption[] = listedDefault
    ? accountRows
    : [
        {
          id: DEFAULT_PROVIDER_ACCOUNT_OPTION_ID,
          label: buildDefaultLabel(),
          authenticated: true,
          isDefaultRow: true,
        },
        ...accountRows,
      ];

  // An absent selection means the field is left off the launch config, and the
  // daemon then runs the agent as the provider's daemon-wide active account —
  // NOT as the Default row, which is the separate explicit `null` pick. So an
  // absent selection resolves to that account here too: showing "Default" while
  // the agent would launch as someone else is precisely the lie that made a
  // session started on "Default" come up signed in as another account.
  // The Default row's id is the listed default account's own id when the daemon
  // lists one, so an explicit `null` pick has to land on that row rather than on
  // the sentinel id that no longer appears in the list.
  const defaultRowId = listedDefault?.id ?? DEFAULT_PROVIDER_ACCOUNT_OPTION_ID;
  const selectedOptionId = resolveSelectedOptionId({
    selection,
    defaultAccountId: input.defaultAccountId,
    defaultRowId,
  });
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

function resolveSelectedOptionId(input: {
  selection: ProviderAccountSelection;
  defaultAccountId: string | null | undefined;
  defaultRowId: string;
}): string {
  if (input.selection === undefined && input.defaultAccountId) return input.defaultAccountId;
  if (input.selection == null) return input.defaultRowId;
  return input.selection;
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

/**
 * COMPAT(agentProviderAccountTransfer): added in v1.5.7, remove after
 * 2027-09-19.
 *
 * The accounts a live conversation could be moved to: the picker's own option
 * list minus the account the agent already runs as, because "move it to where
 * it already is" is not a move. Reusing the picker's list keeps a transfer
 * naming accounts exactly as the composer does, Default row included.
 */
export function resolveProviderAccountTransferOptions(
  model: Pick<ProviderAccountControlModel, "options">,
  selection: ProviderAccountSelection,
): ProviderAccountOption[] {
  // A `null` selection is the Default row, which the daemon may list under its
  // own account id rather than the sentinel, so match it by row instead of by
  // id — otherwise the account the agent already runs as is offered as a move.
  const currentOptionId =
    selection == null
      ? (model.options.find((option) => option.isDefaultRow)?.id ??
        DEFAULT_PROVIDER_ACCOUNT_OPTION_ID)
      : selection;
  return model.options.filter((option) => option.id !== currentOptionId);
}
