export class PluginServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly capabilities?: string[],
  ) {
    super(message);
  }
}

export function toPluginError(err: unknown): {
  code: string;
  message: string;
  capabilities?: string[];
} {
  if (err instanceof PluginServiceError) {
    return {
      code: err.code,
      message: err.message,
      ...(err.capabilities ? { capabilities: err.capabilities } : {}),
    };
  }
  return { code: "internal", message: err instanceof Error ? err.message : String(err) };
}
