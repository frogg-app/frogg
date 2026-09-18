import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { providerAccountDefaultId } from "@frogg/protocol/provider-accounts";

import type { SessionOutboundMessage } from "../../messages.js";
import { ProviderAccountStore } from "../../provider-accounts/provider-account-store.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { ProviderAccountSession } from "./provider-account-session.js";

describe("ProviderAccountSession", () => {
  let root: string;
  let homeDir: string;
  let store: ProviderAccountStore;
  let emitted: SessionOutboundMessage[];
  let session: ProviderAccountSession;
  let changedCount: number;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "frogg-account-session-"));
    const froggHome = path.join(root, "frogg");
    homeDir = path.join(root, "home");
    mkdirSync(froggHome, { recursive: true });
    mkdirSync(path.join(homeDir, ".claude"), { recursive: true });
    store = new ProviderAccountStore({ froggHome, homeDir });
    emitted = [];
    changedCount = 0;
    session = new ProviderAccountSession({
      host: {
        emit: (msg) => emitted.push(msg),
        onProviderAccountsChanged: () => {
          changedCount += 1;
        },
      },
      store,
      logger: createTestLogger(),
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function createSignedInAccount(name: string) {
    const account = store
      .create({ provider: "claude", name, linkedFolders: [] })
      .accounts.find((candidate) => candidate.name === name)!;
    writeFileSync(path.join(account.configDir, ".credentials.json"), '{"token":"secret"}');
    return account;
  }

  it("renames an account without moving its config directory", async () => {
    const account = createSignedInAccount("peter");

    await session.handleProviderAccountRenameRequest({
      type: "provider.account.rename.request",
      accountId: account.id,
      name: "Work laptop",
      requestId: "req-1",
    });

    const response = emitted.at(-1);
    expect(response?.type).toBe("provider.account.rename.response");
    const payload = (response as { payload: { accounts: { id: string }[]; error: string | null } })
      .payload;
    expect(payload.error).toBeNull();
    const updated = store.findAccount(account.id)!;
    expect(updated.name).toBe("Work laptop");
    expect(updated.configDir).toBe(account.configDir);
    expect(changedCount).toBe(1);
  });

  it("renames the implicit default account and keeps the primary directory", async () => {
    await session.handleProviderAccountRenameRequest({
      type: "provider.account.rename.request",
      accountId: providerAccountDefaultId("claude"),
      name: "Personal",
      requestId: "req-2",
    });

    const stored = store.findAccount(providerAccountDefaultId("claude"))!;
    expect(stored.name).toBe("Personal");
    expect(stored.configDir).toBe(path.join(homeDir, ".claude"));
  });

  it("returns an error payload, not a throw, for a rejected sign-out", async () => {
    const account = store
      .create({ provider: "claude", name: "peter", linkedFolders: [] })
      .accounts.find((candidate) => candidate.name === "peter")!;

    await session.handleProviderAccountSignOutRequest({
      type: "provider.account.sign_out.request",
      accountId: account.id,
      requestId: "req-3",
    });

    const payload = (emitted.at(-1) as { payload: { error: string | null } }).payload;
    expect(payload.error).toMatch(/not signed in/);
  });

  it("exports a bundle over the session and imports it back on another daemon", async () => {
    const account = createSignedInAccount("peter");

    await session.handleProviderAccountExportRequest({
      type: "provider.account.export.request",
      provider: "claude",
      requestId: "req-4",
    });

    const exportResponse = emitted.at(-1) as {
      type: string;
      payload: { bundle: { provider: string; accounts: unknown[] } | null; error: string | null };
    };
    expect(exportResponse.type).toBe("provider.account.export.response");
    expect(exportResponse.payload.error).toBeNull();
    const bundle = exportResponse.payload.bundle!;
    expect(bundle.provider).toBe("claude");
    expect(bundle.accounts).toHaveLength(1);

    // Importing into the same daemon collides and must be refused outright.
    await session.handleProviderAccountImportRequest({
      type: "provider.account.import.request",
      bundle: bundle as never,
      requestId: "req-5",
    });
    const importPayload = (emitted.at(-1) as { payload: { error: string | null } }).payload;
    expect(importPayload.error).toMatch(/already exists/);
    // The original credential file was left untouched by the refused import.
    expect(store.list("claude").find((c) => c.id === account.id)?.authenticated).toBe(true);
  });

  it("reports an export error without a bundle", async () => {
    await session.handleProviderAccountExportRequest({
      type: "provider.account.export.request",
      provider: "claude",
      requestId: "req-6",
    });

    const payload = (emitted.at(-1) as { payload: { bundle: unknown; error: string | null } })
      .payload;
    expect(payload.bundle).toBeNull();
    expect(payload.error).toMatch(/no accounts to export/);
  });

  it("sets and clears per-account model restrictions", async () => {
    const account = createSignedInAccount("peter");

    await session.handleProviderAccountSetAllowedModelsRequest({
      type: "provider.account.set_allowed_models.request",
      accountId: account.id,
      allowedModels: ["opus"],
      requestId: "req-7",
    });
    expect(store.allowedModelsFor("claude", account.id)).toEqual(["opus"]);

    await session.handleProviderAccountSetAllowedModelsRequest({
      type: "provider.account.set_allowed_models.request",
      accountId: account.id,
      allowedModels: null,
      requestId: "req-8",
    });
    expect(store.allowedModelsFor("claude", account.id)).toBeUndefined();
  });
});
