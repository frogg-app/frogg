/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createInstance } from "i18next";
import { en } from "@/i18n/resources/en";
import type { HostProfile } from "@/types/host-connection";
import type { HostRuntimeSnapshot } from "@/runtime/host-runtime";

const runtime = vi.hoisted(() => ({
  snapshot: null as Partial<HostRuntimeSnapshot> | null,
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

vi.mock("@/panels/register-panels", () => ({ ensurePanelsRegistered() {} }));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
  useRouter: () => ({}),
}));
vi.mock("@/runtime/host-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/runtime/host-runtime")>()),
  useHostRuntimeSnapshot: () => runtime.snapshot,
}));

const { HostStatusBadges } = await import("./host-status-badges");

const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: en } } });

const host = {
  serverId: "srv",
  label: "Studio",
  connections: [{ id: "tcp", type: "directTcp", endpoint: "192.168.1.17:9999" }],
} as unknown as HostProfile;

afterEach(cleanup);

function renderWith(snapshot: Partial<HostRuntimeSnapshot> | null) {
  runtime.snapshot = snapshot;
  render(
    <I18nextProvider i18n={i18n}>
      <HostStatusBadges host={host} />
    </I18nextProvider>,
  );
}

describe("host header", () => {
  const address = "TCP (192.168.1.17:9999)";

  it.each([
    ["no snapshot yet", null],
    [
      "connecting while probes are out",
      { connectionStatus: "connecting", activeConnectionId: null },
    ],
    ["connecting to the picked one", { connectionStatus: "connecting", activeConnectionId: "tcp" }],
    ["online", { connectionStatus: "online", activeConnectionId: "tcp" }],
    ["error", { connectionStatus: "error", activeConnectionId: "tcp" }],
    ["offline after stopping", { connectionStatus: "offline", activeConnectionId: null }],
  ] as const)("keeps the dialled address and port visible: %s", (_state, snapshot) => {
    renderWith(snapshot as Partial<HostRuntimeSnapshot> | null);
    expect(screen.getByText(address)).toBeTruthy();
  });

  it("changes only the status beside it", () => {
    renderWith({ connectionStatus: "connecting", activeConnectionId: null });
    expect(screen.getByText("Connecting")).toBeTruthy();
    cleanup();
    renderWith({ connectionStatus: "online", activeConnectionId: "tcp" });
    expect(screen.getByText("Online")).toBeTruthy();
    expect(screen.getByText(address)).toBeTruthy();
  });
});
