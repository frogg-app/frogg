import { STATUS_BUCKET_LABELS } from "@/hooks/sidebar-status-view-model";
import type { InsetView } from "./inset-data";

// preview copy: English-only labels for the inset direction's preview surfaces. Anything the
// shipping app already translates is read from i18n at the call site instead.
export const VIEW_LABELS: Record<InsetView, string> = {
  all: "All sessions", // preview copy
  active: "Active", // preview copy
  inbox: "Inbox", // preview copy
  running: STATUS_BUCKET_LABELS.running,
};

export const INSET_COPY = {
  properties: "Properties", // preview copy
  status: "Status", // preview copy
  model: "Model", // preview copy
  provider: "Provider", // preview copy
  branch: "Branch", // preview copy
  changes: "Changes", // preview copy
  created: "Created", // preview copy
  lastActive: "Last active", // preview copy
  project: "Project", // preview copy
  directory: "Directory", // preview copy
  agents: "Agents", // preview copy
  noChanges: "No changes", // preview copy
  none: "None", // preview copy
  emptyTitle: "No sessions here", // preview copy
  emptyBody: "Start a session or pick another view.", // preview copy
} as const;
