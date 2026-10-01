import {
  Archive,
  ChevronDown,
  FolderClosed,
  FolderPlus,
  History,
  Inbox,
  PanelLeft,
  Pencil,
  Plug,
  Plus,
  Search,
  Smartphone,
  Star,
  StarOff,
  X,
} from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";

// Theme-coloured icons for the Paper layouts. `withUnistyles` resolves real colours on web,
// where the stylesheet theme only carries CSS variable references.
export const PaperIcon = {
  archive: withUnistyles(Archive),
  chevronDown: withUnistyles(ChevronDown),
  folder: withUnistyles(FolderClosed),
  folderPlus: withUnistyles(FolderPlus),
  history: withUnistyles(History),
  inbox: withUnistyles(Inbox),
  panelLeft: withUnistyles(PanelLeft),
  pencil: withUnistyles(Pencil),
  plug: withUnistyles(Plug),
  plus: withUnistyles(Plus),
  search: withUnistyles(Search),
  phone: withUnistyles(Smartphone),
  star: withUnistyles(Star),
  starOff: withUnistyles(StarOff),
  close: withUnistyles(X),
} as const;

export type PaperIconName = keyof typeof PaperIcon;

export const paperForeground = (theme: Theme) => ({ color: theme.colors.foreground });
export const paperMuted = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
export const paperAccent = (theme: Theme) => ({ color: theme.colors.accent });
export const paperOnAccent = (theme: Theme) => ({ color: theme.colors.accentForeground });
export const paperOnPrimary = (theme: Theme) => ({ color: theme.colors.primaryForeground });
