/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  providerAccountDefaultId,
  type ProviderAccountState,
} from "@frogg/protocol/provider-accounts";
import type { AgentModelDefinition } from "@frogg/protocol/agent-types";
import { AccountPane } from "./account-pane";
import {
  isSynthesizedAccount,
  providerAccountDisplayName,
  withDefaultAccount,
} from "./account-tabs";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, "1.5": 6, 2: 8, 3: 12, 4: 16, 6: 24 },
    iconSize: { sm: 14, md: 20 },
    fontSize: { sm: 12, base: 14, xl: 18 },
    fontWeight: { normal: "400", medium: "500" },
    borderRadius: { sm: 4, md: 6, lg: 8, xl: 12, full: 999 },
    opacity: { 50: 0.5 },
    fontFamily: { mono: "monospace" },
    colors: {
      surface0: "#000",
      surface1: "#111",
      surface2: "#222",
      surface3: "#333",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      border: "#555",
      muted: "#333",
      primary: "#0a84ff",
      statusSuccess: "#0f0",
      statusWarning: "#ff9500",
      statusDanger: "#f00",
      palette: { white: "#fff" },
    },
  },
}));

vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
  Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("span", { "data-testid": testID }, children),
  ScrollView: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
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

vi.mock("@/styles/theme", () => ({ ICON_SIZE: { sm: 14, md: 20 } }));

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
  return { Plus: icon("Plus"), Trash2: icon("Trash2"), Check: icon("Check") };
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
  Alert: ({ title }: { title?: string }) =>
    React.createElement("div", { "data-testid": "alert" }, title),
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

vi.mock("@/components/ui/select-field", () => ({
  SelectField: ({
    value,
    options,
    onChange,
    testID,
  }: {
    value: string;
    options: { id: string; value: string; label: string }[];
    onChange?: (next: string) => void;
    testID?: string;
  }) =>
    React.createElement(
      "select",
      {
        "data-testid": testID,
        value,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange?.(event.target.value),
      },
      options.map((option) =>
        React.createElement("option", { key: option.id, value: option.value }, option.label),
      ),
    ),
}));

vi.mock("@/components/settings-textarea", () => ({
  SettingsTextArea: ({
    value,
    onChangeText,
    testID,
  }: {
    value?: string;
    onChangeText?: (next: string) => void;
    testID?: string;
  }) =>
    React.createElement("textarea", {
      "data-testid": testID,
      defaultValue: value,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
        onChangeText?.(event.target.value),
    }),
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

vi.mock("@/provider-usage/card", () => ({
  ProviderUsageCard: () => React.createElement("div", { "data-testid": "provider-usage-card" }),
}));

const { confirmDialogMock } = vi.hoisted(() => ({ confirmDialogMock: vi.fn(async () => true) }));
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: confirmDialogMock }));
vi.mock("@/utils/copy-to-clipboard", () => ({ copyToClipboard: vi.fn(async () => undefined) }));

const DEFAULT_ID = providerAccountDefaultId("claude");

function account(overrides: Partial<ProviderAccountState> = {}): ProviderAccountState {
  return {
    id: "claude:work",
    provider: "claude",
    name: "work",
    configDir: "~/.claude-work",
    linkedFolders: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    authenticated: true,
    isActive: true,
    ...overrides,
  };
}

const MODELS: AgentModelDefinition[] = [
  {
    id: "opus",
    label: "Opus",
    provider: "claude",
    thinkingOptions: [
      { id: "low", label: "Low" },
      { id: "high", label: "High" },
    ],
  },
  { id: "sonnet", label: "Sonnet", provider: "claude" },
] as AgentModelDefinition[];

