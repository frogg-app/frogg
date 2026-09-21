# frogg client UX premium audit

Scope: `apps/ui`. Prioritised (P1 highest). Size S/M/L. `[x]` = implemented on branch `ux-premium-pass`.
Already shipped and excluded: copy-path toast in Changes, daemon self-update progress, right-anchored usage columns.

## P1 — feedback and house-rule breaks

- [x] P1 S — Daemon status copy confirms with a platform `Alert` instead of the in-app toast — `apps/ui/src/desktop/components/desktop-updates-section.tsx:74`
- [x] P1 S — Log path copy confirms and fails with platform `Alert`; copy-status failure is silent (console only) — `apps/ui/src/desktop/components/desktop-updates-section.tsx:106`
- [x] P1 S — Hardcoded English error titles bypass i18n ("Unable to update sessions" / "terminal agent hooks"); both cards' titles, hints and labels were also untranslated — `apps/ui/src/screens/settings/host-page.tsx:896`, `:937`
- [x] P1 S — Hardcoded "Failed to mark workspace as read" fallback in three places — `apps/ui/src/components/sidebar-workspace-list.tsx:1304`, `components/sidebar/sidebar-workspace-row.tsx:117`, `components/sidebar/sidebar-status-list.tsx:641`
- [x] P1 S — Hardcoded "Loading..." empty text in the shared select — `apps/ui/src/components/ui/select-field.tsx:323`
- [ ] P1 M — Hardcoded English errors in add-project flow — `apps/ui/src/components/add-project-flow.tsx:198`, `:564`, `:590`
- [ ] P1 M — Non-destructive save/update failures across settings use platform `Alert` rather than toast/inline error (agent profiles, metadata generation, provider removal, host connection/restart/remove, image picker, add host) — `apps/ui/src/agent-profiles/settings/agent-profiles-section.tsx:81`, `screens/settings/host-page.tsx:330`, `screens/settings/metadata-generation-page.tsx:54`, `screens/settings/provider-settings-modal/provider-settings-modal.tsx:144`, `hooks/use-image-attachment-picker.ts:84`, `components/add-host-modal.tsx:281`
- [ ] P1 M — Daemon conflict warning uses a platform `Alert` for a destructive choice; should be frogg's confirm dialog — `apps/ui/src/hosts/daemon-conflict-warning.tsx:97`
- [ ] P1 M — Archive failures are swallowed silently (`.catch(() => {})`); a non-timeout failure should toast with retry — `apps/ui/src/components/agent-list.tsx:433`, `:447`, `screens/workspace/workspace-screen.tsx:2588`

## P2 — friction and consistency

- [ ] P2 M — Settings toggles patch config without optimistic state or pending indicator; the switch snaps back only after the round trip — `apps/ui/src/screens/settings/host-page.tsx:893`, `:933`
- [ ] P2 M — Many composer failures (paste image, upload, drop) are console-only; route through the existing `toast.error` — `apps/ui/src/composer/index.tsx:1700`, `:1753`, `:1788`
- [ ] P2 M — Spinners dominate (~159 uses) where layout is known; extend the skeleton pattern (PR pane, sidebar) to settings lists and host pages — `apps/ui/src/components/sidebar-agent-list-skeleton.tsx:1`
- [ ] P2 S — Provider usage refresh failure swallowed with no stale marker — `apps/ui/src/components/context-window-meter.tsx:249`
- [ ] P2 S — Preferred-editor update failure swallowed; choice silently reverts on next launch — `apps/ui/src/workspace/open-in-editor/button.tsx:202`

## P3 — recommendations needing a product/design call

- [ ] P3 L — Undo toast for archive instead of pre-confirm (needs product call on undo semantics).
- [ ] P3 M — Unified "saved" micro-confirmation for settings autosave (design call on pattern: inline tick vs toast).
- [ ] P3 M — Keyboard-shortcut discoverability: surface shortcuts in tooltips and Command Center rows consistently.
