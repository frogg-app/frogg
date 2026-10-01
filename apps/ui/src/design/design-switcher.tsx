import { useCallback, useEffect } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import {
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Monitor,
  Moon,
  Palette,
  Sun,
  X,
} from "lucide-react-native";
import { useDemoChatRoute } from "./use-demo-chat-route";
import { DESIGN_VARIANT_IDS, getDesignVariant } from "@/styles/design-variants";
import type { DesignVariantId, Theme } from "@/styles/theme";
import {
  designPreviewPersist,
  useDesignPreviewStore,
  type DesignSchemePreference,
} from "./design-preview-store";

// Review tool for the UI-refresh branch: a floating bar to flip between the five design
// directions and the shipping design without reloading. Copy is intentionally not localised;
// this surface does not ship.
//
// Keyboard (web/desktop): Alt+Shift+← / → cycles directions, Alt+Shift+1…6 jumps,
// Alt+Shift+L cycles light/dark/auto, Alt+Shift+D hides or shows the bar.

const SCHEME_ORDER: readonly DesignSchemePreference[] = ["auto", "light", "dark"];
const SCHEME_ICON = { auto: Monitor, light: Sun, dark: Moon } as const;

const ThemedChevronLeft = withUnistyles(ChevronLeft);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedPalette = withUnistyles(Palette);
const ThemedX = withUnistyles(X);
const ThemedMessageSquare = withUnistyles(MessageSquare);
const ThemedSchemeIcons = {
  auto: withUnistyles(SCHEME_ICON.auto),
  light: withUnistyles(SCHEME_ICON.light),
  dark: withUnistyles(SCHEME_ICON.dark),
} as const;

const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const disabledMapping = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });
const SELECTED_STATE = { selected: true } as const;
const UNSELECTED_STATE = { selected: false } as const;

function variantLabel(id: DesignVariantId): string {
  return getDesignVariant(id)?.label ?? "Current";
}

/** `?design=<id>&scheme=<auto|light|dark>&switcher=0` selects a direction from a link, which
 * also lets `npm run shot -- "/route?design=paper"` capture each one. Applied after the
 * persisted state hydrates so the link wins. */
// Once per page load: the router can restore the query on navigation and the switcher can
// remount, and re-applying the params then would pin the direction against the user's switches.
let urlParamsApplied = false;

function useDesignUrlParams(): void {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined" || urlParamsApplied) return;
    urlParamsApplied = true;
    const params = new URLSearchParams(window.location.search);
    const apply = () => {
      const store = useDesignPreviewStore.getState();
      const design = params.get("design");
      const scheme = params.get("scheme");
      const match = DESIGN_VARIANT_IDS.find((id) => id === design);
      if (match) store.setVariant(match);
      const schemeMatch = SCHEME_ORDER.find((value) => value === scheme);
      if (schemeMatch) store.setScheme(schemeMatch);
      if (params.get("switcher") === "0") store.setSwitcherVisible(false);
      // Drop the params once applied so they don't pin the direction on later reloads.
      const url = new URL(window.location.href);
      for (const key of ["design", "scheme", "switcher"]) url.searchParams.delete(key);
      window.history.replaceState(window.history.state, "", url.toString());
    };
    if (!designPreviewPersist || designPreviewPersist.hasHydrated()) {
      apply();
      return;
    }
    return designPreviewPersist.onFinishHydration(apply);
  }, []);
}

function useDesignKeyboardShortcuts(): void {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) return;
      const store = useDesignPreviewStore.getState();
      const index = DESIGN_VARIANT_IDS.indexOf(store.variant);
      const count = DESIGN_VARIANT_IDS.length;
      const digit = /^Digit([1-9])$/.exec(event.code);
      if (event.code === "ArrowRight" || event.code === "ArrowLeft") {
        const step = event.code === "ArrowRight" ? 1 : -1;
        store.setVariant(DESIGN_VARIANT_IDS[(index + step + count) % count] ?? "current");
      } else if (digit) {
        const next = DESIGN_VARIANT_IDS[Number(digit[1]) - 1];
        if (!next) return;
        store.setVariant(next);
      } else if (event.code === "KeyL") {
        const next = SCHEME_ORDER[(SCHEME_ORDER.indexOf(store.scheme) + 1) % SCHEME_ORDER.length];
        store.setScheme(next ?? "auto");
      } else if (event.code === "KeyD") {
        store.setSwitcherVisible(!store.switcherVisible);
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}

