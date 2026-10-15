import { describe, expect, test } from "vitest";
import { retiredRequestError } from "./retired-requests.js";

describe("retiredRequestError", () => {
  test("names the retired beta channel RPCs", () => {
    expect(retiredRequestError("daemon.beta_channel.install.request")).toMatch(
      /no longer supported/,
    );
    expect(retiredRequestError("daemon.beta_channel.start.request")).toMatch(/no longer supported/);
  });

  test("leaves other request types to the generic unknown-schema reply", () => {
    expect(retiredRequestError("daemon.update.start.request")).toBeNull();
    expect(retiredRequestError(undefined)).toBeNull();
  });
});
