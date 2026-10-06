# Settings parity: apps/ui → apps/ui-next

Gaps where ui-next lacks something apps/ui has. Order = priority. Tick when done.

## P1 — Hosts (broken workflows)

- [x] **Edit host**: change address/port, password, TLS after adding (apps/ui: Host page → Connections)
- [ ] Per-host connection list: show each saved route (direct/relay/SSH) with latency; remove one route
- [ ] Host appearance: colour (11 swatches) and sidebar badge (Name / Icon only / Hidden)
- [ ] Rename from Hosts panel / host detail (currently only Settings › Overview)
- [ ] Connection error card: credential rejected → "Pair again"; different daemon at this address
- [ ] Pairing request approval: pick role (currently hardcoded `operator`)
- [ ] Network scan: "Servers on your network" with Connect / Needs pairing
- [ ] Multiple-daemon conflict warning with "Shut down other"
- [ ] Remote SSH / Deploy to host (desktop only — defer until ui-next ships on desktop)
- [ ] Scan QR to pair (native)

## P2 — Wire prefs that are saved but never read

- [ ] Chat & composer prefs (default send, tool-call display, expand reasoning, outline, subagent target, service URLs, PR links, hidden folders)
- [ ] Files/terminal: scrollback (TerminalView hardcodes 5000), vim, open-in targets
- [ ] Permission modes defaults
- [ ] Notifications delivery matrix, sound, rail badge
- [ ] Usage meter refresh timer / on hover / after reply / animate
- [ ] Companion enable gates the rail item; other companion prefs
- [ ] Appearance: density + motion persisted and applied

## P3 — Missing controls

- [ ] Providers: enable/disable toggle, add/remove provider, refresh
- [ ] Provider settings: version (install/update/auto-update), models (custom IDs, search), diagnostic run/copy, uninstall
- [ ] Account details: sign in (login terminal), default model/thinking, model access, per-account prompt, nickname/colour
- [ ] Automation › generated-text model (stub `noop`) — automatic/preferred model with fallback
- [ ] Project: name and icon editing
- [ ] Terminal profiles: reorder
- [ ] Appearance: fonts (UI/content/code + sizes), syntax theme, language
- [ ] Sidebar/rail items: show/hide, reorder
- [ ] Keyboard shortcuts: rebind / clear / reset (desktop)
- [ ] Daemon self-update phases + reconnect countdown
- [ ] Connected devices "now" list, nickname, last seen; last-owner / self-demote guards
- [ ] Pairing code card: expiry timer, fingerprint, QR, regenerate; owner-code warning
- [ ] Security: listen-address instructions
- [ ] About: connected hosts' versions with "version differs" / Update host; release channel; developer-options switch
- [ ] App updates: check / download / install (desktop + Android)
- [ ] Desktop-only: notifications permission/test, mic permission, downloads folder, clear browser data, built-in daemon management
- [ ] General diagnostics: app diagnostic, test audio playback
- [ ] Settings search: match settings inside pages, not just page labels
- [ ] Palette: settings commands

## Already ahead in ui-next (no action)

- Notification delivery matrix, quiet hours, CI & release streams, session labels, port range, storage alert thresholds, auto-update channel/quiet hours, relay enable toggle
