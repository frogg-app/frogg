/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    onPress,
    testID,
  }: {
    label: string;
    description?: string;
    disabled?: boolean;
    accessibilityLabel?: string;
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
    ),
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

beforeEach(() => vi.stubGlobal("React", React));
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
  render(
    <ComposerControlLayoutProvider value={LAYOUT}>
      <ProviderAccountControl
        accounts={[STEVE]}
        defaultAccountId={null}
        selectedAccountId={undefined}
        {...props}
        onSelectAccount={onSelectAccount}
      />
    </ComposerControlLayoutProvider>,
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
    const { onSelectAccount } = renderControl({ selectedAccountId: "acct-steve" });
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

  it("names the daemon-wide active account on the pill", () => {
    renderControl({ accounts: [STEVE], defaultAccountId: "acct-steve" });
    expect(screen.getByTestId("provider-account-control").textContent).toContain("Default (steve)");
  });
});
