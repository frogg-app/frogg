import { describe, expect, test } from "vitest";

import { redactText, redactionTotal } from "./redact.js";

describe("bug report redaction", () => {
  test.each([
    ["Anthropic key", "key sk-ant-api03-abcdefghijklmnopqrstuvwx"],
    ["OpenAI key", "OPENAI sk-proj-AbCdEfGhIjKlMnOpQrStUv"],
    ["GitHub token", "push with ghp_abcdefghijklmnopqrstuvwxyz0123"],
    ["fine-grained GitHub PAT", "github_pat_11ABCDEFG0123456789_abcdefghijk"],
    ["Slack token", "xoxb-1234567890-abcdefghij"],
    ["AWS key id", "AKIAABCDEFGHIJKLMNOP"],
    ["Tailscale auth key", "tskey-auth-kAbCdEf1CNTRL-xyz"],
    ["JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N"],
  ])("removes a %s", (_label, input) => {
    const out = redactText(input);
    expect(out.text).toContain("[REDACTED_SECRET]");
    expect(out.counts.secret).toBe(1);
  });

  test("removes secrets in assignments, headers and URLs", () => {
    const out = redactText(
      [
        "export API_KEY=abcdef123456",
        '{"password": "hunter22hunter"}',
        "Authorization: Bearer abc.def.ghijklmnop",
        "git clone https://bob:s3cret@git.example.com/r.git",
      ].join("\n"),
    );
    expect(out.text).not.toMatch(/abcdef123456|hunter22hunter|abc\.def\.ghijklmnop|s3cret|bob:/);
    expect(out.counts.secret).toBe(4);
  });

  test("removes a private key block", () => {
    const out = redactText(
      "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\nBBBB\n-----END OPENSSH PRIVATE KEY-----",
    );
    expect(out.text).toBe("[REDACTED_SECRET]");
  });

  test("removes emails, IPs and tailnet names but keeps loopback", () => {
    const out = redactText(
      "mail jo@example.com, host 100.101.102.103 or laptop.tail1234.ts.net, bind 127.0.0.1:9999",
    );
    expect(out.text).toBe(
      "mail [REDACTED_EMAIL], host [REDACTED_IP] or [REDACTED_HOST], bind 127.0.0.1:9999",
    );
    expect(out.counts).toMatchObject({ email: 1, ip: 1, host: 1 });
  });

  test("shortens home paths on every OS", () => {
    const out = redactText(
      "read /home/alice/src/app.ts and /Users/alice/x and C:\\Users\\alice\\proj\\a.ts",
    );
    expect(out.text).toBe("read ~/src/app.ts and ~/x and ~\\proj\\a.ts");
    expect(out.counts.path).toBe(3);
  });

  test("uses known home dirs and user names", () => {
    const out = redactText("cwd /srv/agents/alice/work, home /data/alice-home/x", {
      homeDirs: ["/data/alice-home/"],
      userNames: ["alice"],
    });
    expect(out.text).toBe("cwd /srv/agents/<user>/work, home ~/x");
  });

  test("leaves ordinary chat alone", () => {
    const input = "Refactor the token counter so max tokens: 4096 is respected in src/app.ts";
    const out = redactText(input);
    expect(out.text).toBe(input);
    expect(redactionTotal(out)).toBe(0);
  });
});
