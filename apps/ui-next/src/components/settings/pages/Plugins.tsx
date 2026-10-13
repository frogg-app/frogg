import { HostPage } from "./host-state";
import { useHostRpc as useRpc } from "./host-state";
import { useHostAction as useAction } from "./host-state";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { Puzzle } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { refreshPlugins, usePlugins, useWatchPlugins } from "../../../daemon/plugins";
import { useUi } from "../../../ui-store";
import { Select } from "../../Select";
import { Button } from "../../Button";
import { T } from "../../Text";
import { Row, Section, Toggle } from "../controls";
import { need } from "./hostkit";
import { Banner, Block, ErrorLine, Field, Status, useFeature } from "./kit";

type Settings = Awaited<ReturnType<DaemonClient["pluginsSettingsGet"]>>;
type Setting = Settings["fields"][number];
const openPlugins = () => useUi.getState().setTool("plugins");

export function Plugins() {
  return <HostPage body={PageBody} />;
}
function PageBody() {
  const supported = useFeature("plugins");
  // The shared list, kept live by plugins.changed: installs elsewhere show here at once.
  useWatchPlugins("installed", supported === true);
  const installed = usePlugins((s) => s.installed);
  const error = usePlugins((s) => s.errors.installed ?? null);
  const reload = useCallback(() => void refreshPlugins("installed"), []);
  const rpc = useMemo(
    () => ({ data: installed, error, loading: installed === null && !error, reload }),
    [installed, error, reload],
  );
  return (
    <>
      <Banner
        icon={Puzzle}
        title="Manage plugins in the Plugins tool"
        body="Install, update, sources and permissions live in the rail. Settings for each installed plugin are listed here too."
      >
        <Button label="Open Plugins" onPress={openPlugins} />
      </Banner>
      {supported === false ? (
        <T>Update this daemon to manage plugins.</T>
      ) : (
        <Status rpc={rpc} what="plugins">
          {rpc.data?.length === 0 && (
            <Section title="Installed plugins">
              <Block last>
                <T>No plugins installed on this host.</T>
              </Block>
            </Section>
          )}
          {rpc.data?.map((p) => (
            <PluginSettings key={p.id} id={p.id} name={p.name} />
          ))}
        </Status>
      )}
    </>
  );
}
function PluginSettings({ id, name }: { id: string; name: string }) {
  const loadSettings = useCallback((c: DaemonClient) => c.pluginsSettingsGet(id), [id]);
  const rpc = useRpc(loadSettings);
  // Settings saved elsewhere (another client, the plugin itself) reload the form.
  const rev = usePlugins((s) => s.settingsRev[id] ?? 0);
  const seen = useRef(rev);
  const { reload } = rpc;
  useEffect(() => {
    if (seen.current === rev) return;
    seen.current = rev;
    reload();
  }, [rev, reload]);
  return (
    <Section title={name}>
      <Status rpc={rpc} what={`${name} settings`}>
        {rpc.data && (
          <PluginForm key={JSON.stringify(rpc.data)} id={id} data={rpc.data} reload={rpc.reload} />
        )}
      </Status>
    </Section>
  );
}
function PluginForm({ id, data, reload }: { id: string; data: Settings; reload: () => void }) {
  // Send only touched keys. In particular, an untouched redacted secret must never be cleared.
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const act = useAction();
  const change = useCallback(
    (key: string, value: unknown) => setDraft((d) => ({ ...d, [key]: value })),
    [],
  );
  const save = useCallback(() => {
    void act
      .run("save", async () => {
        const values = { ...draft };
        for (const field of data.fields) {
          if (field.type === "number" && Object.hasOwn(values, field.key))
            values[field.key] = Number(values[field.key]);
        }
        const r = await need().pluginsSettingsSet(id, values);
        if (!r.success) throw new Error("Plugin settings were not saved");
      })
      .then((ok) => ok && reload());
  }, [act, id, draft, reload, data.fields]);
  const invalid = data.fields.some((f) => {
    const value = Object.hasOwn(draft, f.key) ? draft[f.key] : (data.values[f.key] ?? f.default);
    if (
      f.type === "number" &&
      Object.hasOwn(draft, f.key) &&
      (!String(value ?? "").trim() || !Number.isFinite(Number(value)))
    )
      return true;
    if (f.required && (value === undefined || value === null || value === ""))
      return !(
        f.type === "secret" &&
        Object.hasOwn(data.values, f.key) &&
        !Object.hasOwn(draft, f.key)
      );
    return false;
  });
  return (
    <>
      {data.fields.map((f) => (
        <SettingRow
          key={f.key}
          field={f}
          value={Object.hasOwn(draft, f.key) ? draft[f.key] : (data.values[f.key] ?? f.default)}
          secretSet={Object.hasOwn(data.values, f.key)}
          onChange={change}
        />
      ))}
      <Block last>
        {data.fields.length ? (
          <Button
            label={act.pending ? "Saving…" : "Save"}
            kind="primary"
            onPress={save}
            disabled={!!act.pending || !Object.keys(draft).length || invalid}
          />
        ) : (
          <T>This plugin has no settings.</T>
        )}
        <ErrorLine text={act.error} />
        {invalid && <T>Complete required fields and enter valid numbers.</T>}
      </Block>
    </>
  );
}
function SettingRow({
  field,
  value,
  secretSet,
  onChange,
}: {
  field: Setting;
  value: unknown;
  secretSet: boolean;
  onChange: (key: string, value: unknown) => void;
}) {
  const change = useCallback(
    (v: string | boolean) => {
      onChange(field.key, v);
    },
    [field, onChange],
  );
  const options = useMemo(
    () => (field.options ?? []).map((o) => ({ value: o.value, label: o.label })),
    [field.options],
  );
  let control;
  if (field.type === "boolean") control = <Toggle value={value === true} onChange={change} />;
  else if (field.type === "select")
    control = (
      <Select
        options={options}
        value={String(value ?? "")}
        onChange={change}
        width={200}
        label={field.title}
      />
    );
  else
    control = (
      <Field
        value={String(value ?? "")}
        onChangeText={change}
        secureTextEntry={field.type === "secret"}
        placeholder={
          field.type === "secret" && secretSet ? "Saved · enter to replace" : field.title
        }
        accessibilityLabel={field.title}
      />
    );
  return (
    <Row label={field.title} hint={field.description}>
      {control}
    </Row>
  );
}
