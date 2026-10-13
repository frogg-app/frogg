import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { usePrefs } from "../../prefs";
import type { Toast, ToastKind } from "./store";

/** One toast as the Inbox remembers it: the copy, not the live action. */
export interface ToastRecord {
  id: string;
  title: string;
  detail?: string;
  kind: ToastKind;
  /** Epoch ms it was raised. */
  at: number;
}

interface HistoryState {
  records: ToastRecord[];
}

const KEY = "frogg.next.toasts";
/** Newest kept; older ones drop off whatever the retention setting says. */
const CAP = 200;
const DAY = 86_400_000;

export const useToastHistory = create<HistoryState>(() => ({ records: [] }));

/** Drops records older than Settings → Notifications → "Keep notifications for". */
function prune(records: ToastRecord[]): ToastRecord[] {
  const keep = usePrefs.getState().keepDays;
  const days = Number.parseInt(keep, 10);
  const cut = Number.isFinite(days) ? Date.now() - days * DAY : 0;
  return records.filter((r) => r.at >= cut).slice(0, CAP);
}

let loaded = false;
const ready: Promise<void> = AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (!raw) return undefined;
    const saved = JSON.parse(raw) as ToastRecord[];
    if (!Array.isArray(saved)) return undefined;
    // Anything recorded before storage answered stays on top.
    useToastHistory.setState((st) => ({ records: prune([...st.records, ...saved]) }));
    return undefined;
  })
  .catch(() => {})
  .finally(() => {
    loaded = true;
  });

function save(records: ToastRecord[]) {
  if (!loaded) {
    void ready.then(() => save(useToastHistory.getState().records));
    return;
  }
  void AsyncStorage.setItem(KEY, JSON.stringify(records)).catch(() => {});
}

/** Called for every toast raised; newest first. */
export function recordToast(t: Toast): void {
  const rec: ToastRecord = { id: `${t.at}-${t.id}`, title: t.title, kind: t.kind, at: t.at };
  if (t.detail) rec.detail = t.detail;
  const records = prune([rec, ...useToastHistory.getState().records]);
  useToastHistory.setState({ records });
  save(records);
}

export function clearToastHistory(): void {
  useToastHistory.setState({ records: [] });
  save([]);
}
