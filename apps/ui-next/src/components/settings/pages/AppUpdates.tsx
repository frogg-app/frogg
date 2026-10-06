import { useCallback } from "react";
import { Linking, Platform } from "react-native";
import { version } from "../../../../package.json";
import { useDaemon } from "../../../daemon/store";
import { useUi } from "../../../ui-store";
import { Button } from "../../Button";
import { Row, Section } from "../controls";
import { ErrorLine, Value, useAction } from "./kit";

const daemonSettings = () => useUi.getState().openSettings("daemon");
/** This prototype has no desktop updater bridge; never claim an update check ran. */
export function AppUpdates() {
  const host = useDaemon((s) => s.serverName);
  const conn = useDaemon((s) => s.conn);
  const act = useAction();
  const releases = useCallback(() => {
    void act.run("releases", () => Linking.openURL("https://github.com/frogg-app/fde/releases"));
  }, [act]);
  return (
    <>
      <Section title="Frogg Next">
        <Row label="Version" hint={Platform.OS}>
          <Value>{version}</Value>
        </Row>
        <Row
          label="App updates"
          hint="Install a newer build to update this prototype. Automatic app updates are not connected here."
          last
        >
          <Button label="Release notes" onPress={releases} />
        </Row>
      </Section>
      <Section title="Hosts">
        <Row
          label={host ?? "No host connected"}
          hint="Daemon updates are managed separately for each host"
          last
        >
          <Button label="Daemon & updates" onPress={daemonSettings} disabled={conn !== "online"} />
        </Row>
      </Section>
      <ErrorLine text={act.error} />
    </>
  );
}
