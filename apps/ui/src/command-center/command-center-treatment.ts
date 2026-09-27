import type { ViewFragment, TextFragment } from "@/styles/style-fragment";
import type { Theme } from "@/styles/theme";

/**
 * How the command palette is drawn in each design direction. Row and section heights are fixed
 * because the virtualised list lays rows out from them, so a direction only changes paint,
 * horizontal inset and the header. `current` is empty: the shipping palette is untouched.
 */
export interface CommandCenterTreatment {
  backdrop: ViewFragment;
  panel: ViewFragment;
  header: ViewFragment;
  input: TextFragment;
  sectionLabel: TextFragment;
  row: ViewFragment;
  activeRow: ViewFragment;
}

const EMPTY: CommandCenterTreatment = {
  backdrop: {},
  panel: {},
  header: {},
  input: {},
  sectionLabel: {},
  row: {},
  activeRow: {},
};

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
  switch (theme.design.variant) {
    case "current":
      return EMPTY;
    case "inset":
      // Linear: tight, bordered, indigo selection edge.
      return {
        ...EMPTY,
        panel: { borderRadius: r.xl, borderColor: c.borderAccent },
        input: lgInput,
        sectionLabel: { fontWeight: theme.fontWeight.medium },
        ...insetRow(theme, r.md, c.surface2),
      };
    case "mono":
      // Vercel: stark hairlines, uppercase labels, flat grey selection.
      return {
        ...EMPTY,
        backdrop: { backgroundColor: "rgba(0, 0, 0, 0.35)" },
        panel: { borderRadius: r.xl, borderColor: c.borderAccent },
        input: lgInput,
        sectionLabel: {
          fontSize: theme.fontSize.sm - 1,
          textTransform: "uppercase",
          letterSpacing: 0.8,
        },
        ...insetRow(theme, r.md, c.surface2),
      };
    case "paper":
      return {
        ...EMPTY,
        backdrop: { backgroundColor: "rgba(41, 38, 27, 0.28)" },
        panel: { borderRadius: r["2xl"], borderWidth: 0 },
        header: { borderBottomColor: c.surface2, paddingVertical: theme.spacing[4] },
        input: lgInput,
        ...insetRow(theme, r.lg, c.surface2),
      };
    case "focus":
      // A quiet floating card: no lines, a large input, soft selection.
      return {
        ...EMPTY,
        backdrop: { backgroundColor: "rgba(0, 0, 0, 0.2)" },
        panel: { borderRadius: r["2xl"], borderWidth: 0 },
        header: { borderBottomWidth: 0, paddingVertical: theme.spacing[4] },
        input: { fontSize: theme.fontSize.xl },
        ...insetRow(theme, r.lg, c.surface1),
      };
    case "soft":
      return {
        ...EMPTY,
        backdrop: { backgroundColor: "rgba(0, 0, 0, 0.3)" },
        panel: { borderRadius: r["2xl"], borderWidth: 0 },
        header: { borderBottomWidth: 0, paddingVertical: theme.spacing[4] },
        input: lgInput,
        sectionLabel: { fontWeight: theme.fontWeight.semibold },
        ...insetRow(theme, 999, c.surface2),
      };
  }
}
