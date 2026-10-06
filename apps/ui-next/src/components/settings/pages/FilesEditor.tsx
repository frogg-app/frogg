import { Select, type Option } from "../../Select";
import { prefSetter, usePrefs } from "../../../prefs";
import { NumField, Row, Section, Seg, Toggle } from "../controls";

const WHERE: Array<["main" | "pane", string]> = [
  ["main", "Main area"],
  ["pane", "Side pane"],
];
const EDITORS: Array<Option<string>> = [
  { value: "vscode", label: "VS Code" },
  { value: "cursor", label: "Cursor" },
  { value: "zed", label: "Zed" },
  { value: "idea", label: "IntelliJ IDEA" },
  { value: "system", label: "System default" },
];
const setScrollback = (v: number | null) => prefSetter("scrollback")(v ?? 10000);

export function FilesEditor() {
  const p = usePrefs();
  return (
    <>
      <Section title="Editor">
        <Row label="Vim keybindings">
          <Toggle value={p.vim} onChange={prefSetter("vim")} />
        </Row>
        <Row label="Open files from the explorer">
          <Seg options={WHERE} value={p.openFiles} onChange={prefSetter("openFiles")} />
        </Row>
        <Row label="Open diffs">
          <Seg options={WHERE} value={p.openDiffs} onChange={prefSetter("openDiffs")} />
        </Row>
        <Row label="Default external editor" last>
          <Select
            value={p.externalEditor}
            options={EDITORS}
            onChange={prefSetter("externalEditor")}
            width={180}
            up
          />
        </Row>
      </Section>
      <Section title="Terminal">
        <Row label="Scrollback" hint="0–1,000,000 lines">
          <NumField
            value={p.scrollback}
            onChange={setScrollback}
            unit="lines"
            min={0}
            max={1000000}
            width={96}
          />
        </Row>
        <Row label="Copy on select">
          <Toggle value={p.copyOnSelect} onChange={prefSetter("copyOnSelect")} />
        </Row>
        <Row label="Legacy renderer" hint="Use only if text renders incorrectly" last>
          <Toggle value={p.legacyRenderer} onChange={prefSetter("legacyRenderer")} />
        </Row>
      </Section>
    </>
  );
}
