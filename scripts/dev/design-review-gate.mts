// Key gate in front of the design-review daemon. The tunnel reaches this proxy, not the daemon:
// a visitor opens `/?key=<key>` once, gets a cookie, and every request and WebSocket after that
// is forwarded with the client placed on the LAN (`X-Forwarded-For` rewritten), which the
// daemon's LAN trust lets in without pairing. Anything without the key gets a 401.
import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import net from "node:net";

const COOKIE = "frogg_design_review";
// A private address the daemon classifies as LAN (see access-policy.ts classifyRequestLocality).
const LAN_CLIENT = "192.168.254.254";

export function newReviewKey(): string {
  return randomBytes(18).toString("base64url");
}

function sameKey(candidate: string | undefined | null, key: string): boolean {
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieKey(req: http.IncomingMessage): string | undefined {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return undefined;
}

function forwardHeaders(req: http.IncomingMessage): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...req.headers };
  for (const name of Object.keys(headers)) {
    if (name.startsWith("x-forwarded-") || name.startsWith("cf-")) delete headers[name];
  }
  headers["x-forwarded-for"] = LAN_CLIENT;
  headers["x-forwarded-proto"] = "https";
  return headers;
}

export function startReviewGate(input: { port: number; daemonPort: number; key: string }) {
  const { port, daemonPort, key } = input;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://gate");
    if (sameKey(url.searchParams.get("key"), key)) {
      url.searchParams.delete("key");
      res.writeHead(302, {
        "Set-Cookie": `${COOKIE}=${key}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
        Location: `${url.pathname}${url.search}`,
      });
      res.end();
      return;
    }
    if (!sameKey(cookieKey(req), key)) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("Open the design review link that includes ?key=\n");
      return;
    }
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: daemonPort,
        method: req.method,
        path: req.url,
        headers: forwardHeaders(req),
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });

  server.on("upgrade", (req, socket, head) => {
    if (!sameKey(cookieKey(req), key)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return;
    }
    const upstream = net.connect(daemonPort, "127.0.0.1", () => {
      const headers = forwardHeaders(req);
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (const [name, value] of Object.entries(headers)) {
        for (const item of Array.isArray(value) ? value : [value]) {
          if (item !== undefined) lines.push(`${name}: ${item}`);
        }
      }
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const close = () => {
      upstream.destroy();
      socket.destroy();
    };
    upstream.on("error", close);
    socket.on("error", close);
  });

  server.listen(port, "127.0.0.1");
  return server;
}
