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
 * - `undefined`: the user has not picked, so this client's default account for
 *   the provider applies (see `default-provider-account-store`). A launched
 *   agent reporting `undefined` comes from an older daemon that did not pin the
 *   account onto the agent; the default fallback below is then the best guess.
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
// (`~/.claude`) rather than whichever account this client has set as its
// default. Naming that account here would therefore be a lie: it has its own
// row, and picking this one does not select it.
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

  // An absent selection means the user has not picked, so the agent launches on
  // this client's default account — NOT necessarily the Default row, which is
  // the separate explicit `null` pick. So an absent selection resolves to that
  // account here too: showing "Default" while the agent would launch as someone
  // else is precisely the lie that made a session started on "Default" come up
  // signed in as another account.
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
 *
 * The current account is the model's resolved row, not the raw selection: an
 * absent selection runs the agent as this client's default account, which may
 * be a named account row rather than the Default row.
 */
export function resolveProviderAccountTransferOptions(
  model: Pick<ProviderAccountControlModel, "options" | "selectedOptionId">,
): ProviderAccountOption[] {
  return model.options.filter((option) => option.id !== model.selectedOptionId);
}

/**
 * The account a launch from the composer actually runs on, as sent on the
 * create-agent request.
 *
 * Resolution, highest first:
 *  1. an explicit pick (a string, or `null` for the Default row). A pick is
 *     never discarded for want of a loaded account list: the picker cannot be
 *     used before the list arrives, so a pick in hand outranks anything the
 *     list could still say. Dropping it made the launch fall through to the
 *     daemon's own active account — the exact bug where a session started on
 *     "Steve" came up signed in as "Steve 2".
 *  2. this client's stored default for the host and provider, which is client
 *     state and likewise needs no list to be trustworthy.
 *  3. the daemon's reported default — but only once the list has arrived and
 *     is non-empty, because a provider with no accounts at all must leave the
 *     key off the launch config entirely, as daemons without the accounts
 *     capability expect.
 */
export function resolveEffectiveProviderAccountId(input: {
  accounts: readonly ProviderSnapshotAccount[] | undefined;
  selection: ProviderAccountSelection;
  /** `undefined` when this client has never chosen a default for the provider. */
  storedDefaultAccountId: string | null | undefined;
  /** The provider snapshot's default, used only as the last resort. */
  snapshotDefaultAccountId: string | null | undefined;
}): ProviderAccountSelection {
  if (input.selection !== undefined) return input.selection;
  if (input.storedDefaultAccountId !== undefined) return input.storedDefaultAccountId;
  if (input.accounts === undefined || input.accounts.length === 0) return undefined;
  return input.snapshotDefaultAccountId ?? null;
}

/**
 * Whether the compact composer shows the account picker as its own toolbar pill
 * beside the model pill, instead of as a row inside the model sheet.
 *
 * Only a provider with more than one sign-in registered has a choice worth a
 * pill; with a single account the picker is a one-option list that would cost
 * toolbar width for nothing, so it stays in the sheet. A read-only control
 * (a launched agent, whose provider process is already bound to a config dir)
 * is never promoted either — the running agent's account is named by the
 * composer's account pill instead.
 */
export function shouldShowCompactAccountToolbarControl(input: {
  accountsCount: number;
  readOnly: boolean;
}): boolean {
  return !input.readOnly && input.accountsCount > 1;
}
