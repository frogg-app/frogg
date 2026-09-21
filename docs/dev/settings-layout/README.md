# Settings layout gallery

Settings renders as a split view — a fixed sidebar beside a detail pane — inside a modal that
tracks the window, so the detail pane is at its narrowest when the window is. These screenshots
show what each section looks like at the widths a window actually gets, which is the only way to
see a layout that only misbehaves below a certain width.

They exist because of one such bug: a settings row lays a label beside its controls, the controls
keep their intrinsic width and the label does not, so a narrow pane took the difference out of the
label. About's update row — a sentence beside two buttons — rendered that sentence one character
wide and the full height of the pane. The row wraps now, and `740-about.png` is what the wrap
looks like: the label on its own line, the buttons beneath it and right-aligned.

| Width | What it shows                                                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 740   | Every row with wide controls has wrapped: release channel, the check button, the update card                                        |
| 900   | Identical to 740 — the modal is 80% of the window but never narrower than 720, so the pane stops shrinking here                     |
| 1180  | The ordinary rows are back on one line; the update card, the widest row settings has, still wraps its two buttons beneath the label |
| 1440  | Every row on one line, the update card included                                                                                     |

## Regenerating them

The gallery is a by-product of the test that guards the layout, so it is never out of step with
what the app does:

```sh
cd apps/ui
SETTINGS_LAYOUT_GALLERY=../../docs/dev/settings-layout \
  npx playwright test --project=browser e2e/browser/settings-narrow-layout.spec.ts
```

Without `SETTINGS_LAYOUT_GALLERY` the spec writes nothing and only asserts: at each width, no text
in the open pane may be squeezed into a vertical strip. That check is a shape rather than a named
row, so it covers every section without each one having to be listed.

The spec stands in a minimal desktop shell bridge, because the update row that breaks first only
renders inside the desktop app, and reports an update so that row is on screen. The toast in the
bottom-left corner of the screenshots is the app noticing that the stand-in shell has no event
API; it is an artefact of the harness, not of settings.
