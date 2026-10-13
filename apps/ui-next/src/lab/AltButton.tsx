// Lab wrapper: a primary button in one candidate treatment. The treatments now live in
// components/Button.tsx (`look`), where the Design options pick selects them app-wide.
import type { LucideIcon } from "lucide-react-native";
import { Button, type ForceState, type PrimaryStyle } from "../components/Button";

export type Alt = Exclude<PrimaryStyle, "gradient">;
export type Force = ForceState;

export function AltButton({
  alt,
  label,
  icon,
  kbd,
  force,
  onPress,
}: {
  alt: Alt;
  label: string;
  icon?: LucideIcon;
  kbd?: string;
  force?: Force;
  onPress?: () => void;
}) {
  return (
    <Button
      kind="primary"
      look={alt}
      shape="chamfer"
      label={label}
      icon={icon}
      kbd={kbd}
      force={force}
      onPress={onPress}
    />
  );
}
