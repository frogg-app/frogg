import { create } from "zustand";

/** Which host the Hosts view shows, and which hosts dialog is open. */
export type HostSheet =
  | null
  | { kind: "add" }
  | { kind: "pair-device" }
  | { kind: "confirm" }
  | { kind: "remove"; hostId: string };

interface HostView {
  /** The host shown in the detail pane; null means the active one. */
  viewId: string | null;
  /** Phone: the detail view is pushed over the list. */
  pushed: boolean;
  sheet: HostSheet;
}

export const useHostView = create<HostView>(() => ({ viewId: null, pushed: false, sheet: null }));

export const viewHost = (viewId: string | null, pushed = true) =>
  useHostView.setState({ viewId, pushed });
export const openSheet = (sheet: HostSheet) => useHostView.setState({ sheet });
export const closeSheet = () => useHostView.setState({ sheet: null });
