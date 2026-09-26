/** @vitest-environment jsdom */
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { View } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { createInstance } from "i18next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { en } from "@/i18n/resources/en";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { MOTION_SWAP_DURATION_MS } from "@/styles/motion";

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

// A stand-in for the account so the row has one without a provider snapshot, testID'd the same.
vi.mock("@/components/sidebar/workspace-account", async () => {
  const { createElement } = await import("react");
  return {
    SidebarWorkspaceAccountIndicator: () =>
      createElement("div", { "data-testid": "sidebar-workspace-account" }, "work"),
    SidebarAccountIndicator: () => null,
  };
});
vi.mock("@/components/sidebar/workspace-meta-row", () => ({ WorkspaceMetaRow: () => null }));
vi.mock("@/stores/sidebar-hidden-store/use-hide-toggles", () => ({
  useSidebarHideToggles: () => ({ toggleProject() {}, toggleWorkspace() {} }),
}));
// Reaches native-only modules that jsdom cannot parse; the row content under test does not use it.
vi.mock("@/components/workspace-hover-card", () => ({ WorkspaceHoverCard: () => null }));
vi.mock("expo-clipboard", () => ({ setStringAsync: async () => {} }));
vi.mock("@/panels/register-panels", () => ({ ensurePanelsRegistered() {} }));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
  useRouter: () => ({}),
  router: {},
}));

const { SidebarWorkspaceRowContent } = await import("./sidebar-workspace-row-content");
const { SidebarWorkspaceTrailingActions } = await import("./workspace-trailing-actions");

const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: en } } });

function entry(key: string, name: string, diff: number): SidebarWorkspaceEntry {
  return {
    workspaceKey: key,
    serverId: "srv",
    workspaceId: key,
    name,
    currentBranch: null,
    labels: [],
    statusBucket: "done",
    workspaceKind: "worktree",
    diffStat: { additions: diff, deletions: diff },
    statusEnteredAt: null,
    prHint: null,
    projectViewKey: "p",
  } as unknown as SidebarWorkspaceEntry;
}

const noop = () => {};
const client = new QueryClient();

function Row({
  workspace,
  isHovered,
  selected = false,
}: {
  workspace: SidebarWorkspaceEntry;
  isHovered: boolean;
  selected?: boolean;
}) {
  return (
    <View testID={`row-${workspace.workspaceKey}`}>
      <SidebarWorkspaceRowContent
        workspace={workspace}
        backdrop="surfaceSidebarHover"
        isHovered={isHovered}
        isLoading={false}
      >
        <SidebarWorkspaceTrailingActions
          workspace={workspace}
          backdrop="surfaceSidebarHover"
          trailing="diff"
          selected={selected}
          isHovered={isHovered}
          isTouchPlatform={false}
          showShortcut={false}
          onArchive={noop}
          onCopySessionId={noop}
          onRename={noop}
          onTogglePin={noop}
        />
      </SidebarWorkspaceRowContent>
    </View>
  );
}

function mount(rows: { workspace: SidebarWorkspaceEntry; isHovered: boolean }[]) {
  const tree = (next: typeof rows) => (
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        {next.map((row) => (
          <Row key={row.workspace.workspaceKey} {...row} />
        ))}
      </I18nextProvider>
    </QueryClientProvider>
  );
  const result = render(tree(rows));
  return (next: typeof rows) => result.rerender(tree(next));
}

afterEach(() => {
  act(() => useKeyboardShortcutsStore.getState().resetModifiers());
  cleanup();
});

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
const settle = () => wait(MOTION_SWAP_DURATION_MS + 150);
const holdAlt = (down: boolean) =>
  act(() => useKeyboardShortcutsStore.getState().setQuickActionsModifierDown(down));

function titleRow(key: string): HTMLElement {
  const title = screen.getByText(`${key.toUpperCase()} title`);
  return title.parentElement as HTMLElement;
}

