import { brand } from "@frogg/branding";
import { router } from "expo-router";
import { useCallback, useMemo } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { BrandLogo } from "@/components/icons/brand-logo";
import { SidebarNavRows } from "@/components/sidebar/sidebar-nav-rows";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import { buildOpenProjectRoute } from "@/utils/host-routes";

const LOGO_SIZE = 40;

interface SidebarBrandHeaderProps {
  onBeforeNavigate?: () => void;
}

/**
 * Top sidebar row: the brand mark (a link home, like the Home nav item), then
 * the user's nav items as icon-only buttons.
 */
export function SidebarBrandHeader({ onBeforeNavigate }: SidebarBrandHeaderProps) {
  const { items } = useSidebarNavItems();
  const hasNav = useMemo(() => items.some((item) => item.visible), [items]);
  const handleLogoPress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(buildOpenProjectRoute());
  }, [onBeforeNavigate]);

  return (
    <View style={styles.root}>
      {/* The raster mark carries transparent margins; pull them in so the ink
          sits on the sidebar rail rather than inset from it. */}
      <Pressable
        onPress={handleLogoPress}
        accessibilityRole="link"
        accessibilityLabel={brand.name}
        testID="sidebar-brand-logo"
        style={styles.logo}
      >
        <BrandLogo size={LOGO_SIZE} />
      </Pressable>
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