const setActiveMock = vi.fn(async () => ({ error: null, warnings: [] }));
const removeMock = vi.fn<() => Promise<{ error: string | null; warnings: string[] }>>(async () => ({
  error: null,
  warnings: [],
}));
const renameMock = vi.fn(async () => ({ error: null, warnings: [] }));
const signOutMock = vi.fn(async () => ({ error: null, warnings: [] }));
const setAllowedModelsMock = vi.fn(async () => ({ error: null, warnings: [] }));
const setPreferencesMock = vi.fn(async () => ({ error: null, warnings: [] }));
const authenticateMock = vi.fn();
const onDeleted = vi.fn();

function accountsStub() {
  const idle = { isPending: false, variables: undefined };
  return {
    connected: true,
    supported: true,
    payload: null,
    isLoading: false,
    loadError: null,
    refresh: vi.fn(),
    create: { mutateAsync: vi.fn(), ...idle },
    remove: { mutateAsync: removeMock, ...idle },
    setActive: { mutateAsync: setActiveMock, ...idle },
    rename: { mutateAsync: renameMock, ...idle },
    signOut: { mutateAsync: signOutMock, ...idle },
    setAllowedModels: { mutateAsync: setAllowedModelsMock, ...idle },
    setPreferences: { mutateAsync: setPreferencesMock, ...idle },
    exportAccounts: { mutateAsync: vi.fn(), ...idle },
    importAccounts: { mutateAsync: vi.fn(), ...idle },
  } as unknown as Parameters<typeof AccountPane>[0]["accounts"];
}

function authStub() {
  return {
    authenticate: authenticateMock,
    canAuthenticate: true,
    isPending: false,
    pendingAccountId: null,
    error: null,
  } as unknown as Parameters<typeof AccountPane>[0]["auth"];
}

