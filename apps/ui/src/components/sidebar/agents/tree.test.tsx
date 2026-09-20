import { ToastApiProvider } from "@/contexts/toast-api-context";
/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type { PropsWithChildren, ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { createInstance } from "i18next";
import { ProviderSubagentHistoryStatus } from "@/subagents/provider-history";
import { SidebarAgentBranch, SidebarWorkspaceAgents } from "./tree";
import { WorkspaceAgentTreeState, WorkspaceAgentDisclosure } from "./workspace-tree";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Pressable, Text } from "react-native";
import type { SidebarAgentNode } from "./model";
import { en } from "@/i18n/resources/en";

vi.hoisted(() => {
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: () => ({ startTime: 0, cancel() {} }),
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: () => {},
      addListener: () => {},
      dispatchEvent: () => false,
      matches: false,
      media: "",
      onchange: null,
      removeEventListener: () => {},
      removeListener: () => {},
    }),
  });
});

// This test mounts sidebar rows; full pane registration pulls native Markdown into jsdom.
vi.mock("@/panels/register-panels", () => ({ ensurePanelsRegistered() {} }));
vi.mock("@/components/sidebar/workspace-account", async () => {
  const { createElement } = await import("react");
  return {
    SidebarAccountIndicator: () =>
      createElement("span", { "data-testid": "sidebar-workspace-account" }, "work"),
  };
});
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}));

const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: en } } });
const child: SidebarAgentNode = {
  key: "host\0provider\0parent\0child",
  serverId: "host",
  workspaceId: "workspace",
  target: {
    kind: "provider_subagent",
    parentAgentId: "parent",
    subagentId: "child",
  },
  row: {
    kind: "provider",
    id: "child",
    parentAgentId: "parent",
    provider: "codex",
    title: "Worker",
    description: "Inspect the runtime",
    subtitle: "Codex worker",
    status: "running",
    requiresAttention: false,
    createdAt: new Date(),
  },
  children: [],
};
const parent: SidebarAgentNode = {
  ...child,
  key: "host\0agent\0parent",
  target: { kind: "agent", agentId: "parent" },
  row: {
    kind: "frogg",
    id: "parent",
    provider: "codex",
    title: "Build the sidebar",
    description: null,
    subtitle: null,
    status: "running",
    requiresAttention: false,
    createdAt: new Date(),
  },
  children: [child],
};
const leafParent = { ...parent, children: [] };
const toastApi = { show: vi.fn(), copied: vi.fn(), error: vi.fn() };

// Every agent row carries a context menu now, so every row needs the toast and query context
// its actions are built from — not just the tests that open a menu.
function Providers({ children }: PropsWithChildren) {
  return (
    <ToastApiProvider api={toastApi}>
      <QueryClientProvider client={new QueryClient()}>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
      </QueryClientProvider>
    </ToastApiProvider>
  );
}

function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: Providers });
}
afterEach(cleanup);

