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
  onOpenUrl(listener: (url: string) => void): () => void;
}

export const desktopBridge = (): DesktopBridge | null =>
  (globalThis as { froggNextDesktop?: DesktopBridge }).froggNextDesktop ?? null;