function byTestId(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

describe("AccountPane", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    for (const mock of [
      setActiveMock,
      removeMock,
      renameMock,
      signOutMock,
      setAllowedModelsMock,
      setPreferencesMock,
      authenticateMock,
      onDeleted,
      confirmDialogMock,
    ]) {
      mock.mockClear();
    }
    confirmDialogMock.mockResolvedValue(true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(overrides: Partial<Parameters<typeof AccountPane>[0]> = {}) {
    act(() => {
      root.render(
        <AccountPane
          providerId="claude"
          providerLabel="Claude Code"
          account={account()}
          models={MODELS}
          accounts={accountsStub()}
          auth={authStub()}
          canManage
          canRestrictModels
          canSetPreferences
          usage={null}
          synthesized={false}
          onDeleted={onDeleted}
          {...overrides}
        />,
      );
    });
  }

  it("shows everything about the account under its own pane", () => {
    render();

    expect(byTestId(container, "provider-account-hero")).not.toBeNull();
    expect(byTestId(container, "provider-account-defaults")).not.toBeNull();
    expect(byTestId(container, "provider-account-models")).not.toBeNull();
    expect(byTestId(container, "provider-account-system-prompt")).not.toBeNull();
    expect(byTestId(container, "provider-account-identity")).not.toBeNull();
    expect(byTestId(container, "provider-account-danger")).not.toBeNull();
  });

  it("makes the default account active as 'no active account'", async () => {
    render({ account: account({ id: DEFAULT_ID, name: "default", isActive: false }) });

    await act(async () => {
      byTestId(container, "provider-account-make-active")?.click();
    });

    expect(setActiveMock).toHaveBeenCalledWith({ provider: "claude", accountId: null });
  });

  it("denies one model by sending the rest of the catalogue", async () => {
    render();

    await act(async () => {
      byTestId(container, "provider-account-model-toggle-sonnet")?.click();
    });

    expect(setAllowedModelsMock).toHaveBeenCalledWith({
      accountId: "claude:work",
      allowedModels: ["opus"],
    });
  });

  it("spells allowing every model again as no restriction", async () => {
    render({ account: account({ allowedModels: ["opus"] }) });

    await act(async () => {
      byTestId(container, "provider-account-model-toggle-sonnet")?.click();
    });

    expect(setAllowedModelsMock).toHaveBeenCalledWith({
      accountId: "claude:work",
      allowedModels: null,
    });
  });

  it("starts a new default model from that model's own thinking level", async () => {
    render({
      account: account({
        preferences: { color: "sky", defaultModelId: "opus", defaultThinkingOptionId: "high" },
      }),
    });

    const select = byTestId(container, "provider-account-default-model") as HTMLSelectElement;
    await act(async () => {
      select.value = "sonnet";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(setPreferencesMock).toHaveBeenCalledWith({
      accountId: "claude:work",
      preferences: { color: "sky", defaultModelId: "sonnet", defaultThinkingOptionId: undefined },
    });
  });

  it("keeps the other preferences when only the colour changes", async () => {
    render({ account: account({ preferences: { systemPrompt: "be brief" } }) });

    await act(async () => {
      byTestId(container, "provider-account-color-teal")?.click();
    });

    expect(setPreferencesMock).toHaveBeenCalledWith({
      accountId: "claude:work",
      preferences: { systemPrompt: "be brief", color: "teal" },
    });
  });

  it("saves a trimmed system prompt", async () => {
    render();

    const textarea = byTestId(container, "provider-account-system-prompt-input");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, "  always run tests  ");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      byTestId(container, "provider-account-system-prompt-save")?.click();
    });

    expect(setPreferencesMock).toHaveBeenCalledWith({
      accountId: "claude:work",
      preferences: { systemPrompt: "always run tests" },
    });
  });

  it("confirms before deleting and tells the sheet the tab is gone", async () => {
    render();

    await act(async () => {
      byTestId(container, "provider-account-delete")?.click();
    });

    expect(confirmDialogMock).toHaveBeenCalled();
    expect(removeMock).toHaveBeenCalledWith("claude:work");
    expect(onDeleted).toHaveBeenCalled();
  });

  it("keeps the tab when deleting is refused", async () => {
    removeMock.mockResolvedValueOnce({ error: "in use", warnings: [] });
    render();

    await act(async () => {
      byTestId(container, "provider-account-delete")?.click();
    });

    expect(onDeleted).not.toHaveBeenCalled();
    expect(byTestId(container, "provider-account-danger-error")?.textContent).toBe("in use");
  });

  it("hides preference sections the daemon does not accept", () => {
    render({ canSetPreferences: false, canRestrictModels: false });

    expect(byTestId(container, "provider-account-defaults")).toBeNull();
    expect(byTestId(container, "provider-account-models")).toBeNull();
    expect(byTestId(container, "provider-account-system-prompt")).toBeNull();
  });
});

describe("account tabs model", () => {
  const t = ((key: string) => key) as unknown as Parameters<typeof providerAccountDisplayName>[1];

  it("names the provider's implicit default account", () => {
    expect(providerAccountDisplayName({ id: DEFAULT_ID, name: "default" }, t)).toBe(
      "agentControls.account.default",
    );
    expect(providerAccountDisplayName({ id: DEFAULT_ID, name: "Personal" }, t)).toBe("Personal");
    expect(providerAccountDisplayName({ id: "claude:work", name: "work" }, t)).toBe("work");
  });

  it("gives the default sign-in a tab even when the daemon has not stored one", () => {
    const stored = [account({ isActive: true })];
    const tabs = withDefaultAccount(stored, "claude");

    expect(tabs.map((entry) => entry.id)).toEqual([DEFAULT_ID, "claude:work"]);
    // Another account is active, so the synthesized default is not.
    expect(tabs[0]!.isActive).toBe(false);
    expect(isSynthesizedAccount(stored, tabs[0]!)).toBe(true);
    expect(isSynthesizedAccount(stored, tabs[1]!)).toBe(false);
  });

  it("leaves a stored default account alone", () => {
    const stored = [account({ id: DEFAULT_ID, name: "Personal", isActive: true })];
    expect(withDefaultAccount(stored, "claude")).toEqual(stored);
  });
});