describe("sidebar subagent interaction", () => {
  it("keeps a meaningful name ahead of a long description", () => {
    const longDescription =
      "Investigate multiple accounts implementation details and report the affected flows";
    const namedChild: SidebarAgentNode = {
      ...child,
      row: {
        ...child.row,
        title: "Fix pr27",
        description: longDescription,
        // No provider subtitle, so the description is the whole second part of the row rather
        // than being joined with it ("… · Codex worker").
        subtitle: null,
      } as SidebarAgentNode["row"],
    };
    // eslint-disable-next-line eslint-plugin-react-perf/jsx-no-new-object-as-prop
    const namedParent = { ...parent, children: [namedChild] };
    render(
      <I18nextProvider i18n={i18n}>
        <SidebarAgentBranch
          node={namedParent}
          discovery={new Map()}
          connectionStatus="online"
          selectedTarget={null}
          onOpen={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.getByRole("button", { name: "Fix pr27" })).toBeTruthy();
    // Single-line and ellipsized (react-native-web renders `numberOfLines={1}` as nowrap +
    // text-overflow classes, not as an attribute), and it takes only the width the name leaves.
    const description = screen.getByText(longDescription);
    expect(description.className).toContain("r-textOverflow");
    expect(description.className).toContain("r-whiteSpace");
    expect(description.style.flexBasis).toBe("0px");
    expect(description.style.minWidth).toBe("0px");
    // The name shrinks only after the description has given up its width.
    const name = screen.getByText("Fix pr27");
    expect(name.style.flexShrink).toBe("1");
    expect(name.style.flexBasis).not.toBe("0px");
  });

  it("puts the account right-most on the row, with other metadata to its left", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SidebarAgentBranch
          node={parent}
          discovery={new Map()}
          connectionStatus="online"
          selectedTarget={null}
          onOpen={vi.fn()}
        />
      </I18nextProvider>,
    );
    const row = screen.getByTestId("sidebar-agent-frogg-parent");
    const count = screen.getByTestId("sidebar-agent-child-count-parent");
    const account = row.querySelector('[data-testid="sidebar-workspace-account"]');
    expect(account).not.toBeNull();
    expect(row.contains(count)).toBe(true);
    // DOCUMENT_POSITION_FOLLOWING: the account comes after (to the right of) the count.
    expect(count.compareDocumentPosition(account!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.lastElementChild).toBe(account);
  });

  it("gives an agent row the same kebab and the same reserved columns as a session row", () => {
    render(
      <ToastApiProvider api={toastApi}>
        <QueryClientProvider client={new QueryClient()}>
          <I18nextProvider i18n={i18n}>
            <SidebarAgentBranch
              node={leafParent}
              discovery={new Map()}
              connectionStatus="online"
              selectedTarget={null}
              onOpen={vi.fn()}
            />
          </I18nextProvider>
        </QueryClientProvider>
      </ToastApiProvider>,
    );
    const actions = screen.getByTestId("sidebar-agent-actions-parent");
    // The actions column is always held open so the kebab does not shift on hover; the
    // disclosure column is not reserved, so a row with nothing to disclose is label + actions.
    const row = actions.parentElement!;
    expect(row.children).toHaveLength(2);
    expect(screen.queryByTestId("sidebar-agent-kebab-parent")).toBeNull();
    fireEvent.pointerEnter(row);
    expect(screen.getByTestId("sidebar-agent-kebab-parent")).toBeTruthy();
    fireEvent.pointerLeave(row);
    expect(screen.queryByTestId("sidebar-agent-kebab-parent")).toBeNull();
  });

  it("opens the agent's own menu on right click rather than the platform edit menu", () => {
    render(
      <SidebarAgentBranch
        node={leafParent}
        discovery={new Map()}
        connectionStatus="online"
        selectedTarget={null}
        onOpen={vi.fn()}
      />,
    );
    const row = screen.getByTestId("sidebar-agent-frogg-parent");
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    expect(screen.getByTestId("sidebar-agent-context-menu-copy-session-id-parent")).toBeTruthy();
    expect(screen.getByTestId("sidebar-agent-context-menu-archive-parent")).toBeTruthy();
  });

  it("opens the child's own runtime and preserves the tree when collapsing and reopening", () => {
    const onOpen = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <SidebarAgentBranch
          node={parent}
          discovery={new Map()}
          connectionStatus="online"
          selectedTarget={child.target}
          onOpen={onOpen}
        />
      </I18nextProvider>,
    );
    const childButton = screen.getByRole("button", { name: "Worker" });
    expect(childButton.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(childButton);
    expect(onOpen).toHaveBeenCalledWith(child);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Collapse subagents for Build the sidebar",
      }),
    );
    expect(screen.queryByRole("button", { name: "Worker" })).toBeNull();
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Expand subagents for Build the sidebar",
      }),
    );
    expect(screen.getAllByRole("button", { name: "Worker" })).toHaveLength(1);
  });

  it("reveals a newly spawned child unless the parent was explicitly collapsed", () => {
    const onOpen = vi.fn();
    const renderBranch = (node: SidebarAgentNode) => (
      <I18nextProvider i18n={i18n}>
        <SidebarAgentBranch
          node={node}
          discovery={new Map()}
          connectionStatus="online"
          selectedTarget={null}
          onOpen={onOpen}
        />
      </I18nextProvider>
    );
    const view = render(renderBranch({ ...parent, children: [] }));
    expect(screen.queryByRole("button", { name: "Worker" })).toBeNull();
    view.rerender(renderBranch(parent));
    expect(screen.getAllByRole("button", { name: "Worker" })).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Collapse subagents for Build the sidebar",
      }),
    );
    view.rerender(renderBranch({ ...parent, children: [] }));
    view.rerender(renderBranch(parent));
    expect(screen.queryByRole("button", { name: "Worker" })).toBeNull();
  });

  it("exposes discovery failure and retries without opening another session", () => {
    const retry = vi.fn();
    const onOpen = vi.fn();
    const discovery = new Map([
      [parent.key, { pending: false, failed: true, retry, discover: vi.fn() }],
    ]);
    render(
      <I18nextProvider i18n={i18n}>
        <SidebarAgentBranch
          node={parent}
          discovery={discovery}
          connectionStatus="online"
          selectedTarget={null}
          onOpen={onOpen}
        />
      </I18nextProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Could not load subagents · Retry" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("marks disconnected activity as saved and keeps the child accessible", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SidebarAgentBranch
          node={parent}
          discovery={new Map()}
          connectionStatus="offline"
          selectedTarget={null}
          onOpen={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.getAllByText("Offline · showing saved activity")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Worker" })).toHaveLength(1);
  });
});

