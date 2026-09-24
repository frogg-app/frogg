import { describe, expect, it } from "vitest";
import { APP_CONTENT_SECURITY_POLICY, withAppCsp } from "./app-csp.js";

describe("withAppCsp", () => {
  it("adds the policy to HTML documents", () => {
    const response = withAppCsp(
      new Response("<!doctype html>", { headers: { "content-type": "text/html" } }),
    );
    expect(response.headers.get("content-security-policy")).toBe(APP_CONTENT_SECURITY_POLICY);
  });

  it("leaves other assets alone", () => {
    const response = withAppCsp(
      new Response("x", { headers: { "content-type": "application/javascript" } }),
    );
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it("refuses remote scripts, plugins and framing", () => {
    const script = APP_CONTENT_SECURITY_POLICY.split("; ").find((d) => d.startsWith("script-src"));
    expect(script).not.toMatch(/https?:|\*/);
    expect(APP_CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(APP_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
  });
});
