import express from "express";
import { existsSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { Logger } from "pino";
import type { DaemonWebUiInterface, DaemonWebUiStatus } from "@frogg/protocol/messages";
import { createWebUiMiddleware, type WebUiGate } from "./web-ui.js";

/**
 * The web client's own HTTP server, on its own port beside the daemon's. It serves the bundled
 * web app and nothing else: the page connects to the daemon's port for everything it does.
 * Loopback by default; the owner picks an interface (or every interface) from the app.
 */

export const WEB_UI_DEFAULT_HOST = "127.0.0.1";
const ALL_INTERFACES = "0.0.0.0";

export interface WebUiSettings {
  /** Start the web client when the daemon starts. */
  startOnLaunch: boolean;
  host: string;
}

export interface WebUiServerOptions {
  logger: Logger;
  distDir: string | null;
  port: number;
  daemonPort: () => number | null;
  label: string;
  gate?: WebUiGate;
  /** The daemon's Express `trust proxy` setting, so forwarded HTTPS is honoured the same way. */
  trustProxy?: () => unknown;
  settings: WebUiSettings;
  /** Set by an environment variable or CLI flag, so the app cannot change it. */
  startOnLaunchPinned: boolean;
  saveSettings: (settings: WebUiSettings) => void;
  listInterfaces?: () => DaemonWebUiInterface[];
}

export function listWebUiInterfaces(): DaemonWebUiInterface[] {
  const found: DaemonWebUiInterface[] = [{ address: WEB_UI_DEFAULT_HOST, name: "loopback" }];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      found.push({ address: entry.address, name });
    }
  }
  found.push({ address: ALL_INTERFACES, name: "all" });
  return found;
}

/** Hostname of a `Host` header or origin authority, without port or IPv6 brackets. */
function hostnameOf(authority: string): string {
  const trimmed = authority.trim().toLowerCase();
  if (trimmed.startsWith("[")) return trimmed.slice(1, trimmed.indexOf("]"));
  const colon = trimmed.lastIndexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

function isLoopbackName(hostname: string): boolean {
  return hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");
}

function listenErrorMessage(err: NodeJS.ErrnoException, host: string, port: number): string {
  if (err.code === "EADDRINUSE") return `Port ${port} on ${host} is already in use.`;
  if (err.code === "EADDRNOTAVAIL") return `${host} is not an address of this machine.`;
  return err.message;
}

export class WebUiServer {
  private readonly logger: Logger;
  private readonly options: WebUiServerOptions;
  private settings: WebUiSettings;
  private server: http.Server | null = null;
  private boundHost: string | null = null;
  private lastError: string | null = null;

  constructor(options: WebUiServerOptions) {
    this.logger = options.logger.child({ module: "web-ui-server" });
    this.options = options;
    this.settings = options.settings;
  }

  private get available(): boolean {
    const distDir = this.options.distDir;
    return !!distDir && existsSync(path.join(distDir, "index.html"));
  }

  status(): DaemonWebUiStatus {
    return {
      available: this.available,
      running: this.server !== null,
      host: this.boundHost ?? this.settings.host,
      port: this.options.port,
      startOnLaunch: this.settings.startOnLaunch,
      startOnLaunchPinned: this.options.startOnLaunchPinned,
      interfaces: (this.options.listInterfaces ?? listWebUiInterfaces)(),
      lastError: this.lastError,
    };
  }

  /** Starts on launch when configured to. Failures are logged and reported in the status. */
  async startOnLaunch(): Promise<void> {
    if (!this.settings.startOnLaunch) return;
    const error = await this.start();
    if (error) this.logger.warn({ error }, "Web client did not start");
  }

  /** Returns an error message, or null once it is listening. */
  async start(): Promise<string | null> {
    if (this.server) return null;
    if (!this.available) {
      this.lastError = "This daemon has no web client build.";
      return this.lastError;
    }
    const app = express();
    app.disable("x-powered-by");
    app.set("trust proxy", this.options.trustProxy?.() ?? false);
    // The page talks to the daemon, not to this server: point its connection hint (and the
    // claim page's pairing link) at the daemon's port on the same host name.
    app.use((req, _res, next) => {
      const daemonPort = this.options.daemonPort();
      const host = typeof req.headers.host === "string" ? req.headers.host : null;
      if (daemonPort && host) {
        const name = hostnameOf(host);
        req.headers.host = `${name.includes(":") ? `[${name}]` : name}:${daemonPort}`;
      }
      next();
    });
    app.use(
      createWebUiMiddleware({
        enabled: true,
        distDir: this.options.distDir,
        label: this.options.label,
        logger: this.logger,
        gate: this.options.gate,
      }),
    );
    app.use((_req, res) => {
      res.status(404).end();
    });

    const server = http.createServer(app);
    const host = this.settings.host;
    const error = await new Promise<string | null>((resolve) => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        resolve(listenErrorMessage(err, host, this.options.port));
      });
      server.listen(this.options.port, host, () => resolve(null));
    });
    this.lastError = error;
    if (error) return error;
    this.server = server;
    this.boundHost = host;
    this.logger.info({ host, port: this.options.port }, "Web client listening");
    return null;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    this.boundHost = null;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.logger.info("Web client stopped");
  }

  /** Saves the settings; a running server moves to a new interface at once. */
  async update(input: { startOnLaunch?: boolean; host?: string }): Promise<string | null> {
    if (input.startOnLaunch !== undefined && this.options.startOnLaunchPinned) {
      return "Starting the web client with the daemon is set by the daemon's environment or command line.";
    }
    if (input.host !== undefined) {
      const known = (this.options.listInterfaces ?? listWebUiInterfaces)().some(
        (entry) => entry.address === input.host,
      );
      if (!known) return `${input.host} is not an interface of this machine.`;
    }
    const previousHost = this.settings.host;
    this.settings = {
      startOnLaunch: input.startOnLaunch ?? this.settings.startOnLaunch,
      host: input.host ?? this.settings.host,
    };
    this.options.saveSettings(this.settings);
    if (this.server && this.settings.host !== previousHost) {
      await this.stop();
      return this.start();
    }
    return null;
  }

  /**
   * Whether `origin` is a page this web server served: its port, on the host name the request
   * reached the daemon by (or loopback, from this machine).
   */
  isWebClientOrigin(origin: string | undefined, requestHost: string | null | undefined): boolean {
    if (!this.server || !origin) return false;
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      return false;
    }
    if (Number(url.port) !== this.options.port) return false;
    const originName = hostnameOf(url.host);
    if (!requestHost) return isLoopbackName(originName);
    const requestName = hostnameOf(requestHost);
    return (
      originName === requestName || (isLoopbackName(originName) && isLoopbackName(requestName))
    );
  }
}
