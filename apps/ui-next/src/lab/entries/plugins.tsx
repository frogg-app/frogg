import { PluginsPanel } from "../../components/PluginsPanel";
import { Rail } from "../../components/Rail";
import { Plugins as PluginsSettings } from "../../components/settings/pages/Plugins";
import { VoiceCompanion } from "../../components/settings/pages/VoiceCompanion";
import { useWatchPluginGate } from "../../daemon/plugins";
import { Act, Column, Controls, Row, type Entry } from "../kit";
import { setLabRemoteControlForbidden, simulateExternalPluginChange } from "../sim/misc";

const NO_BADGES = {};

function Installed() {
  return (
    <Row>
      <Column width={360}>
        <PluginsPanel />
      </Column>
    </Row>
  );
}

/** One shared store: a change made elsewhere lands in the tool and the settings page at once. */
function Live() {
  return (
    <>
      <Controls>
        <Act label="Change from another client" run={simulateExternalPluginChange} primary />
      </Controls>
      <Row>
        <Column width={360}>
          <PluginsPanel />
        </Column>
        <Column width={480}>
          <PluginsSettings />
        </Column>
      </Row>
    </>
  );
}

/** The rail's Companion item follows the host's capability; install it from settings. */
function CompanionGate() {
  useWatchPluginGate();
  return (
    <Row>
      <Rail badges={NO_BADGES} />
      <Column width={560}>
        <VoiceCompanion />
      </Column>
    </Row>
  );
}

export const plugins: Entry[] = [
  {
    id: "plugins",
    name: "Plugins (API v2)",
    category: "Rail tools & widgets",
    path: "components/PluginsPanel.tsx · tools/PluginInstalled.tsx · tools/PluginSources.tsx · settings/pages/Plugins.tsx · daemon/plugins.ts",
    purpose:
      "Installed plugins (shared store, live on plugins.changed) with granted capabilities and the per-plugin remote control switch (plugin API v2), update with consent, uninstall, v1 + v2 catalog entries, an incompatible one, a source whose signature fails, and the Companion gate read from server_info.",
    usedBy: 1,
    polish:
      "Toggle track .25s / knob .3s on ease (web); remote-control capabilities dim while it is off; dialogs use overlayMotion",
    variants: [
      {
        id: "installed",
        label: "Installed and browse",
        note: "Slack bridge is v2: flip Remote control. Linear's update asks for a new capability. Browse lists Telegram (plugin API v3) as needing a newer host.",
        C: Installed,
        h: 720,
        bleed: true,
      },
      {
        id: "live",
        label: "Live updates",
        note: "Change from another client installs or removes Vercel previews and flips Sentry, pushing plugins.changed; the tool and the settings page both follow without a refresh.",
        C: Live,
        h: 760,
        bleed: true,
      },
      {
        id: "companion",
        label: "Companion gate",
        note: "Install the Companion plugin from the row under Enable Companion; the rail item appears.",
        C: CompanionGate,
        h: 640,
        bleed: true,
      },
    ],
  },
  {
    id: "plugins-forbidden",
    name: "Plugins (remote control forbidden)",
    category: "Rail tools & widgets",
    path: "components/tools/PluginInstalled.tsx",
    purpose:
      'A brand with `plugins.remoteControl: "forbidden"`: the switch is disabled and says why; consent lines note it.',
    usedBy: 1,
    polish: "as Plugins (API v2)",
    // Its own entry: the policy is host state, and an entry's variants share one host.
    setup: () => setLabRemoteControlForbidden(true),
    variants: [
      { id: "forbidden", label: "Forbidden by the brand", C: Installed, h: 720, bleed: true },
    ],
  },
];
