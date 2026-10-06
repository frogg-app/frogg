import { polyfillAbortSignal } from "./abort-signal";
import { polyfillCrypto } from "./crypto";
import { polyfillNavigator } from "./navigator";

// Mirrors apps/ui: Hermes lacks crypto.randomUUID (the daemon client's request ids), AbortSignal
// helpers and parts of navigator. Runs before expo-router evaluates any route.
polyfillNavigator();
polyfillAbortSignal();
polyfillCrypto();
