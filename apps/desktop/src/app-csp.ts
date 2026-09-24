// Content-Security-Policy for the packaged app document served over the app scheme.
//
// Hosts are user-chosen (direct, relay, SSH-forwarded, LAN), so connect-src and
// img-src stay open. What the policy buys is that no script can come from
// anywhere but the bundle: remote script origins, plugins, framing by other
// pages, <base> hijacking and form posts are all refused.
//
// Inline script is allowed on purpose: the mermaid runtime and the HTML file
// preview render in sandboxed srcdoc iframes, and a srcdoc document inherits
// this policy on top of its own, so 'unsafe-inline'/'unsafe-eval' here are what
// let those frames run their scripts. Removing them means serving those frames
// from their own URL instead of srcdoc.
const POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: http: https:",
  "font-src 'self' data:",
  "media-src 'self' data: blob: http: https:",
  "connect-src 'self' data: blob: http: https: ws: wss:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export const APP_CONTENT_SECURITY_POLICY = POLICY;

/** Adds the policy to HTML documents; other assets pass through untouched. */
export function withAppCsp(response: Response): Response {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/html")) return response;
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", POLICY);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
