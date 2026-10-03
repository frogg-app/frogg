/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrPaneCheck } from "./data";

/** Every style factory reads theme.<group>.<token>; nothing here asserts on the values. */
const { themeStub } = vi.hoisted(() => ({
  themeStub: new Proxy({}, { get: () => new Proxy({}, { get: () => 4 }) }),
}));

vi.mock("react-native", () => ({
  View: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement("div", toDomProps(props), children),
  Text: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement("span", toDomProps(props), children),
  Pressable: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement(
      "button",
      { type: "button", ...toDomProps(props) },
      resolveChildren(children, props),
    ),
  // A nested scroll area inside the pane's own scroll view is the regression this
  // file guards against, so it renders as something the assertions can find.
  ScrollView: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement("div", { ...toDomProps(props), "data-nested-scroll": "true" }, children),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: (factory: (theme: unknown) => unknown) => factory(themeStub) },
  withUnistyles: (Component: React.ComponentType<Record<string, unknown>>) =>
    function Themed({ uniProps: _uniProps, ...props }: Record<string, unknown>) {
      return React.createElement(Component, props);
    },
}));

vi.mock("lucide-react-native", () => ({
  ChevronDown: () => React.createElement("span"),
  ChevronRight: () => React.createElement("span"),
  MessageSquarePlus: () => React.createElement("span"),
}));

vi.mock("@/styles/theme", () => ({ ICON_SIZE: { xs: 12, sm: 14, md: 16, lg: 20 } }));
vi.mock("@/components/ui/control-geometry", () => ({ CONTROL_HEIGHTS: { compact: 28 } }));
vi.mock("@/components/ui/button", () => ({ Button: () => React.createElement("span") }));
vi.mock("@/git/check-presentation.view", () => ({
  CheckPresentationIcon: () => React.createElement("span"),
  getCheckPresentationTone: () => "muted",
}));
vi.mock("./checks-ring", () => ({ ChecksRing: () => React.createElement("span") }));
vi.mock("@/utils/open-external-url", () => ({ openExternalUrl: vi.fn() }));

function toDomProps(props: Record<string, unknown>): Record<string, unknown> {
  const { testID, style: _style, children: _children, ...rest } = props;
  return testID === undefined ? rest : { ...rest, "data-testid": testID };
}

function resolveChildren(children: unknown, props: Record<string, unknown>): React.ReactNode {
  return typeof children === "function"
    ? (children as (state: Record<string, unknown>) => React.ReactNode)({
        hovered: false,
        ...props,
      })
    : (children as React.ReactNode);
}

const { ChecksSection } = await import("./checks-section");

function buildChecks(count: number): PrPaneCheck[] {
  return Array.from(
    { length: count },
    (_, index): PrPaneCheck => ({
      provider: "github",
      name: `check-${index}`,
      status: "success",
      url: `https://example.test/check-${index}`,
    }),
  );
}

let container: HTMLDivElement;
let root: Root;

function renderChecks(checks: PrPaneCheck[], open: boolean): void {
  act(() => {
    root.render(
      React.createElement(ChecksSection, {
        checks,
        open,
        onToggle: () => {},
        attachEnabled: false,
        loadingCheckKeys: new Set<string>(),
        onAddLogsToChat: () => {},
      }),
    );
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ChecksSection", () => {
  it("renders every check row without a nested scroll area", () => {
    renderChecks(buildChecks(30), true);

    expect(container.querySelectorAll('[data-testid="pr-pane-check-row"]')).toHaveLength(30);
    expect(container.querySelector("[data-nested-scroll]")).toBeNull();
  });

  it("renders no rows at all when the section is collapsed", () => {
    renderChecks(buildChecks(30), false);

    expect(container.querySelectorAll('[data-testid="pr-pane-check-row"]')).toHaveLength(0);
  });
});
