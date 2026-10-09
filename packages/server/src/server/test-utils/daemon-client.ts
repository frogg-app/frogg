import { WebSocket } from "ws";
import {
  DaemonClient as SharedDaemonClient,
  type DaemonClientConfig as SharedDaemonClientConfig,
  type CreateAgentRequestOptions,
  type DaemonEvent,
  type DaemonEventHandler,
  type SendMessageOptions,
  type WebSocketLike,
} from "@frogg/client/internal/daemon-client";

export type DaemonClientConfig = Omit<
  SharedDaemonClientConfig,
  "webSocketFactory" | "transportFactory" | "clientId"
> & { clientId?: string };
export type CreateAgentOptions = CreateAgentRequestOptions;
export { type SendMessageOptions, type DaemonEvent, type DaemonEventHandler };

let testClientCounter = 0;

/**
 * Local tokens of running test daemons by port. Every connection must carry a
 * credential, so a test client that names none presents its daemon's local
 * token, as the local CLI does.
 */
const testDaemonLocalTokens = new Map<number, string>();

export function registerTestDaemonLocalToken(port: number, token: string): () => void {
  testDaemonLocalTokens.set(port, token);
  return () => {
    if (testDaemonLocalTokens.get(port) === token) testDaemonLocalTokens.delete(port);
  };
}

function defaultLocalToken(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return testDaemonLocalTokens.get(Number(parsed.port));
  } catch {
    return undefined;
  }
}

function nextTestClientId(): string {
  testClientCounter += 1;
  return `clid_test_client_${testClientCounter}`;
}

export class DaemonClient extends SharedDaemonClient {
  constructor(config: DaemonClientConfig) {
    const clientId = config.clientId ?? nextTestClientId();
    const password =
      config.password === undefined && !config.authHeader
        ? defaultLocalToken(config.url)
        : config.password;
    super({
      ...config,
      ...(password !== undefined ? { password } : {}),
      clientId,
      webSocketFactory: (url, options) =>
        new WebSocket(url, options?.protocols, {
          headers: options?.headers,
        }) as unknown as WebSocketLike,
    });
  }
}
