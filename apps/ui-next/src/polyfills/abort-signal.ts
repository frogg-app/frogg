interface AbortSignalPolyfillTarget {
  AbortSignal?: { prototype: { aborted?: boolean; reason?: unknown; throwIfAborted?: unknown } };
}

/**
 * React Native's AbortSignal (the `abort-controller` package) predates
 * `throwIfAborted`, which the deploy flow and project import call.
 */
export function polyfillAbortSignal(
  target: AbortSignalPolyfillTarget = globalThis as unknown as AbortSignalPolyfillTarget,
): void {
  const prototype = target.AbortSignal?.prototype;
  if (!prototype || typeof prototype.throwIfAborted === "function") return;
  Object.defineProperty(prototype, "throwIfAborted", {
    configurable: true,
    writable: true,
    value: function throwIfAborted(this: { aborted?: boolean; reason?: unknown }) {
      if (!this.aborted) return;
      if (this.reason !== undefined) throw this.reason;
      const error = new Error("This operation was aborted");
      error.name = "AbortError";
      throw error;
    },
  });
}
