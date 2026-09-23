/**
 * expo-router publishes JSX inside plain `.js` files, which the dependency
 * optimizer parses as JavaScript and rejects, and following it drags the whole
 * native navigation stack (react-native-screens, @react-navigation) into the
 * scan. No test in either project navigates for real — they reach the package
 * only because a component calls `useRouter` — so the tests resolve it to this
 * inert stand-in instead.
 */

export type Href = string;

const noop = () => {};

export const router = {
  push: noop,
  replace: noop,
  back: noop,
  canGoBack: () => false,
  navigate: noop,
  dismiss: noop,
  dismissAll: noop,
  setParams: noop,
};

export const useRouter = () => router;
export const usePathname = () => "/";
export const useLocalSearchParams = () => ({});
export const useGlobalSearchParams = () => ({});
export const useRootNavigationState = () => ({ key: "stub" });
export const useNavigationContainerRef = () => ({ current: null });
export const Redirect = () => null;
export const Stack = Object.assign(() => null, { Screen: () => null });
