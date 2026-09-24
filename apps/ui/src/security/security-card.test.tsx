/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createInstance } from "i18next";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { en } from "@/i18n/resources/en";

const runtime = vi.hoisted(() => ({
  client: null as Record<string, ReturnType<typeof vi.fn>> | null,
  navigate: vi.fn(),
}));

vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: () => {},
      addListener: () => {},
      removeEventListener: () => {},
      removeListener: () => {},
      matches: false,
      media: "",
    }),
  });
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
  withUnistyles: (component: unknown) => component,
  useUnistyles: () => ({ theme: {} }),
}));
vi.mock("@/components/ui/button", async () => {
  const React = await import("react");
  return {
    Button: (props: {
      children: unknown;
      onPress?: () => void;
      disabled?: boolean;
      testID?: string;
    }) =>
      React.createElement(
        "button",
        {
          type: "button",
          onClick: props.onPress,
          disabled: props.disabled,
          "data-testid": props.testID,
        },
        props.children as never,
      ),
  };
});
vi.mock("@/components/ui/status-badge", () => ({ StatusBadge: () => null }));
vi.mock("@/screens/settings/settings-section", async () => {
  const React = await import("react");
  return {
    SettingsSection: (props: { children: unknown; testID?: string }) =>
      React.createElement("section", { "data-testid": props.testID }, props.children as never),
  };
});
vi.mock("@/components/ui/form-field", async () => {
  const React = await import("react");
  return {
    Field: (props: { children: unknown; error?: string | null }) =>
      React.createElement("div", null, props.children as never, props.error ?? null),
    FormTextInput: (props: {
      testID?: string;
      onChangeText: (value: string) => void;
      editable?: boolean;
    }) =>
      React.createElement("input", {
        "data-testid": props.testID,
        disabled: props.editable === false,
        onChange: (event: { target: { value: string } }) => props.onChangeText(event.target.value),
      }),
  };
});
vi.mock("@/panels/register-panels", () => ({ ensurePanelsRegistered() {} }));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
  useRouter: () => ({}),
  router: { push: () => {}, replace: () => {} },
}));
vi.mock("@/navigation/settings-navigation", () => ({ navigateSettings: runtime.navigate }));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => runtime.client,
  useHostRuntimeIsConnected: () => true,
}));

const { HostSecurityCard } = await import("./security-card");
const { useSessionStore } = await import("@/stores/session-store");

const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: en } } });

const SERVER = "srv";
const t = en.settings.host.security;
interface Finding {
  id: string;
  severity: string;
  fixAction: string;
}

function seed(findings: Finding[], features: Record<string, boolean> = { securityPosture: true }) {
  const store = useSessionStore.getState();
  store.initializeSession(SERVER, null as unknown as DaemonClient);
  store.updateSessionServerInfo(SERVER, {
    serverId: SERVER,
    hostname: "h",
    version: "1.6.0",
    features,
    callerRole: "owner",
    security: { findings },
  });
}

function renderCard() {
  return render(
    <I18nextProvider i18n={i18n}>
      <HostSecurityCard serverId={SERVER} />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  runtime.navigate.mockReset();
  runtime.client = {
    getDaemonSecurityPosture: vi.fn(async () => ({ requestId: "r", posture: null, error: null })),
    setDaemonPassword: vi.fn(async () => ({ requestId: "r", settings: null, error: null })),
    updateAuthSettings: vi.fn(async () => ({ requestId: "r", settings: null, error: null })),
  };
});
afterEach(cleanup);

describe("HostSecurityCard", () => {
  it("renders nothing for a daemon without the feature", () => {
    seed([{ id: "unclaimed", severity: "critical", fixAction: "claim" }], {});
    renderCard();
    expect(screen.queryByTestId("host-security-card")).toBeNull();
  });

  it("lists findings in plain language and routes the claim fix to pairing", async () => {
    seed([
      { id: "unclaimed", severity: "critical", fixAction: "claim" },
      { id: "bind_diverges", severity: "warning", fixAction: "bind_loopback" },
    ]);
    renderCard();
    expect(screen.getByText(t.findings.unclaimed.title)).toBeTruthy();
    expect(screen.getByText(t.bindInstructions)).toBeTruthy();
    fireEvent.click(screen.getByTestId("host-security-fix-unclaimed-claim"));
    expect(runtime.navigate).toHaveBeenCalledWith({
      kind: "host",
      serverId: SERVER,
      section: "pair-device",
    });
    await waitFor(() => expect(runtime.client?.getDaemonSecurityPosture).toHaveBeenCalled());
  });

  it("validates the password before sending it", async () => {
    seed([{ id: "exposed_without_password", severity: "critical", fixAction: "set_password" }]);
    renderCard();
    fireEvent.click(screen.getByTestId("host-security-fix-exposed_without_password"));
    fireEvent.change(screen.getByTestId("host-security-password-input"), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByTestId("host-security-password-save"));
    expect(screen.getByText(t.password.tooShort)).toBeTruthy();
    fireEvent.change(screen.getByTestId("host-security-password-input"), {
      target: { value: "long-enough" },
    });
    fireEvent.change(screen.getByTestId("host-security-password-confirm"), {
      target: { value: "different!" },
    });
    fireEvent.click(screen.getByTestId("host-security-password-save"));
    expect(screen.getByText(t.password.mismatch)).toBeTruthy();
    expect(runtime.client?.setDaemonPassword).not.toHaveBeenCalled();
  });

  it("sets the password, then refetches the posture", async () => {
    seed([{ id: "exposed_without_password", severity: "critical", fixAction: "set_password" }]);
    runtime.client!.getDaemonSecurityPosture = vi.fn(async () => ({
      requestId: "r",
      posture: { findings: [] },
      error: null,
    }));
    renderCard();
    fireEvent.click(screen.getByTestId("host-security-fix-exposed_without_password"));
    for (const id of ["host-security-password-input", "host-security-password-confirm"]) {
      fireEvent.change(screen.getByTestId(id), { target: { value: "correct horse" } });
    }
    await act(async () => {
      fireEvent.click(screen.getByTestId("host-security-password-save"));
    });
    expect(runtime.client?.setDaemonPassword).toHaveBeenCalledWith("correct horse");
    await waitFor(() => expect(screen.queryByTestId("host-security-card")).toBeNull());
  });

  it("keeps the typed password and shows the daemon's error when setting fails", async () => {
    seed([{ id: "exposed_without_password", severity: "critical", fixAction: "set_password" }]);
    runtime.client!.setDaemonPassword = vi.fn(async () => ({
      requestId: "r",
      settings: null,
      error: "forbidden",
    }));
    renderCard();
    fireEvent.click(screen.getByTestId("host-security-fix-exposed_without_password"));
    for (const id of ["host-security-password-input", "host-security-password-confirm"]) {
      fireEvent.change(screen.getByTestId(id), { target: { value: "correct horse" } });
    }
    await act(async () => {
      fireEvent.click(screen.getByTestId("host-security-password-save"));
    });
    expect(screen.getByTestId("host-security-password-error").textContent).toContain("forbidden");
    expect((screen.getByTestId("host-security-password-input") as HTMLInputElement).value).toBe(
      "correct horse",
    );
  });

  it("turns off LAN trust through auth settings", async () => {
    seed([{ id: "trust_lan_diverges", severity: "warning", fixAction: "disable_trust_lan" }]);
    renderCard();
    await act(async () => {
      fireEvent.click(screen.getByTestId("host-security-fix-trust_lan_diverges"));
    });
    expect(runtime.client?.updateAuthSettings).toHaveBeenCalledWith({ trustLan: false });
  });
});
