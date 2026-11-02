import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { Blocks } from "lucide-react-native";
import { color } from "../../../theme/tokens";
import { T } from "../../Text";
import { Note, Pill, Section } from "../controls";
import { useHostRpc as useRpc } from "./host-state";
import { Block, Item, Status, useFeature } from "./kit";

type Payload = Awaited<ReturnType<DaemonClient["listClaudePlugins"]>>;
type Source = Payload["sources"][number];
type Plugin = Source["plugins"][number];

const load = (c: DaemonClient) => c.listClaudePlugins();

/** Installed Claude Code plugins on this host and which have updates due. */
export function ClaudePlugins() {
  const supported = useFeature("claudePluginUpdates");
  if (supported !== true) return null;
  return <ClaudePluginsBody />;
}

function ClaudePluginsBody() {
  const rpc = useRpc(load);
  const sources = rpc.data?.sources ?? [];
  const many = sources.length > 1;
  return (
    <Status rpc={rpc} what="Claude Code plugins">
      {sources.every((src) => src.plugins.length === 0) ? (
        <Section title="Claude Code plugins">
          <Block last>
            <T>No Claude Code plugins installed on this host.</T>
          </Block>
        </Section>
      ) : (
        sources
          .filter((src) => src.plugins.length > 0)
          .map((src) => <SourceSection key={src.configDir} src={src} named={many} />)
      )}
    </Status>
  );
}

function SourceSection({ src, named }: { src: Source; named: boolean }) {
  const title =
    named && src.accountNames.length
      ? `Claude Code plugins · ${src.accountNames.join(", ")}`
      : "Claude Code plugins";
  const due = src.plugins.filter((p) => p.updateDue);
  const unknown = src.plugins.filter((p) => !p.latestVersion).length;
  return (
    <>
      <Section title={title}>
        {src.plugins.map((p, i) => (
          <PluginItem
            key={`${p.id}:${p.projectPath ?? ""}`}
            p={p}
            last={i === src.plugins.length - 1}
          />
        ))}
      </Section>
      {due.length > 0 && <Note>{dueNote(due)}</Note>}
      {unknown > 0 && (
        <Note>
          {unknown === 1 ? "1 plugin declares" : `${unknown} plugins declare`} no version in its
          marketplace, so updates can’t be detected.
        </Note>
      )}
    </>
  );
}

function PluginItem({ p, last }: { p: Plugin; last: boolean }) {
  const where =
    p.scope === "user" ? p.marketplace : `${p.marketplace} · ${p.projectPath ?? p.scope}`;
  let version = "no version";
  if (p.updateDue) version = `${ver(p.installedVersion)} → ${ver(p.latestVersion)}`;
  else if (p.installedVersion) version = ver(p.installedVersion);
  return (
    <Item icon={Blocks} title={p.name} sub={`${where} · ${version}`} last={last}>
      <StatePill p={p} />
    </Item>
  );
}

function StatePill({ p }: { p: Plugin }) {
  if (p.updateDue)
    return <Pill text={p.autoUpdate ? "update on restart" : "update due"} tint={color.amber} />;
  return p.latestVersion ? <Pill text="up to date" /> : null;
}

/** Semver gets a v; git-sha installs (plugins with no declared version) show as they are. */
const ver = (v: string | null) => (v && /^\d/.test(v) ? `v${v}` : (v ?? ""));

function dueNote(due: Plugin[]): string {
  const auto = due.filter((p) => p.autoUpdate).length;
  if (auto === due.length)
    return "Claude Code installs these updates itself when a Claude agent starts. Restart running Claude agents to pick them up.";
  if (auto === 0)
    return "Their marketplaces don’t auto-update. Run /plugin in Claude Code to update them.";
  return "Plugins marked “update on restart” update when a Claude agent starts; for the rest, run /plugin in Claude Code.";
}
