import { useEffect, type ComponentType } from "react";
import { CompanionPanel } from "../../components/CompanionPanel";
import { FilesPanel } from "../../components/Files";
import { HostsPanel } from "../../components/HostsPanel";
import { HostDetail } from "../../components/hosts/HostDetail";
import { PairDevice } from "../../components/hosts/PairDevice";
import { openSheet, useHostView } from "../../components/hosts/state";
import { useHostLink, useHosts, type HostLink } from "../../daemon/hosts";
import { useDaemon } from "../../daemon/store";
import { PluginsPanel } from "../../components/PluginsPanel";
import { PrsPanel } from "../../components/PrsPanel";
import { ScmPanel } from "../../components/ScmPanel";
import { SearchPanel } from "../../components/SearchPanel";
import { TasksPanel } from "../../components/TasksPanel";
import { TerminalsPanel } from "../../components/TerminalsPanel";
import { StreamList, useStreams } from "../../components/tools/Streams";
import { UsagePanel } from "../../components/UsagePanel";
import { useUi } from "../../ui-store";
import { ID } from "../fixtures";
import { Act, Column, Controls, Row, type Entry, type Variant } from "../kit";

function panel(P: ComponentType): ComponentType {
  return function Panel() {
    return (
      <Row>
        <Column width={340}>
          <P />
        </Column>
      </Row>
    );
  };
}

const selectPreview = () => useUi.setState({ selected: ID.preview });
/** Live: loads the simulated graph through the fixture host (lab/sim/streams.ts). */
function StreamsGraph() {
  const { graph, error } = useStreams("/home/dev/frogg", true);
  return (
    <Row>
      <Column width={380}>
        <StreamList graph={graph} error={error} />
      </Column>
    </Row>
  );
}
const StreamsEmpty = () => <StreamList graph={null} error={null} />;
const StreamsError = () => <StreamList graph={null} error="checkoutStreamsGetGraph timed out" />;

const PANELS: Array<[string, string, ComponentType]> = [
  ["search", "Search", SearchPanel],
  ["files", "Files", FilesPanel],
  ["scm", "Source control", ScmPanel],
  ["prs", "PRs & CI", PrsPanel],
  ["terminals", "Terminals", TerminalsPanel],
  ["tasks", "Tasks", TasksPanel],
  ["hosts", "Hosts", HostsPanel],
  ["plugins", "Plugins", PluginsPanel],
  ["companion", "Companion", CompanionPanel],
];
const panelVariants: Variant[] = PANELS.map(([id, label, P]) => ({
  id,
  label,
  C: panel(P),
  h: 520,
  bleed: true,
}));

/** The Hosts tool's main pane, with its pairing dialog mounted; `view` picks what it shows. */
function hostPane(view: { viewId: string | null; pair?: boolean }): ComponentType {
  return function HostPane() {
    useEffect(() => {
      useHostView.setState({ viewId: view.viewId, pushed: false, sheet: null });
      if (view.pair) openSheet({ kind: "pair-device" });
    }, []);
    return (
      <>
        <HostDetail />
        <PairDevice />
      </>
    );
  };
}
/** Offline states of the active host's pane: each sets the shell's link state for the entry. */
const linkIdle = (): HostLink => ({
  hostId: useHosts.getState().activeId,
  attempt: 0,
  reason: null,
  error: null,
  droppedAt: null,
});
function showLink(conn: "offline" | "connecting", link: Partial<HostLink>): void {
  useDaemon.setState({ conn });
  useHostLink.setState({ ...linkIdle(), ...link });
}
const refused = (reason: string, credentialRejected = false) =>
  showLink("offline", {
    droppedAt: new Date().toISOString(),
    reason,
    error: { code: "pairing_required", credentialRejected, reason },
  });
const OFFLINE = {
  first: () => showLink("connecting", {}),
  reconnecting: () =>
    showLink("connecting", {
      attempt: 3,
      reason: "Transport closed (code 1006)",
      droppedAt: new Date().toISOString(),
    }),
  waiting: () =>
    showLink("offline", {
      attempt: 3,
      reason: "Transport closed (code 1006)",
      droppedAt: new Date().toISOString(),
    }),
  unclaimed: () => refused("Pairing required"),
  unregistered: () => refused("Password required"),
  rejected: () => refused("Device access revoked", true),
};

