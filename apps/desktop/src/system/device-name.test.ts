import { describe, expect, it } from "vitest";
import { deviceNameArgument, resolveDesktopDeviceName } from "./device-name";

describe("resolveDesktopDeviceName", () => {
  const username = () => "paz";
  const hostname = () => "frogg-vm.local";

  it("prefers the username on Windows and macOS", () => {
    expect(resolveDesktopDeviceName({ platform: "win32", username, hostname })).toBe("paz");
    expect(resolveDesktopDeviceName({ platform: "darwin", username, hostname })).toBe("paz");
  });

  it("uses the hostname on Linux", () => {
    expect(resolveDesktopDeviceName({ platform: "linux", username, hostname })).toBe("frogg-vm");
  });

  it("falls back to the hostname when the username is unavailable", () => {
    const throwing = () => {
      throw new Error("no user");
    };
    expect(resolveDesktopDeviceName({ platform: "win32", username: throwing, hostname })).toBe(
      "frogg-vm",
    );
  });

  it("encodes the argv flag", () => {
    expect(deviceNameArgument("paz")).toBe("--frogg-device-name=paz");
  });
});
