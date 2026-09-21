import { useEffect } from "react";
import { BackHandler } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { isNative } from "@/constants/platform";
import { useStableEvent } from "@/hooks/use-stable-event";
import { usePanelStore } from "@/stores/panel-store";
import {
  armMobileSidebarRestore,
  clearMobileSidebarOrigin,
  registerMobileBackOverlayHandler,
  rememberMobileSidebarOrigin,
  resolveMobileBackAction,
  runMobileBackOverlayHandlers,
  takeMobileSidebarRestore,
} from "@/navigation/mobile-back";

/**
 * Lets an overlay that is not a native `Modal` — a bottom sheet, an inline
 * viewer — absorb the hardware Back press instead of letting it fall through to
 * the columns (or, worse, out of the app).
 */
export function useMobileBackOverlay(active: boolean, onBack: () => boolean): void {
  const handler = useStableEvent(onBack);

  useEffect(() => {
    if (!isNative || !active) {
      return;
    }
    return registerMobileBackOverlayHandler(handler);
  }, [active, handler]);
}

interface MobileBackNavigationInput {
  isWorkspaceRoute: boolean;
  pathname: string;
}

/**
 * Closes the sidebar for a navigation it is about to start, remembering that the
 * route being left is where Back should bring the sidebar back to.
 */
export function useCloseMobileSidebarForNavigation(): () => void {
  const pathname = usePathname();
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);

  return useStableEvent(() => {
    rememberMobileSidebarOrigin(pathname);
    showMobileAgent();
  });
}

/**
 * Installs the app-wide hardware Back handler. Registered once, at the root, so
 * that the whole right-to-left walk (overlay, right sidebar, conversation,
 * session list) is decided in one place rather than by whichever screen happens
 * to have added a listener last.
 */
export function useMobileBackNavigation({
  isWorkspaceRoute,
  pathname,
}: MobileBackNavigationInput): void {
  const router = useRouter();
  const showMobileAgentList = usePanelStore((state) => state.showMobileAgentList);

  useEffect(() => {
    if (!isNative) {
      return;
    }
    if (takeMobileSidebarRestore(pathname)) {
      showMobileAgentList();
    }
  }, [pathname, showMobileAgentList]);

  useEffect(() => clearMobileSidebarOrigin, []);

  const handleBack = useStableEvent(() => {
    const action = resolveMobileBackAction({
      activePanel: usePanelStore.getState().mobilePanel.target,
      canPopRoute: router.canGoBack(),
      consumedByOverlay: runMobileBackOverlayHandlers(),
      isWorkspaceRoute,
    });

    switch (action.kind) {
      case "consumed":
        return true;
      case "show-agent":
        usePanelStore.getState().showMobileAgent();
        return true;
      case "show-agent-list":
        usePanelStore.getState().showMobileAgentList();
        return true;
      case "pop-route":
        armMobileSidebarRestore();
        router.back();
        return true;
      case "exit":
        return false;
    }
  });

  useEffect(() => {
    if (!isNative) {
      return;
    }
    const subscription = BackHandler.addEventListener("hardwareBackPress", handleBack);
    return () => subscription.remove();
  }, [handleBack]);
}