/** The active host's offline pane; the online fixture host comes back on unmount. */
function OfflinePane() {
  useEffect(() => {
    useHostView.setState({ viewId: null, pushed: false, sheet: null });
    OFFLINE.unclaimed();
    return () => {
      useDaemon.setState({ conn: "online" });
      useHostLink.setState(linkIdle());
    };
  }, []);
  return (
    <>
      <Controls>
        <Act label="first connect" run={OFFLINE.first} />
        <Act label="reconnecting" run={OFFLINE.reconnecting} />
        <Act label="waiting to retry" run={OFFLINE.waiting} />
        <Act label="refused: unclaimed" run={OFFLINE.unclaimed} />
        <Act label="refused: not registered" run={OFFLINE.unregistered} />
        <Act label="refused: credential rejected" run={OFFLINE.rejected} />
      </Controls>
      <HostDetail />
    </>
  );
}
const ActiveHostPane = hostPane({ viewId: null });
const SavedHostPane = hostPane({ viewId: "h_win" });
const PairingPane = hostPane({ viewId: null, pair: true });

export const tools: Entry[] = [
  {
    id: "host-detail",
    name: "HostDetail",
    category: "Rail tools & widgets",
    path: "components/hosts/HostDetail.tsx (+ HereNow, HostUpdate)",
    purpose:
      "Hosts main pane for the active host: load, who is here now (rename, roles, this app as a registered device), connections and the daemon card with channel/version update.",
    usedBy: 1,
    polish: "Here now and update status poll; the rename prompt fades (Modal)",
    variants: [{ id: "active", label: "Active host", C: ActiveHostPane, h: 860, bleed: true }],
  },
  {
    id: "host-offline",
    name: "HostDetail (offline)",
    category: "Rail tools & widgets",
    path: "components/hosts/HostDetail.tsx (+ hosts/access.ts)",
    purpose:
      "The active host when it is not connected: first connect, reconnecting or waiting to retry, and the three ways a daemon refuses an app that is not a registered device (unclaimed, no credential, credential rejected). The TLS-mismatch hint needs a live daemon on the other scheme.",
    usedBy: 1,
    polish:
      "the flag breathes (1.6s ∞) while Frogg keeps retrying; the retry track's light band travels (stateMotion.beam) only while a reconnect is in flight",
    variants: [{ id: "states", label: "Offline states", C: OfflinePane, h: 360, bleed: true }],
  },
  {
    id: "host-saved",
    name: "HostDetail (background host)",
    category: "Rail tools & widgets",
    path: "components/hosts/HostDetail.tsx",
    purpose: "A saved host that is not the active one: its pooled link state and session count.",
    usedBy: 1,
    polish: "none",
    variants: [{ id: "saved", label: "Background host", C: SavedHostPane, h: 360, bleed: true }],
  },
  {
    id: "pair-device",
    name: "PairDevice",
    category: "Rail tools & widgets",
    path: "components/hosts/PairDevice.tsx",
    purpose: "Owner side of pairing: role, QR, link and code; failures sit in the footer.",
    usedBy: 1,
    polish: "Dialog fade + rise (overlayMotion)",
    variants: [{ id: "pair", label: "Pair a device", C: PairingPane, h: 640, bleed: true }],
  },
  {
    id: "usage-panel",
    name: "UsagePanel",
    category: "Rail tools & widgets",
    path: "components/UsagePanel.tsx",
    purpose:
      "Provider usage grouped by provider; a provider with two or more sign-ins shows a block per account (multi-account fixture).",
    usedBy: 2,
    polish:
      "none; provider cards collapse and expand instantly; refresh icon turns cyan while loading",
    variants: [
      { id: "multi", label: "Multi-account fixture", C: panel(UsagePanel), h: 760, bleed: true },
    ],
  },
  {
    id: "panels",
    name: "Tool panels (fixture host)",
    category: "Rail tools & widgets",
    path: "components/*Panel.tsx",
    purpose:
      "Each rail tool's side panel against the fixture host. The fixture host plus the simulated host (lab/sim/) answer every RPC the panels make.",
    polish: "panel swap in the shell: motion.enter keyed by tool (200ms)",
    setup: selectPreview,
    variants: panelVariants,
  },
  {
    id: "streams",
    name: "StreamList",
    category: "Rail tools & widgets",
    path: "components/tools/Streams.tsx",
    purpose: "Release streams graph for a checkout (source control panel).",
    usedBy: 1,
    polish:
      "rows rise in (motion.enter 220ms on ease, 40ms stagger); hover wash 120ms; chevron rotates 90° (180ms ease); selected row cyan wash + Brackets; waiting bar width glides 420ms on ease with its count lerping via Num on the same duration; expand fades in (180ms) and change rows rise on a 22ms stagger; loading is SkeletonRows (shimmer sweep 1.6s linear)",
    variants: [
      { id: "graph", label: "Graph", C: StreamsGraph, h: 520 },
      { id: "empty", label: "No graph yet", C: StreamsEmpty },
      { id: "error", label: "Failed to load", C: StreamsError },
    ],
  },
];
