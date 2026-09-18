/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountsSection } from "./accounts-section";
import {
  providerAccountDefaultId,
  type ProviderAccountState,
} from "@frogg/protocol/provider-accounts";

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

const {
  accountsState,
  featureState,
  renameMock,
  signOutMock,
  removeMock,
  setActiveMock,
  createMock,
  exportMock,
  importMock,
  usageState,
} = vi.hoisted(() => ({
  accountsState: {
    accounts: [] as ProviderAccountState[],
    supported: true,
    connected: true,
  },
  featureState: { providerAccountManagement: true },
  renameMock: vi.fn(async () => ({ error: null, warnings: [] })),
  signOutMock: vi.fn(async () => ({ error: null, warnings: [] })),
  removeMock: vi.fn(async () => ({ error: null, warnings: [] })),
  setActiveMock: vi.fn(async () => ({ error: null, warnings: [] })),
  createMock: vi.fn(async () => ({ error: null, warnings: [] })),
  exportMock: vi.fn(async () => ({ error: null, bundle: null })),
  importMock: vi.fn(async () => ({ error: null, warnings: [] })),
  usageState: { view: { kind: "loading" } as { kind: string } },
}));

vi.mock("@/runtime/host-features", () => ({
  useHostFeature: (_serverId: string, feature: string) =>
    (featureState as Record<string, boolean>)[feature] === true,
}));

vi.mock("@/provider-accounts/use-provider-accounts", () => ({
  useProviderAccounts: () => ({
    supported: accountsState.supported,
    connected: accountsState.connected,
    payload: {
      accounts: accountsState.accounts,
      capabilities: [{ provider: "claude", enabled: true, linkableFolders: [] }],
    },
    isLoading: false,
    loadError: null,
    refresh: vi.fn(),
    create: { mutateAsync: createMock, isPending: false },
    remove: { mutateAsync: removeMock, isPending: false, variables: undefined },
    setActive: {
      mutateAsync: setActiveMock,
      isPending: false,
      variables: undefined,
    },
    rename: { mutateAsync: renameMock, isPending: false, variables: undefined },
    signOut: {
      mutateAsync: signOutMock,
      isPending: false,
      variables: undefined,
    },
    exportAccounts: { mutateAsync: exportMock, isPending: false },
    importAccounts: { mutateAsync: importMock, isPending: false },
  }),
}));

vi.mock("@/provider-accounts/use-authenticate-account", () => ({
  useAuthenticateProviderAccount: () => ({
    canAuthenticate: true,
    pendingAccountId: null,
    error: null,
    authenticate: vi.fn(),
  }),
}));

vi.mock("@/provider-accounts/create-account-modal", () => ({
  CreateProviderAccountModal: () =>
    React.createElement("div", {
      "data-testid": "provider-account-create-sheet",
    }),
}));

vi.mock("@/provider-usage/use-provider-usage", () => ({
  useProviderUsage: () => ({
    view: usageState.view,
    refresh: vi.fn(),
    canFetch: true,
  }),
}));

vi.mock("@/provider-usage/card", () => ({
  ProviderUsageCard: () => React.createElement("div", { "data-testid": "provider-usage-card" }),
}));

vi.mock("@/utils/confirm-dialog", () => ({
  confirmDialog: vi.fn(async () => true),
}));
vi.mock("@/utils/copy-to-clipboard", () => ({
  copyToClipboard: vi.fn(async () => undefined),
}));

const DEFAULT_ID = providerAccountDefaultId("claude");