export function DesignSwitcher() {
  useDesignKeyboardShortcuts();
  useDesignUrlParams();
  const variant = useDesignPreviewStore((state) => state.variant);
  const scheme = useDesignPreviewStore((state) => state.scheme);
  const visible = useDesignPreviewStore((state) => state.switcherVisible);
  const setVariant = useDesignPreviewStore((state) => state.setVariant);
  const setScheme = useDesignPreviewStore((state) => state.setScheme);
  const setVisible = useDesignPreviewStore((state) => state.setSwitcherVisible);

  const step = useCallback(
    (delta: number) => {
      const count = DESIGN_VARIANT_IDS.length;
      const index = DESIGN_VARIANT_IDS.indexOf(variant);
      setVariant(DESIGN_VARIANT_IDS[(index + delta + count) % count] ?? "current");
    },
    [variant, setVariant],
  );
  const previous = useCallback(() => step(-1), [step]);
  const next = useCallback(() => step(1), [step]);
  const cycleScheme = useCallback(() => {
    const index = SCHEME_ORDER.indexOf(scheme);
    setScheme(SCHEME_ORDER[(index + 1) % SCHEME_ORDER.length] ?? "auto");
  }, [scheme, setScheme]);
  const router = useRouter();
  const demoChatRoute = useDemoChatRoute();
  const openDemoChat = useCallback(() => {
    if (demoChatRoute) router.navigate(demoChatRoute as never);
  }, [demoChatRoute, router]);
  const show = useCallback(() => setVisible(true), [setVisible]);
  const hide = useCallback(() => setVisible(false), [setVisible]);

  const SchemeIcon = ThemedSchemeIcons[scheme];
  const definition = getDesignVariant(variant);

  if (!visible) {
    return (
      <View style={styles.container} pointerEvents="box-none">
        <Pressable
          onPress={show}
          style={styles.collapsed}
          accessibilityRole="button"
          accessibilityLabel="Show design switcher"
        >
          <ThemedPalette size={14} uniProps={mutedMapping} />
          <Text style={styles.collapsedLabel}>{variantLabel(variant)}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={styles.bar}>
        <Pressable
          onPress={previous}
          style={styles.iconButton}
          accessibilityLabel="Previous design"
        >
          <ThemedChevronLeft size={16} uniProps={mutedMapping} />
        </Pressable>
        <View style={styles.chips}>
          {DESIGN_VARIANT_IDS.map((id, index) => (
            <VariantChip
              key={id}
              id={id}
              index={index}
              selected={id === variant}
              onSelect={setVariant}
            />
          ))}
        </View>
        <Pressable onPress={next} style={styles.iconButton} accessibilityLabel="Next design">
          <ThemedChevronRight size={16} uniProps={mutedMapping} />
        </Pressable>
        <View style={styles.divider} />
        <Pressable
          onPress={openDemoChat}
          style={styles.demoButton}
          accessibilityLabel="Open the demo chat"
          disabled={!demoChatRoute}
        >
          <ThemedMessageSquare
            size={14}
            uniProps={demoChatRoute ? mutedMapping : disabledMapping}
          />
          <Text style={styles.chipLabel}>Demo chat</Text>
        </Pressable>
        <Pressable
          onPress={cycleScheme}
          style={styles.iconButton}
          accessibilityLabel={`Colour scheme: ${scheme}`}
          disabled={variant === "current"}
        >
          <SchemeIcon size={15} uniProps={variant === "current" ? disabledMapping : mutedMapping} />
        </Pressable>
        <Pressable
          onPress={hide}
          style={styles.iconButton}
          accessibilityLabel="Hide design switcher"
        >
          <ThemedX size={15} uniProps={mutedMapping} />
        </Pressable>
      </View>
      <Text style={styles.caption} numberOfLines={1}>
        {definition
          ? `${definition.tagline}  ·  Ref: ${definition.references.join(", ")}`
          : "The shipping design, following your theme setting."}
      </Text>
    </View>
  );
}

function VariantChip({
  id,
  index,
  selected,
  onSelect,
}: {
  id: DesignVariantId;
  index: number;
  selected: boolean;
  onSelect: (id: DesignVariantId) => void;
}) {
  const handlePress = useCallback(() => onSelect(id), [id, onSelect]);
  return (
    <Pressable
      onPress={handlePress}
      style={selected ? styles.chipSelected : styles.chip}
      accessibilityRole="button"
      accessibilityState={selected ? SELECTED_STATE : UNSELECTED_STATE}
    >
      <Text style={selected ? styles.chipLabelSelected : styles.chipLabel}>
        {Platform.OS === "web" ? `${index + 1} ` : ""}
        {variantLabel(id)}
      </Text>
    </Pressable>
  );
}

const chipBase = {
  paddingHorizontal: 10,
  paddingVertical: 5,
  borderRadius: 999,
} as const;

const styles = StyleSheet.create((theme, rt) => ({
  container: {
    position: "absolute",
    bottom: theme.spacing[3] + rt.insets.bottom,
    left: 0,
    right: 0,
    zIndex: 2000,
    alignItems: "center",
    gap: 4,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    padding: 4,
    borderRadius: 999,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    maxWidth: "96%",
    ...theme.shadow.lg,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 2,
    flexShrink: 1,
  },
  chip: {
    ...chipBase,
  },
  chipSelected: {
    ...chipBase,
    backgroundColor: theme.colors.accent,
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  chipLabelSelected: {
    fontSize: 12,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.accentForeground,
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  demoButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    height: 28,
    borderRadius: 999,
  },
  divider: {
    width: 1,
    height: 16,
    marginHorizontal: 2,
    backgroundColor: theme.colors.border,
  },
  caption: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: "hidden",
    maxWidth: "90%",
  },
  collapsed: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    opacity: 0.85,
    ...theme.shadow.md,
  },
  collapsedLabel: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
  },
}));
