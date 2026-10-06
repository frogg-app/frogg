import type { CleanCutSummaryModel, MutableCleanCutConfig } from "@frogg/protocol/messages";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { patchConfig, useConfig } from "../../../daemon/config";
import { prefSetter, usePrefs } from "../../../prefs";
import { color } from "../../../theme/tokens";
import { Button } from "../../Button";
import { Select, type Option } from "../../Select";
import { T } from "../../Text";
import { NumField, Pill, Row, Section, Toggle } from "../controls";
import { Acts, Block } from "./kit";

const AUTO = "__auto__";
const MAX_MIN = 30 * 24 * 60;

type Snapshot = NonNullable<ReturnType<typeof useConfig.getState>["providers"]>;

function modelKey(m: CleanCutSummaryModel | undefined): string {
  return m ? `${m.provider}/${m.model}` : AUTO;
}
function parseModel(v: string): CleanCutSummaryModel | null {
  if (v === AUTO) return null;
  const at = v.indexOf("/");
  return { provider: v.slice(0, at), model: v.slice(at + 1) };
}

function useModelOptions(provider?: string): Array<Option<string>> {
  const snap = useConfig((st) => st.providers);
  return useMemo(() => {
    const out: Array<Option<string>> = [
      {
        value: AUTO,
        label: provider ? "Use the global setting" : "Automatic (cheapest on same provider)",
      },
    ];
    for (const e of (snap as Snapshot | null)?.entries ?? []) {
      if (provider && e.provider !== provider) continue;
      for (const m of e.models ?? []) {
        if (m.isSelectable === false) continue;
        out.push({
          value: `${e.provider}/${m.id}`,
          label: provider ? m.label : `${e.provider} · ${m.label}`,
        });
      }
    }
    return out;
  }, [snap, provider]);
}

const setUsage = (v: boolean) => void patchConfig({ cleanCut: { auto: { usageLimit: v } } });
const setRestart = (v: boolean) => void patchConfig({ cleanCut: { auto: { daemonRestart: v } } });
const setIdle = (v: number | null) => void patchConfig({ cleanCut: { idleThresholdMinutes: v } });
const setSummary = (v: string) => void patchConfig({ cleanCut: { summaryModel: parseModel(v) } });

function modelLabel(opts: Array<Option<string>>, m: CleanCutSummaryModel | undefined) {
  if (!m) return null;
  return opts.find((o) => o.value === modelKey(m))?.label ?? m.model;
}

function Override({
  provider,
  settings,
  last,
}: {
  provider: string;
  settings: MutableCleanCutConfig["providers"][string];
  last: boolean;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const options = useModelOptions(provider);
  const setThreshold = useCallback(
    (v: number | null) =>
      void patchConfig({ cleanCut: { providers: { [provider]: { idleThresholdMinutes: v } } } }),
    [provider],
  );
  const setModel = useCallback(
    (v: string) =>
      void patchConfig({
        cleanCut: { providers: { [provider]: { summaryModel: parseModel(v) } } },
      }),
    [provider],
  );
  const remove = useCallback(
    () => void patchConfig({ cleanCut: { providers: { [provider]: null } } }),
    [provider],
  );
  const parts = [
    settings.idleThresholdMinutes ? `Threshold ${settings.idleThresholdMinutes} min` : null,
    modelLabel(options, settings.summaryModel)
      ? `summary ${modelLabel(options, settings.summaryModel)}`
      : null,
  ].filter(Boolean);
  return (
    <>
      <Row
        label={provider}
        hint={parts.length ? parts.join(" · ") : "No overrides"}
        last={last && !open}
      >
        <Button label={open ? "Done" : "Edit"} onPress={toggle} />
      </Row>
      {open ? (
        <Block last={last}>
          <View style={s.edit}>
            <T style={s.lbl}>Idle threshold</T>
            <NumField
              value={settings.idleThresholdMinutes ?? null}
              onChange={setThreshold}
              unit="min"
              min={1}
              max={MAX_MIN}
              placeholder="global"
            />
          </View>
          <View style={s.edit}>
            <T style={s.lbl}>Summary model</T>
            <Select
              value={modelKey(settings.summaryModel)}
              options={options}
              onChange={setModel}
              width={240}
            />
          </View>
          <Acts>
            <Button kind="danger" label="Remove override" onPress={remove} />
          </Acts>
        </Block>
      ) : null}
    </>
  );
}

function AddOverride({ taken }: { taken: string[] }) {
  const snap = useConfig((st) => st.providers);
  const options = useMemo<Array<Option<string>>>(
    () =>
      ((snap as Snapshot | null)?.entries ?? [])
        .filter((e) => !taken.includes(e.provider))
        .map((e) => ({ value: e.provider, label: e.provider })),
    [snap, taken],
  );
  const add = useCallback(
    (p: string) =>
      void patchConfig({ cleanCut: { providers: { [p]: { idleThresholdMinutes: 60 } } } }),
    [],
  );
  return (
    <Row label="Add override" last>
      <Select value={null} options={options} onChange={add} placeholder="Add…" width={160} />
    </Row>
  );
}

export function ContextCleanCut() {
  const cc = useConfig((st) => st.config?.cleanCut);
  const loaded = useConfig((st) => st.config !== null);
  const stale = usePrefs((st) => st.staleCacheWarning);
  const options = useModelOptions();
  const overrides = Object.entries(cc?.providers ?? {});
  const taken = useMemo(() => Object.keys(cc?.providers ?? {}), [cc?.providers]);
  return (
    <>
      <Section title="Clean cut">
        {cc ? (
          <>
            <Row label="Before resuming after a usage limit">
              <Toggle value={cc.auto.usageLimit} onChange={setUsage} />
            </Row>
            <Row label="Before resuming after a restart">
              <Toggle value={cc.auto.daemonRestart} onChange={setRestart} />
            </Row>
            <Row
              label="Idle threshold"
              hint="Empty uses the provider’s cache lifetime (1 h for Claude and Codex)"
            >
              <NumField
                value={cc.idleThresholdMinutes ?? null}
                onChange={setIdle}
                unit="min"
                min={1}
                max={MAX_MIN}
              />
            </Row>
            <Row label="Summary model" last>
              <Select
                value={modelKey(cc.summaryModel)}
                options={options}
                onChange={setSummary}
                width={280}
              />
            </Row>
          </>
        ) : (
          <Row label="Clean cut settings" last>
            <Pill text={loaded ? "needs a newer daemon" : "loading…"} />
          </Row>
        )}
      </Section>
      {cc ? (
        <Section title="Per provider">
          {overrides.map(([prov, set]) => (
            <Override key={prov} provider={prov} settings={set} last={false} />
          ))}
          <AddOverride taken={taken} />
        </Section>
      ) : null}
      <Section title="Stale cache warning">
        <Row
          label="Warn when sending re-bills cached context"
          hint="Shows “Cache expired: sending re-bills N tokens” with a Clean cut button"
          last
        >
          <Toggle value={stale} onChange={prefSetter("staleCacheWarning")} />
        </Row>
      </Section>
    </>
  );
}

const s = StyleSheet.create({
  edit: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  lbl: { width: 120, color: color.muted },
});
