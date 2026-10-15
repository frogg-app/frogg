// Connect a host: reuses the Hosts tool's own add-host and pair-device dialogs.
import { Link2, QrCode, Smartphone } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { useHosts } from "../../daemon/hosts";
import { useDaemon } from "../../daemon/store";
import { useFormFactor } from "../../theme/layout";
import { color } from "../../theme/tokens";
import { Button } from "../Button";
import { T } from "../Text";
import { away, openHostSheet } from "./nav";
import { Cmd, Para, Status, StepHead } from "./parts";
import { useOnboarding } from "./store";

const pairCode = () => away("host", () => openHostSheet({ kind: "add", method: "pair" }));
const direct = () => away("host", () => openHostSheet({ kind: "add", method: "direct" }));
const pairPhone = () => away("host", () => openHostSheet({ kind: "pair-device" }));

export function HostStep() {
  const conn = useDaemon((st) => st.conn);
  const name = useDaemon((st) => st.serverName);
  const saved = useHosts((st) => st.hosts.length);
  const level = useOnboarding((st) => st.level);
  const phone = useFormFactor() === "phone";
  if (conn === "online")
    return (
      <>
        <StepHead
          title="Your host is connected"
          lede="Agents run on the host, not in this app, so they keep working when you close it."
        />
        <Status tone="ok">
          Connected to {name ?? "host"}
          {saved > 1 ? ` · ${saved} hosts saved` : ""}
        </Status>
        {level === "new" && (
          <Para>
            A host is any computer running the Frogg daemon: this machine, a server or a VM. You can
            add more later from Hosts in the rail.
          </Para>
        )}
        <View style={s.actions}>
          {!phone && (
            <Button label="Pair your phone" icon={Smartphone} kind="primary" onPress={pairPhone} />
          )}
          <Button label="Add another host" icon={Link2} onPress={direct} />
        </View>
        {!phone && (
          <Para faint>
            A paired phone follows the same sessions and can answer permissions away from your desk.
          </Para>
        )}
      </>
    );
  return (
    <>
      <StepHead
        title="Connect a host"
        lede="Frogg's agents run on a host: a computer running the Frogg daemon. Connect this app to one."
      />
      <Status tone="wait">
        {conn === "connecting" ? "Looking for a host…" : "No host connected"}
      </Status>
      {level === "expert" ? (
        <Para>
          Run <Inline>frogg pair</Inline> on the host and enter the code, or connect to its address.
        </Para>
      ) : (
        <>
          <Para>No daemon yet? Install it on the machine that has your code:</Para>
          <Cmd>curl -fsSL https://frogg.app/install.sh | bash</Cmd>
          <Para>Then run this there and enter the code it prints here:</Para>
          <Cmd>frogg pair</Cmd>
        </>
      )}
      <View style={s.actions}>
        <Button label="Pair with a code or link" icon={QrCode} kind="primary" onPress={pairCode} />
        <Button label="Enter an address" icon={Link2} onPress={direct} />
      </View>
      <Para faint>
        The walkthrough steps aside while you pair and comes back when the dialog closes.
      </Para>
    </>
  );
}

/** Inline command inside a paragraph. */
function Inline({ children }: { children: string }) {
  return (
    <T v="mono" style={s.inline}>
      {children}
    </T>
  );
}

const s = StyleSheet.create({
  inline: { color: color.cyan2, fontSize: 12.5 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6, marginBottom: 14 },
});