describe("workspace agent disclosure", () => {
  function workspaceTree(roots: SidebarAgentNode[], onWorkspacePress = vi.fn()) {
    const queryClient = new QueryClient();
    return (
      <ToastApiProvider api={toastApi}>
        <QueryClientProvider client={queryClient}>
          <I18nextProvider i18n={i18n}>
            <WorkspaceAgentTreeState roots={roots}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Workspace"
                onPress={onWorkspacePress}
              >
                <WorkspaceAgentDisclosure label="Workspace" />
                <Text>Workspace</Text>
              </Pressable>
              <SidebarWorkspaceAgents serverId="host" workspaceId="workspace" />
            </WorkspaceAgentTreeState>
          </I18nextProvider>
        </QueryClientProvider>
      </ToastApiProvider>
    );
  }

  it("shows only the selectable workspace for a single agent without children", () => {
    const open = vi.fn();
    render(workspaceTree([{ ...parent, children: [] }], open));
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByTestId("sidebar-agents-workspace")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    expect(open).toHaveBeenCalledOnce();
  });

  it("puts live children directly below a singleton workspace and removes its disclosure when they finish", () => {
    const view = render(workspaceTree([parent]));
    expect(screen.queryByTestId("sidebar-agent-frogg-parent")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Worker" })).toHaveLength(1);
    expect(
      screen
        .getByRole("button", { name: "Collapse agents in Workspace" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    view.rerender(workspaceTree([{ ...parent, children: [] }]));
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByTestId("sidebar-agents-workspace")).toBeNull();
  });

  it("collapses multiple agents from the workspace without selecting it", () => {
    const open = vi.fn();
    const second = {
      ...parent,
      key: "second",
      row: { ...parent.row, id: "second", title: "Second agent" },
      children: [],
    };
    render(workspaceTree([parent, second], open));
    expect(screen.getAllByRole("button", { name: "Second agent" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Collapse agents in Workspace" }));
    expect(screen.queryByRole("button", { name: "Second agent" })).toBeNull();
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Expand agents in Workspace" }));
    expect(screen.getAllByRole("button", { name: "Second agent" })).toHaveLength(1);
  });

  it.each(["pending", "failed"])(
    "does not invent a child disclosure when discovery is %s",
    (status) => {
      const node = leafParent;
      const discovery = new Map([
        [
          parent.key,
          {
            pending: status === "pending",
            failed: status === "failed",
            retry: vi.fn(),
            discover: vi.fn(),
          },
        ],
      ]);
      render(
        <I18nextProvider i18n={i18n}>
          <SidebarAgentBranch
            node={node}
            discovery={discovery}
            connectionStatus="online"
            selectedTarget={null}
            onOpen={vi.fn()}
          />
        </I18nextProvider>,
      );
      expect(screen.getAllByRole("button")).toHaveLength(1);
    },
  );
});

const pendingHistory = {
  connected: true,
  pending: true,
  failed: false,
  retry: vi.fn(),
};
const failedHistory = { ...pendingHistory, pending: false, failed: true };
const loadedHistory = { ...pendingHistory, pending: false };

describe("provider transcript attachment feedback", () => {
  it("shows pending, failure/retry, and loaded activity without an empty-success state", () => {
    const retry = pendingHistory.retry;
    const view = render(
      <I18nextProvider i18n={i18n}>
        <ProviderSubagentHistoryStatus history={pendingHistory} hasTimeline={false} />
      </I18nextProvider>,
    );
    expect(screen.getAllByText("Loading...")).toHaveLength(1);
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <ProviderSubagentHistoryStatus history={failedHistory} hasTimeline={false} />
      </I18nextProvider>,
    );
    expect(screen.queryByText("Loading...")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Could not load activity · Retry" }));
    expect(retry).toHaveBeenCalledOnce();
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <ProviderSubagentHistoryStatus history={loadedHistory} hasTimeline />
      </I18nextProvider>,
    );
    expect(view.container.textContent).toBe("");
  });
});
