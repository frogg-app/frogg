// Adds an idle mock session on this checkout, so forge-backed panels (PRs & CI) have real data.
import { WebSocket } from "ws";
import { DaemonClient } from "../../../packages/client/src/daemon-client.ts";

const port = Number(process.argv[2] ?? 7821);
const cwd = process.cwd();
const client = new DaemonClient({
  url: `ws://127.0.0.1:${port}/ws`, clientId: `seed-repo-${Date.now()}`, clientType: "cli",
  webSocketFactory: (url, o) => new WebSocket(url, { headers: o?.headers }) as never,
});
await client.connect();
await client.addProject(cwd);
const agent = await client.createAgent({ provider: "mock", model: "ten-second-stream", modeId: "load-test", cwd, title: "Interface redesign (ui-next)" });
await client.waitForAgentUpsert(agent.id, (s) => s.status === "idle", 30_000);
await client.close();
console.log("seeded", agent.id);
