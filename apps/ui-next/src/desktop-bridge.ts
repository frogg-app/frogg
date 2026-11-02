/** What the desktop shell's preload (apps/ui-next/desktop/preload.cjs) exposes; absent elsewhere. */
export interface DesktopUpdateState {
  /** `install`: downloads and restarts in place. `download`: offers the installer (Mac, .deb). */
  mode: "install" | "download" | "disabled";
  status:
    | "disabled"
    | "idle"
    | "checking"
    | "up-to-date"
    | "available"
    | "downloading"
    | "ready"
    | "error";
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string;
  downloadUrl: string | null;
  progress: { percent: number; transferred: number; total: number } | null;
  error: string | null;
  checkedAt: number | null;
}

export interface DesktopBridge {
  updates: {
    get(): Promise<DesktopUpdateState>;
    check(): Promise<DesktopUpdateState>;
    download(): Promise<void>;
    install(): Promise<void>;
    onState(listener: (state: DesktopUpdateState) => void): () => void;
  };
  /** Pops a session out into its own window; absent in shells older than 1.6.14. */
  openSessionWindow?(sessionId: string, hostId?: string | null): Promise<boolean>;
  onOpenUrl(listener: (url: string) => void): () => void;
  /** Saves the theme's shell colours for the next launch and repaints open windows. */
  setWindowTheme?(colors: {
    bg: string;
    faint: string;
    accent: string;
    symbols: string;
  }): Promise<void>;
}

export const desktopBridge = (): DesktopBridge | null =>
  (globalThis as { froggNextDesktop?: DesktopBridge }).froggNextDesktop ?? null;
