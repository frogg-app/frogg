import { useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ArrowRight, ChevronRight, FolderOpen, Inbox, Plug, Smartphone } from "lucide-react-native";
import type { Theme } from "@/styles/theme";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import type { HomeLayout } from "./home-layout";

export type HomeActionIcon = "folder" | "inbox" | "plug" | "phone";

export interface HomeAction {
  key: string;
  icon: HomeActionIcon;
  title: string;
  description: string;
  onPress: () => void;
  testID: string;
  accent?: boolean;
}

const ICONS = {
  folder: withUnistyles(FolderOpen),
  inbox: withUnistyles(Inbox),
  plug: withUnistyles(Plug),
  phone: withUnistyles(Smartphone),
} as const;
const ThemedArrowRight = withUnistyles(ArrowRight);
const ThemedChevronRight = withUnistyles(ChevronRight);

const accentColor = (theme: Theme) => ({ color: theme.colors.accent });
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const onAccentColor = (theme: Theme) => ({ color: theme.colors.accentForeground });
const onPrimaryColor = (theme: Theme) => ({ color: theme.colors.primaryForeground });

type HoverState = PressableStateCallbackType & { hovered?: boolean };

function ActionIcon({ action, size }: { action: HomeAction; size: number }) {
  const Icon = ICONS[action.icon];
  return <Icon size={size} uniProps={action.accent ? accentColor : mutedColor} />;
}

/** A grid card: today's tile, reshaped by Paper (calm, tinted) and Soft (big, rounded). */
function HomeTile({ action }: { action: HomeAction }) {
  const style = useCallback(
    ({ pressed, hovered }: HoverState) => [
      tileStyles.tile,
      hovered && tileStyles.tileHovered,
      pressed && tileStyles.pressed,
    ],
    [],
  );
  const Icon = ICONS[action.icon];
  return (
    <Pressable onPress={action.onPress} testID={action.testID} style={style}>
      <View style={action.accent ? tileStyles.iconWellAccent : tileStyles.iconWell}>
        <Icon
          size={tileStyles.iconSize.width}
          uniProps={action.accent ? tileAccentIconColor : mutedColor}
        />
      </View>
      <View style={tileStyles.text}>
        <Text style={tileStyles.title}>{action.title}</Text>
        <Text style={tileStyles.description}>{action.description}</Text>
      </View>
    </Pressable>
  );
}

// Soft fills the primary tile's icon well with the accent, so its glyph flips to the foreground.
const tileAccentIconColor = (theme: Theme) =>
  theme.design.variant === "soft" ? onAccentColor(theme) : accentColor(theme);

/** Focus: the primary action drawn like a composer card, front and centre. */
function HeroAction({ action }: { action: HomeAction }) {
  const style = useCallback(
    ({ pressed, hovered }: HoverState) => [
      heroStyles.hero,
      hovered && heroStyles.heroHovered,
      pressed && tileStyles.pressed,
    ],
    [],
  );
  return (
    <Pressable onPress={action.onPress} testID={action.testID} style={style}>
      <View style={heroStyles.body}>
        <ActionIcon action={action} size={20} />
        <View style={tileStyles.text}>
          <Text style={heroStyles.title}>{action.title}</Text>
          <Text style={tileStyles.description}>{action.description}</Text>
        </View>
      </View>
      <View style={heroStyles.submit}>
        <ThemedArrowRight size={18} uniProps={onAccentColor} />
      </View>
    </Pressable>
  );
}

function HeroChip({ action }: { action: HomeAction }) {
  const style = useCallback(
    ({ pressed, hovered }: HoverState) => [
      heroStyles.chip,
      hovered && heroStyles.chipHovered,
      pressed && tileStyles.pressed,
    ],
    [],
  );
  return (
    <Pressable
      onPress={action.onPress}
      testID={action.testID}
      style={style}
      accessibilityHint={action.description}
    >
      <ActionIcon action={action} size={16} />
      <Text style={heroStyles.chipText}>{action.title}</Text>
    </Pressable>
  );
}

/** Mono and Inset: one row per action in a single hairline list. */
function HomeListRow({ action, index }: { action: HomeAction; index: number }) {
  const style = useCallback(
    ({ pressed, hovered }: HoverState) => [
      listStyles.row,
      index > 0 && listStyles.divider,
      hovered && listStyles.hovered,
      pressed && tileStyles.pressed,
    ],
    [index],
  );
  return (
    <Pressable onPress={action.onPress} testID={action.testID} style={style}>
      <Text style={listStyles.index} dataSet={CODE_SURFACE_DATASET}>
        {String(index + 1).padStart(2, "0")}
      </Text>
      <ActionIcon action={action} size={16} />
      <View style={listStyles.text}>
        <Text style={listStyles.title} numberOfLines={1}>
          {action.title}
        </Text>
        <Text style={listStyles.description} numberOfLines={1}>
          {action.description}
        </Text>
      </View>
      {action.accent ? (
        <View style={listStyles.primary}>
          <ThemedArrowRight size={14} uniProps={onPrimaryColor} />
        </View>
      ) : (
        <ThemedChevronRight size={14} uniProps={mutedColor} />
      )}
    </Pressable>
  );
}

