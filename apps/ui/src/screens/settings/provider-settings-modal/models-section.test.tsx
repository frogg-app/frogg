/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelsSection } from "./models-section";
import type { ProviderAccountState } from "@frogg/protocol/provider-accounts";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, "1.5": 6, 2: 8, 3: 12, 4: 16, 6: 24 },
    iconSize: { sm: 14, md: 20 },
    fontSize: { xs: 11, sm: 13, base: 15 },
    fontWeight: { normal: "400", medium: "500" },
    borderRadius: { sm: 4, md: 6, lg: 8 },
    opacity: { 50: 0.5 },
    fontFamily: { mono: "monospace" },
    colors: {
      surface1: "#111",
      surface2: "#222",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      border: "#555",
      muted: "#333",
      primary: "#0a84ff",
      primaryForeground: "#fff",
      destructive: "#f00",
      accent: "#0a84ff",
      statusSuccess: "#0f0",
      statusWarning: "#ff9500",
      statusDanger: "#f00",
      palette: { red: { 300: "#ff6b6b" }, white: "#fff" },
    },
  },
}));

vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
  Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("span", { "data-testid": testID }, children),
  Pressable: ({
    children,
    onPress,
    accessibilityRole,
    accessibilityLabel,
    disabled,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    accessibilityRole?: string;
    accessibilityLabel?: string;
    disabled?: boolean;
    testID?: string;
  }) =>
    React.createElement(
      "div",
      {
        role: accessibilityRole,
        "aria-label": accessibilityLabel,
        "data-testid": testID,
        onClick: disabled ? undefined : () => onPress?.(),
      },
      children,
    ),
  ActivityIndicator: () => React.createElement("span", null),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function" ? (factory as (t: typeof theme) => unknown)(theme) : factory,
  },
  useUnistyles: () => ({ theme, rt: { breakpoint: "md" } }),
  withUnistyles: (Component: unknown) => Component,
}));

vi.mock("lucide-react-native", () => {
  const icon = (name: string) => {
    const Component = () => React.createElement("span", { "data-icon": name });
    Component.displayName = `Icon(${name})`;
    return Component;
  };
  return {
    Trash2: icon("Trash2"),
    Plus: icon("Plus"),
    RotateCw: icon("RotateCw"),
    Check: icon("Check"),
  };
});

// The key is asserted, not the copy: wording is covered by the i18n parity test.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      values && Object.keys(values).length > 0 ? `${key}:${Object.values(values).join(",")}` : key,
  }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      {
        type: "button",
        "data-testid": testID,
        "aria-label": accessibilityLabel,
        disabled,
        onClick: () => onPress?.(),
      },
      children,
    ),
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ label, variant }: { label: string; variant?: string }) =>
    React.createElement("span", { "data-variant": variant }, label),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    value,
    onValueChange,
    disabled,
    accessibilityLabel,
    testID,
  }: {
    value: boolean;
    onValueChange?: (next: boolean) => void;
    disabled?: boolean;
    accessibilityLabel?: string;
    testID?: string;
  }) =>
    React.createElement("div", {
      role: "switch",
      "aria-checked": value ? "true" : "false",
      "aria-label": accessibilityLabel,
      "data-testid": testID,
      onClick: () => {
        if (!disabled) onValueChange?.(!value);
      },
    }),
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () => React.createElement("span", { "data-testid": "loading-spinner" }),
}));

vi.mock("@/components/ui/alert", () => ({
  Alert: ({ title, description }: { title?: string; description?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "alert" }, title, description),
}));

vi.mock("@/components/ui/form-field", () => ({
  Field: ({
    children,
    label,
    error,
    testID,
  }: {
    children?: React.ReactNode;
    label?: string;
    error?: string | null;
    testID?: string;
  }) =>
    React.createElement(
      "div",
      { "data-testid": testID },
      React.createElement("span", null, label),
      children,
      error ? React.createElement("span", { "data-testid": `${testID}-error` }, error) : null,
    ),
  FormTextInput: ({
    initialValue,
    onChangeText,
    testID,
  }: {
    initialValue?: string;
    onChangeText?: (value: string) => void;
    testID?: string;
  }) =>
    React.createElement("input", {
      "data-testid": testID,
      defaultValue: initialValue,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChangeText?.(event.target.value),
    }),
}));

