import { useCallback, useState } from "react";
import { Linking, Platform } from "react-native";
import { version } from "../../../../package.json";
import { useDaemon } from "../../../daemon/store";
import { useUi } from "../../../ui-store";
import { Button } from "../../Button";
import { T } from "../../Text";
import { Row, Section } from "../controls";
import { need } from "./hostkit";
import { Block, ErrorLine, Value, useAction } from "./kit";

const providers = () => useUi.getState().openSettings("providers");
export function About() {
  const host = useDaemon((s) => s.serverName);
  const conn = useDaemon((s) => s.conn);
  const [report, setReport] = useState<string | null>(null);
  const act = useAction();
  const run = useCallback(() => {
    void act.run("diagnostic", async () => {
      const r = await need().collectDiagnostics();
      setReport(r.diagnostic);
    });
  }, [act]);
  const licenses = useCallback(() => {
    void act.run("licenses", () =>
      Linking.openURL("https://github.com/frogg-app/fde/blob/main/NOTICE"),
    );
  }, [act]);
  return (
    <>
      <Section title="About">
        <Row label="Frogg Next" hint={`${version} · ${Platform.OS}`}>
          <Value>Prototype client</Value>
        </Row>
        <Row label="Connected host" hint={host ?? "No host connected"} />
        <Row label="Licenses" last>
          <Button label="View notices" onPress={licenses} />
        </Row>
      </Section>
      <Section title="Diagnostics">
        <Row label="Host diagnostic" hint="Daemon, providers and runtime details">
          <Button
            label={act.pending === "diagnostic" ? "Running…" : "Run"}
            kind="primary"
            onPress={run}
            disabled={conn !== "online" || !!act.pending}
          />
        </Row>
        <Row label="Provider diagnostics" last>
          <Button label="Open Providers" onPress={providers} />
        </Row>
      </Section>
      <ErrorLine text={act.error} />
      {report && (
        <Section title="Diagnostic report">
          <Block last>
            <T v="mono" selectable>
              {report}
            </T>
          </Block>
        </Section>
      )}
    </>
  );
}
