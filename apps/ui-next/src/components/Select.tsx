import { Check, ChevronDown } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { color, web } from "../theme/tokens";
import { Cut } from "./Cut";
import { T } from "./Text";

export interface Option<V extends string> {
  value: V;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/** A bracket-styled dropdown; the menu opens in place over what follows. */
export function Select<V extends string>({
  value, options, onChange, icon, placeholder = "Choose", mono, width = 240, up, chip, menuWidth,
}: {
  value: V | null; options: Array<Option<V>>; onChange: (v: V) => void; icon?: ReactNode;
  placeholder?: string; mono?: boolean; width?: number | "100%" | "auto";
  /** Open the menu above the field (for controls near the bottom edge). */
  up?: boolean;
  /** Composer-chip look: no border, tinted fill. */
  chip?: boolean;
  menuWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={{ width, zIndex: open ? 40 : 1 }}>
      <Pressable onPress={() => setOpen(!open)}>
        {({ hovered }) => (
          <View style={[s.field, chip && s.chip, (hovered || open) && (chip ? { backgroundColor: "rgba(255,255,255,0.1)" } : { borderColor: color.line2 })]}>
            {icon}
            <T v={mono ? "mono" : "body"} numberOfLines={1} style={{ flex: chip ? undefined : 1, color: current ? color.text : color.faint, fontSize: chip ? 11.5 : mono ? 12.5 : 13.5 }}>
              {current?.label ?? placeholder}
            </T>
            <ChevronDown size={chip ? 11 : 14} color={color.faint} />
          </View>
        )}
      </Pressable>
      {open && (
        <Cut size={8} flip style={[s.menu, up && s.menuUp, menuWidth !== undefined && { width: menuWidth, right: undefined }]}>
          <ScrollView style={{ maxHeight: 260 }}>
            {options.map((o) => (
              <Pressable
                key={o.value}
                disabled={o.disabled}
                onPress={() => {
                  setOpen(false);
                  onChange(o.value);
                }}
              >
                {({ hovered }) => (
                  <View style={[s.opt, hovered && { backgroundColor: "rgba(37,181,200,0.1)" }, o.disabled && { opacity: 0.4 }]}>
                    <View style={{ flex: 1 }}>
                      <T v={mono ? "mono" : "body"} style={{ color: color.text, fontSize: mono ? 12.5 : 13.5 }}>{o.label}</T>
                      {o.hint && <T style={{ color: color.faint, fontSize: 11.5, marginTop: 2 }}>{o.hint}</T>}
                    </View>
                    {o.value === value && <Check size={13} color={color.cyan2} />}
                  </View>
                )}
              </Pressable>
            ))}
          </ScrollView>
        </Cut>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  field: {
    flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 7,
    backgroundColor: color.bg, borderWidth: 1, borderColor: color.line,
  },
  menu: {
    position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, backgroundColor: color.raise,
    borderWidth: 1, borderColor: color.line2, paddingVertical: 4, ...web({ boxShadow: "0 16px 40px #000a" }),
  },
  chip: { borderWidth: 0, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: "rgba(255,255,255,0.05)", gap: 6 },
  menuUp: { top: undefined, bottom: "100%", marginTop: 0, marginBottom: 4 },
  opt: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
});