/** The title row's trailing leaves in DOM (= visual, left-to-right) order. */
function trailingOrder(key: string): string[] {
  const ids = new Set([
    "sidebar-workspace-trailing-meta",
    "sidebar-workspace-account",
    `sidebar-workspace-actions-${key}`,
  ]);
  const row = titleRow(key);
  return [...row.querySelectorAll("[data-testid]")]
    .map((element) => element.getAttribute("data-testid") ?? "")
    .filter((id) => ids.has(id));
}

const short = entry("a", "A title", 1);
const long = entry("b", "B title", 123456);

describe("sidebar row trailing cluster", () => {
  it("orders diff, then account, then the actions column at the right edge", () => {
    mount([{ workspace: short, isHovered: true }]);
    expect(trailingOrder("a")).toEqual([
      "sidebar-workspace-trailing-meta",
      "sidebar-workspace-account",
      "sidebar-workspace-actions-a",
    ]);
    const actions = screen.getByTestId("sidebar-workspace-actions-a");
    // The kebab lives in the column, so it is the right-most thing on the row.
    expect(actions.contains(screen.getByTestId("sidebar-workspace-kebab-a"))).toBe(true);
    // The column is the last thing in the row's right group, and the group is last in the row.
    expect(actions.parentElement?.lastElementChild).toBe(actions);
    expect(titleRow("a").lastElementChild).toBe(actions.parentElement);
  });

  it("holds the actions column at a fixed width whether or not anything is in it", async () => {
    const rerender = mount([{ workspace: short, isHovered: false }]);
    const column = () => screen.getByTestId("sidebar-workspace-actions-a");
    const idle = column().style.width;
    // Everything that sizes the title; its opacity brightens on hover and is not layout.
    const titleStyle = () =>
      (screen.getByText("A title").getAttribute("style") ?? "").replace(/opacity: [\d.]+;/, "");
    const idleTitle = titleStyle();
    expect(idle).toMatch(/^\d+px$/);
    expect(screen.queryByTestId("sidebar-workspace-kebab-a")).toBeNull();
    rerender([{ workspace: short, isHovered: true }]);
    expect(column().style.width).toBe(idle);
    expect(titleStyle()).not.toBeNull();
    holdAlt(true);
    await settle();
    expect(column().style.width).toBe(idle);
    // The title's own box never changes, so its truncation cannot reflow.
    expect(titleStyle()).toBe(idleTitle);
  });

  it("pins the Alt rail to the row's right edge with identical geometry on every row", async () => {
    mount([
      { workspace: short, isHovered: true },
      { workspace: long, isHovered: true },
    ]);
    holdAlt(true);
    await settle();
    const layers = ["a", "b"].map((key) =>
      screen.getByTestId(`sidebar-workspace-quick-actions-layer-${key}`),
    );
    for (const [index, layer] of layers.entries()) {
      const key = ["a", "b"][index];
      expect(layer.style.position).toBe("absolute");
      expect(layer.style.right).toBe("0px");
      expect(layer.style.top).toBe("0px");
      // Anchored in the fixed column, not after the variable-width metadata.
      expect(layer.parentElement).toBe(screen.getByTestId(`sidebar-workspace-actions-${key}`));
    }
    expect(layers[0].style.width).toBe(layers[1].style.width);
    // Over a scrim that fades the metadata it covers.
    expect(layers[0].querySelector('[data-testid="sidebar-workspace-trailing-scrim"]')).not.toBe(
      null,
    );
  });

  it("swaps kebab and rail in place on Alt and back on release", async () => {
    mount([{ workspace: short, isHovered: true }]);
    await settle();
    holdAlt(true);
    await settle();
    expect(screen.getByTestId("sidebar-workspace-quick-actions-layer-a")).toBeTruthy();
    expect(screen.queryByTestId("sidebar-workspace-kebab-a")).toBeNull();
    holdAlt(false);
    await settle();
    expect(screen.queryByTestId("sidebar-workspace-quick-actions-layer-a")).toBeNull();
    expect(screen.getByTestId("sidebar-workspace-kebab-a")).toBeTruthy();
  });
});
