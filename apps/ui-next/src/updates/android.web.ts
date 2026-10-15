import { create } from "zustand";
import type { ApkUpdaterState } from "./android";

// The web and desktop builds have no APK to update; the desktop shell has its own updater.
export type { ApkUpdaterState };
const REPOSITORY = process.env.EXPO_PUBLIC_FROGG_RELEASE_REPO?.trim() || "frogg-app/frogg";
export const RELEASES_PAGE = `https://github.com/${REPOSITORY}/releases`;
export const apkUpdatesSupported = false;
export const useApkUpdater = create<ApkUpdaterState>(() => ({
  status: "idle",
  update: null,
  progress: null,
  error: null,
  notice: null,
  checkedAt: null,
}));
export async function checkApkUpdate(): Promise<void> {}
export async function installApkUpdate(): Promise<void> {}
