import { useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { ArrowRight, ChevronRight, FolderOpen, Inbox, Plug, Smartphone } from "lucide-react-native";
import type { Theme } from "@/styles/theme";
import { CODE_SURFACE_DATASET, DESIGN_FONT_DATASET } from "@/styles/code-surface";
import { heroStyles, listStyles, tileStyles } from "./home-actions-styles";
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
// Mono's list arrow sits on the solid primary; Inset's on the indigo accent.
const listPrimaryIconColor = (theme: Theme) => ({
  color:
    theme.design.variant === "mono"
      ? theme.colors.primaryForeground
      : theme.colors.accentForeground,
});
const tilesStyle = [tileStyles.tiles, tileStyles.tilesDesign];

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
      tileStyles.tileBase,
      tileStyles.tileDesign,
      hovered && tileStyles.tileHovered,
      pressed && tileStyles.pressed,
    ],
    [],
  );
  const Icon = ICONS[action.icon];
  return (
    <Pressable onPress={action.onPress} testID={action.testID} style={style}>
      <View style={action.accent ? tileStyles.iconWellAccent : tileStyles.iconWell}>
        <Icon size={20} uniProps={action.accent ? tileAccentIconColor : mutedColor} />
      </View>
      <View style={tileStyles.text}>
        <Text style={tileStyles.title} dataSet={DESIGN_FONT_DATASET}>
          {action.title}
        </Text>
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
      heroStyles.heroShadow,
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
      <View style={heroStyles.footer}>
        <View style={heroStyles.submit}>
          <ThemedArrowRight size={18} uniProps={onAccentColor} />
        </View>
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
          <ThemedArrowRight size={14} uniProps={listPrimaryIconColor} />
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
    <View style={tilesStyle}>
      {actions.map((action) => (
        <HomeTile key={action.key} action={action} />
      ))}
    </View>
  );
}
