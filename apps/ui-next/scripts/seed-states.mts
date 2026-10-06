// Adds mock sessions in every list state (needs you, failed, working, review) to the preview daemon.
// Usage: node --import tsx apps/ui-next/scripts/seed-states.mts [daemonPort]
import { readFileSync } from "node:fs";
import { WebSocket } from "ws";
import { DaemonClient } from "../../../packages/client/src/daemon-client.ts";

const port = Number(process.argv[2] ?? 7821);
const state = JSON.parse(readFileSync(".dev/preview/state.json", "utf8")) as {
  repo: string;
  workspaceId: string;
};
const client = new DaemonClient({
  url: `ws://127.0.0.1:${port}/ws`,
  clientId: `seed-states-${Date.now()}`,
  clientType: "cli",
  webSocketFactory: (url, o) => new WebSocket(url, { headers: o?.headers }) as never,
});
await client.connect();

const make = async (title: string, prompt: string | null) => {
  const agent = await client.createAgent({
    provider: "mock",
    model: "ten-second-stream",
    modeId: "load-test",
    cwd: state.repo,
    workspaceId: state.workspaceId,
    title,
  });
  await client.waitForAgentUpsert(agent.id, (s) => s.status === "idle", 30_000);
  if (prompt) await client.sendMessage(agent.id, prompt);
  return agent.id;
};

await make("Invoice PDF renderer", "Emit a synthetic plan approval for the PDF renderer.");
await make("Stripe webhook retries", "Emit a synthetic turn failure.");
await make("Translate settings strings (9 locales)", "Translate the settings strings.");
await make("Session store persistence refactor", "Refactor the session store to persist drafts.");
await client.close();
console.log("seeded");
