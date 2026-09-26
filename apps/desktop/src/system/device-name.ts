import os from "node:os";

export const DEVICE_NAME_ARGUMENT_PREFIX = "--frogg-device-name=";
const DEVICE_NAME_MAX_LENGTH = 60;

/**
 * What other clients on a shared daemon see this desktop as. Windows and macOS
 * prefer the signed-in user's name; Linux (and any failure) falls back to the
 * hostname, which is what a Linux desktop is usually known by.
 */
export function resolveDesktopDeviceName(
  input: {
    platform?: NodeJS.Platform;
    username?: () => string;
    hostname?: () => string;
  } = {},
): string {
  const platform = input.platform ?? process.platform;
  const username = input.username ?? (() => os.userInfo().username);
  const hostname = input.hostname ?? (() => os.hostname());
  if (platform === "win32" || platform === "darwin") {
    const user = safe(username);
    if (user) return user;
  }
  return safe(hostname).replace(/\.local$/i, "");
}

export function deviceNameArgument(name: string = resolveDesktopDeviceName()): string {
  return `${DEVICE_NAME_ARGUMENT_PREFIX}${name}`;
}

function safe(read: () => string): string {
  try {
    return read().trim().slice(0, DEVICE_NAME_MAX_LENGTH);
  } catch {
    return "";
  }
}
