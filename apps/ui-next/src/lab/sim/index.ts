// Simulated daemon RPCs for the lab, merged into the fixture client in ../client.ts.
import { useFiles } from "../../daemon/files";
import { makeListProviderSubagents, resetSubagents } from "./agents";
import * as files from "./fs";
import { miscRpcs, setLabEmitter } from "./misc";
import { checkoutStreamsGetGraph } from "./streams";

type Emit = (event: unknown) => void;
type Rpcs = Record<string, (...args: never[]) => unknown>;

/** Every simulated RPC, keyed by daemon-client method name. `emit` pushes daemon events. */
const raw = new Set<Emit>();
/** Sends a raw session message (subagent upserts, terminal output) to `subscribeRawMessages`. */
export const emitRaw: Emit = (m) => {
  for (const fn of raw) fn(m);
};

export function simulatedRpcs(emit: Emit): Rpcs {
  // Misc pushes go to both channels: typed events (subscribe) and raw session messages.
  setLabEmitter((m: unknown) => {
    emit(m);
    emitRaw(m);
  });
  return {
    ...miscRpcs,
    supportsPlugins: () => true,
    subscribeRawMessages: (fn: Emit) => {
      raw.add(fn);
      return () => raw.delete(fn);
    },
    listDirectory: files.listDirectory,
    readFile: files.readFile,
    writeFile: files.writeFile,
    createFileEntry: files.createFileEntry,
    renameFileEntry: files.renameFileEntry,
    duplicateFileEntry: files.duplicateFileEntry,
    deleteFileEntry: files.deleteFileEntry,
    uploadFile: files.uploadFile,
    subscribeCheckoutDiff: async () => ({ files: files.labDiff(), error: null }),
    checkoutStreamsGetGraph,
    listProviderSubagents: makeListProviderSubagents(emitRaw),
  } as Rpcs;
}

/** Back to pristine simulated state (every lab reseed). */
export function resetSim(): void {
  files.resetLabFs();
  useFiles.setState({ root: null, dirs: {}, expanded: { ".": true } });
  resetSubagents();
}
