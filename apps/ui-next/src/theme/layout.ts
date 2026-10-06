import { useWindowDimensions } from "react-native";
import { bp } from "./tokens";

export type FormFactor = "phone" | "tablet" | "desktop";

export function useFormFactor(): FormFactor {
  const { width } = useWindowDimensions();
  if (width < bp.tablet) return "phone";
  if (width < bp.desktop) return "tablet";
  return "desktop";
}