function account(overrides: Partial<ProviderAccountState>): ProviderAccountState {
  return {
    id: DEFAULT_ID,
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

/** React tracks the input's value, so it has to be set through the native setter. */
function typeInto(input: HTMLElement | null, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input?.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AccountsSection", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    accountsState.accounts = [account({})];
    accountsState.supported = true;
    accountsState.connected = true;
    featureState.providerAccountManagement = true;
    usageState.view = { kind: "loading" };
    for (const mock of [renameMock, signOutMock, removeMock, exportMock, importMock]) {
      mock.mockClear();
    }
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
      root.render(<AccountsSection serverId="host-1" providerId="claude" />);
    });
  }

  it("offers rename for the provider's default account and sends the new label", async () => {
    render();

    expect(byTestId(container, `provider-account-rename-${DEFAULT_ID}`)).not.toBeNull();

    act(() => {
      byTestId(container, `provider-account-rename-${DEFAULT_ID}`)?.click();
    });

    const input = byTestId(container, `provider-account-rename-input-${DEFAULT_ID}`);
    expect(input).not.toBeNull();
    act(() => {
      typeInto(input, "Personal");
    });
    await act(async () => {
      byTestId(container, `provider-account-rename-submit-${DEFAULT_ID}`)?.click();
    });

    expect(renameMock).toHaveBeenCalledWith({
      accountId: DEFAULT_ID,
      name: "Personal",
    });
  });

  it("keeps the rename form open and surfaces a payload error", async () => {
    renameMock.mockResolvedValueOnce({
      error: "name already used",
      warnings: [],
    } as never);
    render();

    act(() => {
      byTestId(container, `provider-account-rename-${DEFAULT_ID}`)?.click();
    });
    const input = byTestId(container, `provider-account-rename-input-${DEFAULT_ID}`);
    act(() => {
      typeInto(input, "Work");
    });
    await act(async () => {
      byTestId(container, `provider-account-rename-submit-${DEFAULT_ID}`)?.click();
    });

    expect(byTestId(container, "provider-settings-accounts-error")?.textContent).toBe(
      "name already used",
    );
    expect(byTestId(container, `provider-account-rename-input-${DEFAULT_ID}`)).not.toBeNull();
  });

  it("signs an account out through the daemon", async () => {
    render();
    await act(async () => {
      byTestId(container, `provider-account-sign-out-${DEFAULT_ID}`)?.click();
    });
    expect(signOutMock).toHaveBeenCalledWith(DEFAULT_ID);
  });

  it("warns that an exported bundle is secret before showing it", async () => {
    exportMock.mockResolvedValueOnce({
      error: null,
      bundle: {
        version: 1,
        provider: "claude",
        exportedAt: "now",
        accounts: [],
      },
    } as never);
    render();

    await act(async () => {
      byTestId(container, "provider-settings-accounts-export")?.click();
    });

    const panel = byTestId(container, "provider-settings-accounts-export-panel");
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("accounts.exportWarning");
    expect(byTestId(container, "provider-settings-accounts-export-bundle")).not.toBeNull();
  });

  it("rejects a pasted bundle that is not a valid export", async () => {
    render();
    act(() => {
      byTestId(container, "provider-settings-accounts-import")?.click();
    });
    const input = byTestId(container, "provider-settings-accounts-import-input");
    act(() => {
      typeInto(input, "{}");
    });
    await act(async () => {
      byTestId(container, "provider-settings-accounts-import-submit")?.click();
    });

    expect(importMock).not.toHaveBeenCalled();
    expect(
      byTestId(container, "provider-settings-accounts-import-field-error")?.textContent,
    ).toContain("accounts.importInvalid");
  });

  it("imports a pasted bundle and clears the panel on success", async () => {
    render();
    act(() => {
      byTestId(container, "provider-settings-accounts-import")?.click();
    });
    const bundle = {
      version: 1,
      provider: "claude",
      exportedAt: "2026-01-01T00:00:00.000Z",
      accounts: [
        {
          account: account({ id: "claude:work", name: "work" }),
          credentials: [{ file: ".credentials.json", contentsBase64: "e30=" }],
        },
      ],
    };
    act(() => {
      typeInto(
        byTestId(container, "provider-settings-accounts-import-input"),
        JSON.stringify(bundle),
      );
    });
    await act(async () => {
      byTestId(container, "provider-settings-accounts-import-submit")?.click();
    });

    expect(importMock).toHaveBeenCalledTimes(1);
    const [imported] = importMock.mock.calls[0] as unknown as [unknown];
    expect(imported).toMatchObject({ provider: "claude", version: 1 });
    expect(byTestId(container, "provider-settings-accounts-import-panel")).toBeNull();
  });

  it("keeps the pasted bundle and the panel open when the import is rejected", async () => {
    importMock.mockResolvedValueOnce({ error: "account already exists", warnings: [] } as never);
    render();
    act(() => {
      byTestId(container, "provider-settings-accounts-import")?.click();
    });
    const bundle = {
      version: 1,
      provider: "claude",
      exportedAt: "2026-01-01T00:00:00.000Z",
      accounts: [],
    };
    act(() => {
      typeInto(
        byTestId(container, "provider-settings-accounts-import-input"),
        JSON.stringify(bundle),
      );
    });
    await act(async () => {
      byTestId(container, "provider-settings-accounts-import-submit")?.click();
    });

    expect(byTestId(container, "provider-settings-accounts-error")?.textContent).toBe(
      "account already exists",
    );
    expect(byTestId(container, "provider-settings-accounts-import-panel")).not.toBeNull();
  });

  it("removes an account after confirmation", async () => {
    render();
    await act(async () => {
      byTestId(container, `provider-account-remove-${DEFAULT_ID}`)?.click();
    });
    expect(removeMock).toHaveBeenCalledWith(DEFAULT_ID);
  });

  it("reuses the shared provider usage card once usage is ready", () => {
    usageState.view = {
      kind: "ready",
      payload: { providers: [{ providerId: "claude" }] },
    } as never;
    render();

    expect(byTestId(container, "provider-settings-accounts-usage")).not.toBeNull();
    expect(byTestId(container, "provider-usage-card")).not.toBeNull();
  });

  it("hides rename, sign out, export and import when the daemon lacks the management feature", () => {
    featureState.providerAccountManagement = false;
    render();

    expect(byTestId(container, `provider-account-rename-${DEFAULT_ID}`)).toBeNull();
    expect(byTestId(container, `provider-account-sign-out-${DEFAULT_ID}`)).toBeNull();
    expect(byTestId(container, "provider-settings-accounts-transfer")).toBeNull();
    // Removing an account predates the flag and stays available.
    expect(byTestId(container, `provider-account-remove-${DEFAULT_ID}`)).not.toBeNull();
  });
});
