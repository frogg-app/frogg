import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { ciMotion, RunRow } from "../../components/ci/CiRuns";
import Shell from "../../app/index";
import { openCiRun, useCi } from "../../components/ci/model";
import { CiRunDetail, PrsPanel } from "../../components/PrsPanel";
import { color, toolDoneMs } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { ID } from "../fixtures";
import {
  advanceCi,
  cancelCi,
  ciAuto,
  failRunningJob,
  onCiAuto,
  rerunCi,
  setCiAuto,
  startCiRun,
} from "../fixtures/ci";
import { Act, Case, Cases, Controls, Stack, W, type Entry } from "../kit";

const advance = () => advanceCi(30);
const fail = () => failRunningJob();
const retry = () => {
  const r = useCi.getState().runs.find((x) => x.status === "failure");
  if (r) rerunCi(r.id, true);
};
const cancel = () => {
  const r = useCi.getState().runs.find((x) => x.status === "in_progress");
  if (r) cancelCi(r.id);
};

function useAuto(): boolean {
  const [on, setOn] = useState(ciAuto.on);
  useEffect(() => onCiAuto(() => setOn(ciAuto.on)), []);
  return on;
}

function SimControls() {
  const auto = useAuto();
  const toggle = useCallback(() => setCiAuto(!ciAuto.on), []);
  return (
    <Controls>
      <Act label="Start run" run={startCiRun} primary />
      <Act label="Advance 30s" run={advance} />
      <Act label="Fail a job" run={fail} />
      <Act label="Retry failed" run={retry} />
      <Act label="Cancel running" run={cancel} />
      <Act label={auto ? "Pause auto-simulate" : "Auto-simulate"} run={toggle} />
    </Controls>
  );
}

const ci = () => <PrsPanel initialTab="ci" />;

function LiveList() {
  return (
    <Stack>
      <SimControls />
      <Cases>
        <Case name="PrsPanel" props='initialTab="ci"' note="Docked side panel." w={W.panel} h={760}>
          {ci()}
        </Case>
        <Case
          name="PrsPanel"
          props='initialTab="ci"'
          note="Tablet side panel."
          w={W.tablet}
          h={760}
        >
          {ci()}
        </Case>
        <Case
          name="PrsPanel"
          props='initialTab="ci"'
          note="Phone, full screen."
          w={W.phone}
          h={760}
        >
          {ci()}
        </Case>
      </Cases>
    </Stack>
  );
}

/** One row per state from the starting fixtures, each with its jobs unfolded. */
function States() {
  const [runs] = useState(() => useCi.getState().runs);
  const pick = (id: string) => runs.find((r) => r.id === id);
  const cases: Array<[string, string]> = [
    ["r8820", "Queued: waiting for a runner, no bar movement."],
    ["r8818", "Running: lint ✓ typecheck ✓, unit at 63%, android queued, windows building."],
    ["r8815", "Long release build: mac and windows desktop running, release waits on both."],
    ["r8812", "Failed: unit red at vitest, log excerpt with coral edge; e2e skipped."],
    ["r8809", "Flaky retry: attempt 2, e2e passed on its second try."],
    ["r8801", "Matrix: linux and mac passed, windows failed."],
    ["r8797", "Cancelled mid-build."],
    ["r8790", "All passed."],
  ];
  return (
    <Cases>
      {cases.map(([id, note]) => {
        const run = pick(id);
        if (!run) return null;
        return (
          <Case key={id} name="RunRow" props="defaultOpen" note={note} w={W.panel}>
            <View style={s.panel}>
              <RunRow run={run} defaultOpen />
            </View>
          </Case>
        );
      })}
    </Cases>
  );
}

function Detail({ id }: { id: string }) {
  return (
    <Stack>
      <SimControls />
      <View style={s.detail}>
        <CiRunDetail id={id} />
      </View>
    </Stack>
  );
}
const DetailRunning = () => <Detail id="r8818" />;
const DetailFailed = () => <Detail id="r8812" />;
const DetailPhone = () => (
  <Case
    name="CiRunDetail"
    props="onBack"
    note="Phone push: jobs stack above the job pane."
    w={W.phone}
    h={760}
  >
    <CiRunDetail id="r8815" />
  </Case>
);

/** The real shell (app/index.tsx) on the fixture host, PRs & CI open on the failed run. */
function InShell() {
  useEffect(() => {
    useUi.setState({ tool: "prs" });
    openCiRun("r8812");
  }, []);
  return (
    <Stack>
      <SimControls />
      <View style={s.shell}>
        <Shell />
      </View>
    </Stack>
  );
}

export const ciRuns: Entry = {
  id: "ci-runs",
  name: "CI runs",
  category: "Rail tools & widgets",
  path: "components/ci/CiRuns.tsx, components/ci/model.ts, components/PrsPanel.tsx",
  purpose:
    "PRs & CI → CI runs on simulated GitHub Actions data: queued, running, long release, failed with log excerpt, flaky retry, matrix, cancelled, passed. Running runs advance on a timer (lab speed scales it).",
  usedBy: 2,
  polish:
    `progress bars ease to each tick (${ciMotion.fill}ms glide) with a travelling light band while running; percent lerps with the fill · ` +
    `durations count every second (${ciMotion.count}ms linear lerp between ticks), ETA lerps alongside · ` +
    `running → passed/failed/cancelled: glyph pops (${toolDoneMs.pop}ms), row wash sweeps + 2px edge flashes (${toolDoneMs.sweep}ms), throttled to one sweep per ${toolDoneMs.throttle}ms burst · ` +
    "▶ glyph breathes · job list unfolds/folds (180ms) · new runs rise in · log excerpt rises in · scope Seg glides · reduced motion: static, instant",
  decision:
    "Rerun and cancel have no daemon RPC yet: in the real app those buttons stay hidden. Add checkout.ci.rerun / checkout.ci.cancel, and carry commit title, actor, sha, attempt and a failed-step log tail on CiRun/CiJob?",
  ownToasts: true,
  setup: () => useUi.setState({ selected: ID.preview, tool: "prs" }),
  variants: [
    {
      id: "live",
      label: "Live list",
      note: "Auto-simulate is on; use the controls to drive it.",
      C: LiveList,
    },
    {
      id: "shell",
      label: "In the app shell",
      note: "Real shell: PRs & CI panel with the failed run open; switch the panel to CI runs.",
      C: InShell,
    },
    { id: "states", label: "States", note: "Snapshot of each state, jobs unfolded.", C: States },
    { id: "detail-running", label: "Run detail · running", C: DetailRunning },
    { id: "detail-failed", label: "Run detail · failed", C: DetailFailed },
    { id: "detail-phone", label: "Run detail · phone", C: DetailPhone },
  ],
};

const s = StyleSheet.create({
  panel: { backgroundColor: color.bg2 },
  detail: { height: 620 },
  shell: { height: 760 },
});
