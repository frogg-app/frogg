import type { ViewFragment, TextFragment } from "@/styles/style-fragment";
import type { Theme } from "@/styles/theme";

/**
 * How the command palette is drawn in each design direction. Row and section heights are fixed
 * because the virtualised list lays rows out from them, so a direction only changes paint,
 * horizontal inset and the header. `current` is empty: the shipping palette is untouched.
 */
export interface CommandCenterTreatment {
  overlay: ViewFragment;
  backdrop: ViewFragment;
  panel: ViewFragment;
  header: ViewFragment;
  input: TextFragment;
  sectionLabel: TextFragment;
  row: ViewFragment;
  activeRow: ViewFragment;
  divider: ViewFragment;
}

const EMPTY: CommandCenterTreatment = {
  overlay: {},
  backdrop: {},
  panel: {},
  header: {},
  input: {},
  sectionLabel: {},
  row: {},
  activeRow: {},
  divider: {},
};

/** Borderless directions separate sections by space; the divider keeps its height for layout. */
const QUIET_DIVIDER: ViewFragment = { backgroundColor: "transparent" };

/** An inset, rounded highlight instead of a full-bleed band. */
function insetRow(theme: Theme, radius: number, backgroundColor: string) {
  return {
    row: { marginHorizontal: theme.spacing[2], paddingHorizontal: theme.spacing[2] },
    activeRow: { backgroundColor, borderRadius: radius },
  };
}

export function commandCenterTreatment(theme: Theme): CommandCenterTreatment {
  const c = theme.colors;
  const r = theme.borderRadius;
  const lgInput = { fontSize: theme.fontSize.lg };
  const dark = theme.colorScheme === "dark";
  switch (theme.design.variant) {
    case "current":
      return EMPTY;
    case "inset":
      // Linear: tight, bordered, indigo selection edge.
      return {
        ...EMPTY,
        panel: { borderRadius: r.xl, borderColor: c.borderAccent },
        header: { paddingVertical: theme.spacing[2] },
        input: { fontSize: theme.fontSize.base },
        sectionLabel: { fontWeight: theme.fontWeight.medium },
        ...insetRow(theme, r.md, c.surface2),
      };
    case "mono":
      // Vercel: stark hairlines, uppercase labels, flat grey selection.
      return {
        ...EMPTY,
        backdrop: { backgroundColor: "rgba(0, 0, 0, 0.35)" },
        panel: { borderRadius: r.xl, borderColor: dark ? c.borderAccent : c.surface4 },
        input: lgInput,
        sectionLabel: {
          fontSize: theme.fontSize.sm - 1,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          fontFamily: theme.fontFamily.mono,
        },
        ...insetRow(theme, r.md, c.surface2),
      };
    case "paper":
      return {
        ...EMPTY,
        backdrop: { backgroundColor: "rgba(41, 38, 27, 0.28)" },
        overlay: { paddingTop: theme.spacing[16] },
        panel: { borderRadius: r["2xl"], borderWidth: 0, backgroundColor: c.surface1 },
        header: { borderBottomColor: c.surface3, paddingVertical: theme.spacing[4] },
        input: lgInput,
        ...insetRow(theme, r.lg, c.surface3),
        divider: QUIET_DIVIDER,
      };
    case "focus":
      // A quiet floating card: no lines, a large input, soft selection.
      return {
        ...EMPTY,
        backdrop: { backgroundColor: "rgba(0, 0, 0, 0.2)" },
        panel: { borderRadius: r["2xl"], borderWidth: 0 },
        overlay: { paddingTop: theme.spacing[24] },
        header: { borderBottomWidth: 0, paddingVertical: theme.spacing[4] },
        input: { fontSize: theme.fontSize.xl },
        ...insetRow(theme, r.lg, c.surface1),
        divider: QUIET_DIVIDER,
      };
    case "soft":
      return {
        ...EMPTY,
        overlay: { paddingTop: theme.spacing[16] },
        backdrop: { backgroundColor: "rgba(0, 0, 0, 0.3)" },
        panel: {
          borderRadius: r["2xl"],
          borderWidth: 0,
          backgroundColor: dark ? c.surface2 : c.palette.white,
        },
        header: { borderBottomWidth: 0, paddingVertical: theme.spacing[4] },
        input: lgInput,
        sectionLabel: { fontWeight: theme.fontWeight.semibold },
        ...insetRow(theme, 999, dark ? c.surface4 : c.surface2),
        divider: QUIET_DIVIDER,
      };
  }
}
