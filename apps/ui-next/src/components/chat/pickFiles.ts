import type { Picked } from "./actions";

/** Native has no document or image picker module in this build; the attach menu says so. */
export const canPickFiles = false;

export async function pickFiles(_opts: { images?: boolean }): Promise<Picked[]> {
  return [];
}
