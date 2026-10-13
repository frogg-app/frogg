// Multi-account usage fixture for screenshots. The preview daemon has one sign-in per
// provider, so this swaps the connected client's account and usage reads for a host with
// two Claude and two Codex accounts (one signed out), then reloads the usage store.
// Usage from a Playwright script: await require("./usage-fixture.cjs").apply(page)
async function apply(page) {
  await page.evaluate(() => {
    const mod = (suffix) =>
      __r([...__r.getModules()].find(([, m]) => m.verboseName?.endsWith(suffix))[0]);
    const client = mod("src/daemon/store.ts").getClient();
    if (!client || client.__usageFixture) return;
    client.__usageFixture = true;
    const at = (mins) => new Date(Date.now() + mins * 60000).toISOString();
    const now = new Date().toISOString();
    const win = (id, label, usedPct, resetMins) => ({
      id,
      label,
      usedPct,
      resetsAt: at(resetMins),
    });
    const acct = (id, provider, name, isActive, authenticated, color) => ({
      id,
      provider,
      name,
      configDir: id.startsWith("default:")
        ? `~/.${provider}`
        : `~/.frogg/accounts/${provider}-${name}`,
      linkedFolders: [],
      createdAt: now,
      authenticated,
      isActive,
      ...(color ? { preferences: { color } } : {}),
    });
    const accounts = [
      acct("default:claude", "claude", "work", true, true, "sky"),
      acct("claude-personal", "claude", "personal", false, true, "violet"),
      acct("default:codex", "codex", "default", true, true, "emerald"),
      acct("codex-acme", "codex", "acme", false, false, "orange"),
    ];
    const base = (providerId, displayName, extra) => ({
      providerId,
      displayName,
      status: "available",
      planLabel: null,
      fetchedAt: now,
      windows: [],
      balances: [],
      details: [],
      error: null,
      ...extra,
    });
    const usage = {
      "claude:default:claude": base("claude", "Claude", {
        planLabel: "Max 20x",
        accountEmail: "steve@work.example",
        windows: [
          win("five_hour", "Session", 42, 72),
          win("weekly", "Weekly", 86, 3 * 1440),
          win("weekly_model_opus", "Opus weekly", 71, 3 * 1440),
        ],
      }),
      "claude:claude-personal": base("claude", "Claude", {
        planLabel: "Pro",
        accountEmail: "steve@home.example",
        fetchedAt: new Date(Date.now() - 40 * 60000).toISOString(),
        windows: [win("five_hour", "Session", 8, 190), win("weekly", "Weekly", 31, 5 * 1440)],
      }),
      "codex:default:codex": base("codex", "Codex", {
        planLabel: "plus",
        accountEmail: "steve@openai.example",
        windows: [win("session", "Session", 63, 140), win("weekly", "Weekly", 54, 4 * 1440)],
        balances: [{ id: "credits", label: "Credits", remaining: 0, unit: "usd" }],
      }),
      "codex:codex-acme": base("codex", "Codex", { status: "unavailable" }),
      copilot: base("copilot", "GitHub Copilot", {
        planLabel: "individual",
        accountEmail: "stevehughes",
        windows: [win("premium", "Premium requests", 23, 12 * 1440)],
      }),
    };
    const unavailable = ["cursor", "zai", "grok", "kimi", "minimax"].map((id) =>
      base(id, { zai: "Z.ai", minimax: "MiniMax" }[id] ?? id[0].toUpperCase() + id.slice(1), {
        status: "unavailable",
      }),
    );
    const info = client.getLastServerInfoMessage();
    client.getLastServerInfoMessage = () => ({
      ...info,
      features: { ...info?.features, providerAccounts: true, providerUsageAccountScoped: true },
    });
    client.listProviderAccounts = async () => ({
      requestId: "fixture",
      accounts,
      capabilities: [],
      activeAccountIds: {},
      error: null,
    });
    client.listProviderUsage = async (o = {}) => {
      const scoped = (p) =>
        o.provider === p ? usage[`${p}:${o.providerAccountId}`] : usage[`${p}:default:${p}`];
      return {
        requestId: "fixture",
        fetchedAt: now,
        providers: [scoped("claude"), scoped("codex"), usage.copilot, ...unavailable],
      };
    };
    void mod("src/daemon/usage.ts").loadUsage();
  });
  await page.waitForTimeout(500);
}
module.exports = { apply };
