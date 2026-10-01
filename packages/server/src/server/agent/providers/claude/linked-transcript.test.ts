import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { TranscriptFollower, TurnLease } from "./linked-transcript.js";

let dir: string;
let transcript: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "linked-transcript-"));
  transcript = path.join(dir, "session.jsonl");
  writeFileSync(transcript, '{"uuid":"a"}\n');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function follower(busy: { value: boolean }) {
  const onForeignLines = vi.fn();
  const instance = new TranscriptFollower({
    resolvePath: () => transcript,
    isBusy: () => busy.value,
    onForeignLines,
    logger: createTestLogger(),
  });
  instance.skipToEnd();
  return { instance, onForeignLines };
}

describe("TranscriptFollower", () => {
  test("reports lines another process appends while this session is idle", () => {
    const { instance, onForeignLines } = follower({ value: false });
    appendFileSync(transcript, '{"uuid":"b"}\n{"uuid":"c"}\n');

    instance.poll();

    expect(onForeignLines).toHaveBeenCalledWith(['{"uuid":"b"}', '{"uuid":"c"}']);
    instance.poll();
    expect(onForeignLines).toHaveBeenCalledTimes(1);
  });

  test("waits for a partly written line to be finished", () => {
    const { instance, onForeignLines } = follower({ value: false });
    appendFileSync(transcript, '{"uuid":"b"}\n{"uu');
    instance.poll();
    expect(onForeignLines).toHaveBeenLastCalledWith(['{"uuid":"b"}']);

    appendFileSync(transcript, 'id":"c"}\n');
    instance.poll();
    expect(onForeignLines).toHaveBeenLastCalledWith(['{"uuid":"c"}']);
  });

  test("skips what this session wrote during its own turn", () => {
    const busy = { value: true };
    const { instance, onForeignLines } = follower(busy);
    appendFileSync(transcript, '{"uuid":"mine"}\n');
    instance.poll();
    busy.value = false;
    instance.skipToEnd();
    instance.poll();

    expect(onForeignLines).not.toHaveBeenCalled();
  });

  test("a forced poll reads even while busy", () => {
    const { instance, onForeignLines } = follower({ value: true });
    appendFileSync(transcript, '{"uuid":"theirs"}\n');
    instance.poll(true);
    expect(onForeignLines).toHaveBeenCalledWith(['{"uuid":"theirs"}']);
  });
});

describe("TurnLease", () => {
  function lease(label: string, isProcessAlive: (pid: number) => boolean = () => true) {
    return new TurnLease({
      resolvePath: () => `${transcript}.frogg-turn`,
      label,
      logger: createTestLogger(),
      isProcessAlive,
    });
  }

  test("one process runs a turn at a time, and the other sees who", () => {
    const stable = lease("frogg-dev");
    const dev = lease("frogg-dev-DEVELOPMENT");

    expect(stable.tryAcquire()).toBe(true);
    expect(dev.tryAcquire()).toBe(false);
    expect(dev.heldElsewhere()).toEqual({ label: "frogg-dev" });

    stable.release();
    expect(existsSync(`${transcript}.frogg-turn`)).toBe(false);
    expect(dev.tryAcquire()).toBe(true);
    dev.release();
  });

  test("a lease left by a dead process does not block", () => {
    const crashed = lease("crashed");
    expect(crashed.tryAcquire()).toBe(true);

    const next = lease("next", () => false);
    expect(next.tryAcquire()).toBe(true);
    next.release();
  });

  test("acquire waits for the holder and gives up when cancelled", async () => {
    const holder = lease("holder");
    holder.tryAcquire();
    const waiter = lease("waiter");
    const onWaiting = vi.fn();
    let cancelled = false;

    const pending = waiter.acquire({ isCancelled: () => cancelled, onWaiting });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onWaiting).toHaveBeenCalledWith({ label: "holder" });
    holder.release();
    expect(await pending).toBe(true);
    waiter.release();

    holder.tryAcquire();
    const cancelledWait = waiter.acquire({ isCancelled: () => cancelled });
    cancelled = true;
    expect(await cancelledWait).toBe(false);
    holder.release();
  });
});