export function HomeActions({ actions, layout }: { actions: HomeAction[]; layout: HomeLayout }) {
  if (layout === "hero") {
    const [primary, ...rest] = actions;
    return (
      <View style={heroStyles.stack}>
        {primary ? <HeroAction action={primary} /> : null}
        <View style={heroStyles.chips}>
          {rest.map((action) => (
            <HeroChip key={action.key} action={action} />
          ))}
        </View>
      </View>
    );
  }
  if (layout === "list") {
    return (
      <View style={listStyles.list}>
        {actions.map((action, index) => (
          <HomeListRow key={action.key} action={action} index={index} />
        ))}
      </View>
    );
  }
  return (
    <View style={tileStyles.tiles}>
      {actions.map((action) => (
        <HomeTile key={action.key} action={action} />
      ))}
    </View>
  );
}

const TILE_SPEC = {
  current: { width: 220, minHeight: 132, radius: "xl", gap: 3, titleSize: "base", weight: "normal" },
  paper: { width: 220, minHeight: 132, radius: "xl", gap: 3, titleSize: "base", weight: "500" },
  soft: { width: 230, minHeight: 156, radius: "2xl", gap: 4, titleSize: "lg", weight: "600" },
  focus: { width: 220, minHeight: 132, radius: "xl", gap: 3, titleSize: "base", weight: "500" },
  mono: { width: 220, minHeight: 132, radius: "xl", gap: 3, titleSize: "base", weight: "500" },
  inset: { width: 220, minHeight: 132, radius: "xl", gap: 3, titleSize: "base", weight: "500" },
} as const;

const tileStyles = StyleSheet.create((theme) => {
  const spec = TILE_SPEC[theme.design.variant];
  const soft = theme.design.variant === "soft";
  const current = theme.design.variant === "current";
  const well = {
    width: 44,
    height: 44,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  } as const;
  return {
    tiles: {
      marginTop: current ? { xs: theme.spacing[6], md: theme.spacing[12] } : theme.spacing[8],
      width: "100%",
      maxWidth: spec.width * 2 + theme.spacing[spec.gap],
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "flex-start",
      gap: theme.spacing[spec.gap],
    },
    tile: {
      width: { xs: "100%", md: spec.width },
      minHeight: { xs: 0, md: spec.minHeight },
      padding: current ? theme.spacing[4] : theme.spacing[6] - theme.spacing[1],
      backgroundColor: theme.colors.surface1,
      borderWidth: theme.design.borderless ? 0 : 1,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius[spec.radius],
      gap: theme.spacing[spec.gap],
      ...(soft ? theme.shadow.sm : null),
    },
    tileHovered: {
      backgroundColor: theme.colors.surface2,
      borderColor: theme.colors.borderAccent,
    },
    pressed: {
      opacity: 0.85,
    },
    iconSize: {
      width: 20,
    },
    iconWell: soft ? { ...well, backgroundColor: theme.colors.surface3 } : {},
    iconWellAccent: soft ? { ...well, backgroundColor: theme.colors.accent } : {},
    text: {
      gap: theme.spacing[1],
      flexShrink: 1,
    },
    title: {
      color: theme.colors.foreground,
      fontSize: theme.fontSize[spec.titleSize],
      fontWeight: spec.weight,
    },
    description: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.base,
      lineHeight: current ? 18 : 20,
    },
  };
});

const heroStyles = StyleSheet.create((theme) => ({
  stack: {
    marginTop: theme.spacing[8],
    width: "100%",
    maxWidth: 640,
    gap: theme.spacing[6],
    alignItems: "center",
  },
  hero: {
    width: "100%",
    minHeight: 112,
    padding: theme.spacing[4],
    paddingLeft: theme.spacing[6] - theme.spacing[1],
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    justifyContent: "space-between",
    gap: theme.spacing[3],
    ...theme.shadow.md,
  },
  heroHovered: {
    borderColor: theme.colors.borderAccent,
  },
  body: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
    paddingTop: theme.spacing[1],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: "500",
  },
  submit: {
    alignSelf: "flex-end",
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accent,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    height: 34,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.design.controlRadius,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipHovered: {
    backgroundColor: theme.colors.surface1,
  },
  chipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
}));

const listStyles = StyleSheet.create((theme) => {
  const mono = theme.design.variant === "mono";
  return {
    list: {
      marginTop: mono ? theme.spacing[8] : theme.spacing[4],
      width: "100%",
      maxWidth: mono ? 560 : 440,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius[mono ? "md" : "lg"],
      backgroundColor: mono ? theme.colors.surface0 : theme.colors.surface1,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: mono ? theme.spacing[3] : theme.spacing[2] + theme.spacing[0.5],
      minHeight: mono ? 56 : 36,
      paddingHorizontal: mono ? theme.spacing[4] : theme.spacing[3],
      paddingVertical: mono ? theme.spacing[3] : theme.spacing[1.5],
    },
    divider: {
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    hovered: {
      backgroundColor: mono ? theme.colors.surface1 : theme.colors.surface2,
    },
    index: mono
      ? {
          width: 20,
          color: theme.colors.foregroundExtraMuted,
          fontSize: theme.fontSize.sm,
          fontFamily: theme.design.monoFontFamily,
        }
      : { display: "none" },
    text: {
      flex: 1,
      minWidth: 0,
      flexDirection: mono ? "column" : "row",
      alignItems: mono ? "stretch" : "baseline",
      gap: mono ? 2 : theme.spacing[2],
    },
    title: {
      flexShrink: 0,
      color: theme.colors.foreground,
      fontSize: mono ? theme.fontSize.base : 13,
      fontWeight: "500",
    },
    description: {
      flexShrink: 1,
      color: theme.colors.foregroundMuted,
      fontSize: mono ? theme.fontSize.sm : 13,
    },
    primary: {
      width: 24,
      height: 24,
      borderRadius: theme.borderRadius.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.primary,
    },
  };
});
