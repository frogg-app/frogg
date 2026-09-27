// Fill the design review's demo chats so every direction has a real conversation to show:
// the first chat gets two finished turns, the second one finished turn plus a long-running turn
// that keeps the working indicator on screen. Agent ids come from the preview's seed state,
// whose home the review daemon copies.
import { readFile } from "node:fs/promises";
import { connectSeedClient } from "../../apps/ui/e2e/support/helpers/seed-client.ts";

export async function seedDesignReviewChats(input: { port: number; statePath: string }) {
  const state = JSON.parse(await readFile(input.statePath, "utf8")) as {
    agents: { id: string }[];
  };
  const client = (await connectSeedClient({
    port: input.port,
    projectOwnership: "host",
  })) as Awaited<ReturnType<typeof connectSeedClient>> & {
    setAgentModel(agentId: string, model: string): Promise<void>;
  };
  const [chat, chat2] = state.agents;
  if (!chat || !chat2) throw new Error("preview seed state has fewer than two chats");
  try {
    for (const agent of [chat, chat2]) {
      await client.setAgentModel(agent.id, "e2e-fast-stream");
      await client.sendAgentMessage(
        agent.id,
        "Refactor the settings loader so it reads config once, and explain the change briefly.",
      );
      await client.waitForFinish(agent.id, 60_000);
    }
    await client.sendAgentMessage(chat.id, "Now add a test for the empty config case.");
    await client.waitForFinish(chat.id, 60_000);
    await client.setAgentModel(chat2.id, "thirty-minute-stream");
    await client.sendAgentMessage(chat2.id, "Keep going and run the whole suite.");
  } finally {
    await client.close().catch(() => undefined);
  }
}
