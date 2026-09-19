import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import {
  ProviderAccountTransferModal,
  type ProviderAccountTransferOption,
} from "./provider-account-transfer-modal";

// Initialises i18next so the sheet renders real English copy.
void i18n;

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 2: 8, 3: 12 },
    fontSize: { base: 15 },
    colors: { palette: { red: { 300: "#f87171" } } },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ theme }),
}));

vi.mock("@/components/adaptive-modal-sheet", async () => {
  const ReactModule = await import("react");
  return {
    AdaptiveModalSheet: ({
      visible,
      children,
      testID,
    }: {
      visible: boolean;
      children: React.ReactNode;
      testID?: string;
    }) => (visible ? ReactModule.createElement("div", { "data-testid": testID }, children) : null),
  };
});

vi.mock("@/components/ui/alert", async () => {
  const ReactModule = await import("react");
  return {
    Alert: ({ description, testID }: { description: string; testID?: string }) =>
      ReactModule.createElement("div", { "data-testid": testID }, description),
  };
});

vi.mock("@/components/ui/select-field", async () => {
  const ReactModule = await import("react");
  return {
    SelectField: ({
      options,
      onChange,
    }: {
      options: { id: string; value: string; label: string; testID?: string }[];
      onChange: (value: string, display: { label: string }) => void;
    }) =>
      ReactModule.createElement(
        "div",
        null,
        options.map((option) =>
          ReactModule.createElement(
            "button",
            {
              key: option.id,
              type: "button",
              "data-testid": option.testID,
              onClick: () => onChange(option.value, { label: option.label }),
            },
            option.label,
          ),
        ),
      ),
  };
});

vi.mock("@/components/ui/button", async () => {
  const ReactModule = await import("react");
  return {
    Button: ({
      children,
      onPress,
      disabled,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      testID?: string;
    }) =>
      ReactModule.createElement(
        "button",
        {
          type: "button",
          "data-testid": testID,
          disabled: disabled || undefined,
          onClick: () => !disabled && onPress?.(),
        },
        children,
      ),
  };
});

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("navigator", dom.window.navigator);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

const OTHER: ProviderAccountTransferOption = {
  id: "acct-other",
  label: "Other",
  authenticated: true,
};
const SIGNED_OUT: ProviderAccountTransferOption = {
  id: "acct-out",
  label: "Signed out",
  authenticated: false,
};

const noop = () => {};

function render(props: {
  options: ProviderAccountTransferOption[];
  contextTokens?: number | null;
  onConfirm?: (id: string) => void;
}) {
  act(() => {
    root?.render(
      <ProviderAccountTransferModal
        visible
        options={props.options}
        contextTokens={props.contextTokens ?? null}
        isPending={false}
        error={null}
        onClose={noop}
        onConfirm={props.onConfirm ?? noop}
      />,
    );
  });
}

function byTestId(id: string): HTMLButtonElement {
  const node = container?.querySelector(`[data-testid="${id}"]`);
  if (!node) throw new Error(`missing ${id}`);
  return node as HTMLButtonElement;
}

describe("ProviderAccountTransferModal", () => {
  it("states the real context size as the cost of the move", () => {
    render({ options: [OTHER, SIGNED_OUT], contextTokens: 128_000 });
    const warning = byTestId("provider-account-transfer-warning").textContent ?? "";
    expect(warning).toContain("128");
    expect(warning).toContain("full (uncached) price");
  });

  it("states the cost without a number when the context size is unknown", () => {
    render({ options: [OTHER, SIGNED_OUT], contextTokens: null });
    const warning = byTestId("provider-account-transfer-warning").textContent ?? "";
    expect(warning).not.toMatch(/\d/);
    expect(warning).toContain("full (uncached) price");
  });

  it("enables the move only once a signed-in destination is picked", () => {
    const onConfirm = vi.fn();
    render({ options: [OTHER, SIGNED_OUT], onConfirm });
    expect(byTestId("provider-account-transfer-confirm").disabled).toBe(true);

    act(() => byTestId("provider-account-transfer-option-acct-out").click());
    expect(byTestId("provider-account-transfer-confirm").disabled).toBe(true);

    act(() => byTestId("provider-account-transfer-option-acct-other").click());
    expect(byTestId("provider-account-transfer-confirm").disabled).toBe(false);
    act(() => byTestId("provider-account-transfer-confirm").click());
    expect(onConfirm).toHaveBeenCalledWith("acct-other");
  });

  it("preselects the only destination", () => {
    render({ options: [OTHER] });
    expect(byTestId("provider-account-transfer-confirm").disabled).toBe(false);
  });
});
