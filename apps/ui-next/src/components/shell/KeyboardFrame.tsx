import { KeyboardAvoidingView, Platform, View, type ViewProps } from "react-native";

/** Android's adjustResize already sizes the window around the IME. Adding keyboard padding
 * there applies the inset twice and can leave a gap after the keyboard closes. */
export function KeyboardFrame({ children, style }: ViewProps) {
  if (Platform.OS === "ios")
    return (
      <KeyboardAvoidingView behavior="padding" style={style}>
        {children}
      </KeyboardAvoidingView>
    );
  return <View style={style}>{children}</View>;
}
