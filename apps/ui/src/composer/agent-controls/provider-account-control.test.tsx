/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real popover surfaces pull in Reanimated and Gorhom, which need a browser.
// This suite is about the control's own behaviour, so the surfaces are stood in
// for by the thinnest thing that still exercises `renderOption` and `onSelect` —
// the same shape `import-session-sheet.test.tsx` uses.
vi.mock("@/components/ui/combobox", () => ({
  Combobox: ({
    options,
    value,
    onSelect,
    open,
    renderOption,
  }: {
    options: ReadonlyArray<{ id: string; label: string }>;
    value: string;
    onSelect: (id: string) => void;
    open?: boolean;
    renderOption?: (input: {
      option: { id: string; label: string };
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => React.ReactElement;
  }) => {
    if (!open || !renderOption) return null;
    return React.createElement(
      "div",
      { "data-testid": "combobox" },
      options.map((option) =>
        React.createElement(
          React.Fragment,
          { key: option.id },
          renderOption({
            option,
            selected: value === option.id,
            active: false,
            onPress: () => onSelect(option.id),
          }),
        ),
      ),
    );
  },
  ComboboxItem: ({
    label,
    description,
    disabled,
    accessibilityLabel,
    trailingSlot,
    onPress,
    testID,
  }: {
    label: string;
    description?: string;
    disabled?: boolean;
    accessibilityLabel?: string;
    trailingSlot?: React.ReactNode;
    onPress: () => void;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      {
        type: "button",
        "data-testid": testID,
        "data-description": description,
        "aria-label": accessibilityLabel ?? label,
        disabled,
        onClick: onPress,
      },
      label,
      trailingSlot,
    ),
}));

// The usage line's data comes off the wire; these two stand in for the host so
// the control's own rendering of it is what the suite tests.
const usageState = {
  accountScoped: true,
  byAccount: new Map<string | null, unknown>(),
};

vi.mock("@/runtime/host-features", () => ({
  useHostFeature: () => usageState.accountScoped,
}));

vi.mock("@/provider-usage/use-provider-usage", () => ({
  useProviderUsage: (
    _serverId: string | null | undefined,
    options: { enabled?: boolean; providerAccountId?: string | null },
  ) => {
    const payload = options.enabled
      ? usageState.byAccount.get(options.providerAccountId ?? null)
      : undefined;
    return {
      view: payload ? { kind: "ready", payload, isRefreshing: false } : { kind: "loading" },
      refresh: async () => {},
      canFetch: true,
    };
  },
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: () => null,
}));

import { ComposerControlLayoutProvider } from "./layout-context";
import {
  ProviderAccountControl,
  type ProviderAccountControlValue,
} from "./provider-account-control";
import { DEFAULT_PROVIDER_ACCOUNT_OPTION_ID } from "./provider-account";

beforeEach(() => {
  vi.stubGlobal("React", React);
  usageState.accountScoped = true;
  usageState.byAccount = new Map();
});
afterEach(() => cleanup());

const LAYOUT = {
  glyphSize: 16,
  presentation: {
    showCarets: true,
    showThinkingLabel: true,
    showModeLabel: true,
    aggregateFeatures: false,
  },
};

const STEVE = { id: "acct-steve", name: "steve", authenticated: true };
const NEW = { id: "acct-new", name: "new-hire", authenticated: false };

function renderControl(props: Partial<ProviderAccountControlValue> = {}) {
  const onSelectAccount = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ComposerControlLayoutProvider value={LAYOUT}>
        <ProviderAccountControl
          accounts={[STEVE]}
          defaultAccountId={null}
          selectedAccountId={undefined}
          {...props}
          onSelectAccount={onSelectAccount}
        />
      </ComposerControlLayoutProvider>
    </QueryClientProvider>,
  );
  return { onSelectAccount };
}

function openPicker() {
  fireEvent.click(screen.getByTestId("provider-account-control"));
}

describe("ProviderAccountControl", () => {
  it("renders nothing when the provider advertises no accounts capability", () => {
    renderControl({ accounts: undefined });
    expect(screen.queryByTestId("provider-account-control")).toBeNull();
  });

  it("renders nothing when the provider has an accounts capability but no accounts", () => {
    renderControl({ accounts: [] });
    expect(screen.queryByTestId("provider-account-control")).toBeNull();
  });

  it("shows the pill once an additional account exists", () => {
    renderControl();
    expect(screen.getByTestId("provider-account-control")).toBeTruthy();
  });

  it("sends an explicit null for the Default row rather than omitting the value", () => {
    const { onSelectAccount } = renderControl({
      selectedAccountId: "acct-steve",
    });
    openPicker();
    fireEvent.click(
      screen.getByTestId(`provider-account-option-${DEFAULT_PROVIDER_ACCOUNT_OPTION_ID}`),
    );
    expect(onSelectAccount).toHaveBeenCalledTimes(1);
    expect(onSelectAccount.mock.calls[0]?.[0]).toBeNull();
    expect(onSelectAccount.mock.calls[0]?.[0]).not.toBeUndefined();
  });

  it("sends the account id when an account row is picked", () => {
    const { onSelectAccount } = renderControl();
    openPicker();
    fireEvent.click(screen.getByTestId("provider-account-option-acct-steve"));
    expect(onSelectAccount).toHaveBeenCalledWith("acct-steve");
  });

  it("will not launch an agent on an account with no credentials yet", () => {
    const { onSelectAccount } = renderControl({ accounts: [STEVE, NEW] });
    openPicker();
    const row = screen.getByTestId("provider-account-option-acct-new");
    expect(row.getAttribute("aria-label")).toContain("Not signed in");
    expect((row as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(row);
    expect(onSelectAccount).not.toHaveBeenCalled();
  });

  describe("inline usage", () => {
    function usagePayload(windows: Array<Record<string, unknown>>) {
      return {
        requestId: "req",
        fetchedAt: "2026-01-01T00:00:00.000Z",
        providers: [
          {
            providerId: "claude",
            displayName: "Claude",
            status: "available",
            planLabel: null,
            windows,
          },
        ],
      };
    }

    it("shows each account's own window usage and time to reset", () => {
      // A whole number of hours plus a slack minute, so the clock ticking
      // during the render cannot round the countdown down.
      const resetsAt = new Date(Date.now() + 3 * 3_600_000 + 30_000).toISOString();
      usageState.byAccount.set(
        "acct-steve",
        usagePayload([{ id: "five_hour", label: "Session", usedPct: 42, resetsAt }]),
      );
      usageState.byAccount.set(null, usagePayload([{ id: "weekly", label: "Weekly", usedPct: 7 }]));
      renderControl({
        serverId: "host",
        provider: "claude",
        selectedAccountId: "acct-steve",
      });
      openPicker();
      // Each window renders as a meter — caption, figure, then countdown — so
      // the row's text holds those parts split rather than joined.
      expect(screen.getByTestId("provider-account-option-acct-steve").textContent).toBe(
        "steveSession42%3h",
      );
      expect(
        screen.getByTestId("provider-account-option-acct-steve").getAttribute("aria-label"),
      ).toBe("steve — Session 42% · 3h");
      expect(
        screen.getByTestId(`provider-account-option-${DEFAULT_PROVIDER_ACCOUNT_OPTION_ID}`)
          .textContent,
      ).toBe("DefaultWeekly7%");
    });

    // An older daemon answers for its default config dir whatever account is
    // asked about, so every row would claim the same figures.
    it("shows no usage when the host cannot scope figures to an account", () => {
      usageState.accountScoped = false;
      usageState.byAccount.set(
        "acct-steve",
        usagePayload([{ id: "weekly", label: "Weekly", usedPct: 7 }]),
      );
      renderControl({ serverId: "host", provider: "claude" });
      openPicker();
      expect(screen.getByTestId("provider-account-option-acct-steve").textContent).toBe("steve");
    });

    it("keeps the not-signed-in note instead of a usage line", () => {
      renderControl({
        accounts: [STEVE, NEW],
        serverId: "host",
        provider: "claude",
      });
      openPicker();
      expect(
        screen.getByTestId("provider-account-option-acct-new").getAttribute("data-description"),
      ).toContain("Not signed in");
    });
  });

  describe("read-only (a launched agent)", () => {
    it("keeps the pill on the toolbar but never opens the picker", () => {
      const { onSelectAccount } = renderControl({
        readOnly: true,
        selectedAccountId: "acct-steve",
      });
      const pill = screen.getByTestId("provider-account-control");
      expect(pill.textContent).toContain("steve");
      openPicker();
      expect(screen.queryByTestId("combobox")).toBeNull();
      expect(onSelectAccount).not.toHaveBeenCalled();
    });

    // A launch that omitted `providerAccountId` ran on the provider's active
    // account, so the pill must name it rather than claim "Default".
    it("resolves an absent selection to the daemon-wide active account", () => {
      renderControl({
        readOnly: true,
        selectedAccountId: undefined,
        defaultAccountId: "acct-steve",
      });
      expect(screen.getByTestId("provider-account-control").textContent).toContain("steve");
    });

    it("still shows Default for an explicit null pick", () => {
      renderControl({
        readOnly: true,
        selectedAccountId: null,
        defaultAccountId: "acct-steve",
      });
      const label = screen.getByTestId("provider-account-control").textContent ?? "";
      expect(label).toContain("Default");
      expect(label).not.toContain("steve");
    });
  });

  // Regression: with no pick yet the launch omits the account and the daemon
  // runs the active one, so the pill must name it rather than claim "Default".
  it("names the active account on the pill before anything is picked", () => {
    renderControl({
      accounts: [STEVE],
      defaultAccountId: "acct-steve",
      selectedAccountId: undefined,
    });
    const label = screen.getByTestId("provider-account-control").textContent ?? "";
    expect(label).toContain("steve");
    expect(label).not.toContain("Default");
  });

  // Default pins the primary config dir rather than following the active
  // account, so an explicit Default pick must not advertise that account's name.
  it("shows a plain Default on the pill for an explicit Default pick", () => {
    renderControl({
      accounts: [STEVE],
      defaultAccountId: "acct-steve",
      selectedAccountId: null,
    });
    const label = screen.getByTestId("provider-account-control").textContent ?? "";
    expect(label).toContain("Default");
    expect(label).not.toContain("steve");
  });
});
