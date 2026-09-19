import { useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { BrandLogo } from "@/components/icons/brand-logo";
import { SidebarNavRows } from "@/components/sidebar/sidebar-nav-rows";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";

const LOGO_SIZE = 40;

interface SidebarBrandHeaderProps {
  onBeforeNavigate?: () => void;
}

/**
 * Top sidebar row: the brand mark, then the user's nav items as icon-only
 * buttons. The mark sits outside the pressables so the row stays a window
 * drag surface on desktop.
 */
export function SidebarBrandHeader({ onBeforeNavigate }: SidebarBrandHeaderProps) {
  const { items } = useSidebarNavItems();
  const hasNav = useMemo(() => items.some((item) => item.visible), [items]);

  return (
    <View style={styles.root}>
      {/* The raster mark carries transparent margins; pull them in so the ink
          sits on the sidebar rail rather than inset from it. */}
      <View pointerEvents="none" style={styles.logo}>
        <BrandLogo size={LOGO_SIZE} />
      </View>
      {hasNav ? (
        <>
          <View style={styles.divider} />
          <SidebarNavRows style={styles.nav} onBeforeNavigate={onBeforeNavigate} iconOnly />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  logo: {
    marginHorizontal: -LOGO_SIZE * 0.1,
    marginVertical: -LOGO_SIZE * 0.18,
  },
  divider: {
    width: 1,
    height: 20,
    marginHorizontal: theme.spacing[1],
    backgroundColor: theme.colors.border,
  },
  nav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
}));