vi.mock("@/screens/settings/settings-section", () => ({
  SettingsSection: ({
    children,
    title,
    trailing,
    testID,
  }: {
    children?: React.ReactNode;
    title?: string;
    trailing?: React.ReactNode;
    testID?: string;
  }) =>
    React.createElement(
      "section",
      { "data-testid": testID },
      React.createElement("h3", null, title),
      trailing,
      children,
    ),
}));

vi.mock("@/styles/settings", () => ({
  settingsStyles: {
    card: {},
    row: {},
    rowBorder: {},
    rowContent: {},
    rowTitle: {},
    rowHint: {},
    rowError: {},
  },
}));

vi.mock("@/styles/theme", () => ({ ICON_SIZE: { sm: 14, md: 20 } }));

const { accountsState, snapshotState, featureState, setAllowedModelsMock } = vi.hoisted(() => ({
  accountsState: { accounts: [] as ProviderAccountState[], supported: true },
  snapshotState: {
    entries: [
      {
        provider: "claude",
        status: "ready",
        enabled: true,
        label: "Claude",
        description: "Claude Code",
        defaultModeId: null,
        modes: [],
        models: [
          { provider: "claude", id: "opus", label: "Opus" },
          { provider: "claude", id: "fable", label: "Fable" },
        ],
      },
    ] as unknown[],
  },
  featureState: { providerAccountAllowedModels: true },
  setAllowedModelsMock: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => ({
    entries: snapshotState.entries,
    isLoading: false,
  }),
}));

vi.mock("@/runtime/host-features", () => ({
  useHostFeature: (_serverId: string, feature: string) =>
    (featureState as Record<string, boolean>)[feature] === true,
}));

vi.mock("@/provider-accounts/use-provider-accounts", () => ({
  useProviderAccounts: () => ({
    supported: accountsState.supported,
    connected: true,
    payload: { accounts: accountsState.accounts, capabilities: [] },
    isLoading: false,
    loadError: null,
    refresh: vi.fn(),
    setAllowedModels: { mutateAsync: setAllowedModelsMock, isPending: false },
  }),
}));

function account(overrides: Partial<ProviderAccountState>): ProviderAccountState {
  return {
    id: "claude:default",
    provider: "claude",
    name: "default",
    configDir: "~/.claude",
    linkedFolders: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    authenticated: true,
    isActive: true,
    ...overrides,
  };
}

function byTestId(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

describe("ModelsSection", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    accountsState.accounts = [];
    accountsState.supported = true;
    featureState.providerAccountAllowedModels = true;
    setAllowedModelsMock.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render() {
    act(() => {
      root.render(<ModelsSection serverId="host-1" providerId="claude" />);
    });
  }

  it("renders each restriction state distinguishably", () => {
    accountsState.accounts = [
      account({ id: "claude:default", name: "default" }),
      account({
        id: "claude:work",
        name: "work",
        isActive: false,
        allowedModels: ["opus"],
      }),
      account({
        id: "claude:locked",
        name: "locked",
        isActive: false,
        allowedModels: [],
      }),
    ];
    render();

    const unrestricted = byTestId(container, "provider-settings-models-state-claude:default");
    const partial = byTestId(container, "provider-settings-models-state-claude:work");
    const none = byTestId(container, "provider-settings-models-state-claude:locked");

    expect(unrestricted?.textContent).toContain("models.unrestricted");
    expect(partial?.textContent).toContain("models.restrictedCount:1,2");
    expect(none?.textContent).toContain("models.none");
    expect(new Set([unrestricted?.textContent, partial?.textContent, none?.textContent]).size).toBe(
      3,
    );
  });

  it("denies a single model from an unrestricted account by sending the rest of the catalogue", () => {
    accountsState.accounts = [account({})];
    render();

    act(() => {
      byTestId(container, "provider-settings-models-account-claude:default")?.click();
    });
    act(() => {
      byTestId(container, "provider-settings-model-toggle-fable")?.click();
    });

    expect(setAllowedModelsMock).toHaveBeenCalledWith({
      accountId: "claude:default",
      allowedModels: ["opus"],
    });
  });

  it("hides the restriction affordances when the daemon does not advertise the feature", () => {
    accountsState.accounts = [account({})];
    featureState.providerAccountAllowedModels = false;
    render();

    expect(byTestId(container, "provider-settings-models-accounts")).toBeNull();
    expect(byTestId(container, "provider-settings-model-toggle-opus")).toBeNull();
    expect(byTestId(container, "provider-settings-models-allow-all")).toBeNull();
    // The catalogue itself is still readable.
    expect(byTestId(container, "provider-settings-model-row-opus")).not.toBeNull();
  });
});
