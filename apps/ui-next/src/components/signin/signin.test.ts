import { describe, expect, it } from "vitest";
import { authProblem } from "./auth-error";
import { parseLogin, stripAnsi } from "./login-flow";

describe("authProblem", () => {
  it("spots an expired Claude OAuth session", () => {
    expect(
      authProblem(
        "Claude Code Failed to authenticate: OAuth session expired and could not be refreshed",
      ),
    ).toEqual({ provider: "claude", account: null });
  });

  it("reads the account and provider from the daemon's not-signed-in error", () => {
    expect(authProblem('Account "work" is not signed in to provider "claude".')).toEqual({
      provider: "claude",
      account: "work",
    });
  });

  it("spots the CLI's own sign-in prompts", () => {
    expect(authProblem("Invalid API key · Please run /login")).not.toBeNull();
    expect(authProblem("Not logged in. Run `codex login` first.")?.provider).toBe("codex");
  });

  it("ignores unrelated failures", () => {
    expect(authProblem("Process exited with code 1")).toBeNull();
    expect(authProblem("Rate limit reached, resets at 5pm")).toBeNull();
    expect(authProblem(null)).toBeNull();
  });
});

// Captured from `claude auth login` and `codex login --device-auth` in a PTY.
const CLAUDE =
  "Opening browser to sign in…\r\nIf the browser didn't open, visit: \x1b]8;;https://claude.com/cai/oauth/authorize?code=true&state=abc\x07https://claude.com/cai/oauth/authorize?code=true&state=abc\x1b]8;;\x07\r\nPaste code here if prompted > ";
const CODEX =
  "Welcome to Codex [v\x1b[90m0.166.0\x1b[0m]\r\n\r\n1. Open this link in your browser and sign in to your account\r\n   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\r\n\r\n2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m\r\n   \x1b[94mUF2B-VB2DZ\x1b[0m\r\n";

describe("parseLogin", () => {
  it("strips hyperlinks and colours to visible text", () => {
    expect(stripAnsi("\x1b]8;;https://x\x07link\x1b]8;;\x07 \x1b[94mblue\x1b[0m")).toBe(
      "link blue",
    );
  });

  it("reads Claude's authorize URL and code prompt", () => {
    expect(parseLogin(CLAUDE)).toEqual({
      url: "https://claude.com/cai/oauth/authorize?code=true&state=abc",
      userCode: null,
      wantsCode: true,
      done: false,
      error: null,
    });
  });

  it("reads Codex's device URL and one-time code", () => {
    const st = parseLogin(CODEX);
    expect(st.url).toBe("https://auth.openai.com/codex/device");
    expect(st.userCode).toBe("UF2B-VB2DZ");
    expect(st.wantsCode).toBe(false);
  });

  it("finishes on success and reports a failure line", () => {
    expect(parseLogin(`${CLAUDE}abc#def\r\nLogin successful.\r\n`)).toMatchObject({
      done: true,
      wantsCode: false,
    });
    const failed = parseLogin(`${CLAUDE}\r\nLogin failed: That code wasn't accepted.\r\n`);
    expect(failed.error).toBe("Login failed: That code wasn't accepted.");
    expect(failed.wantsCode).toBe(false);
  });
});
