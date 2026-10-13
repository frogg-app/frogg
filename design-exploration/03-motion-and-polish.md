# 03 — Motion and polish reference

A reference for the Frogg redesign: Expo/React Native (iOS/Android), web (react-native-web) and Electron.
Each technique covers **how it works**, **what it achieves**, **alternatives**, **when not to use it**, and **RN / web feasibility**.

Feasibility key: **Easy** = available with what we already ship or one well-supported lib. **Medium** = needs a platform split or custom work. **Hard** = no good native path; web-only or expensive.

Assumed stack: `react-native-reanimated` (v3/v4), `react-native-gesture-handler`, `expo-blur`, `expo-linear-gradient`, `@shopify/react-native-skia` (optional), and on web, CSS plus optionally `motion` (Framer Motion).

---

## 0. Principles (what the good writers agree on)

- **Purpose before polish.** Animate to explain a change in state or space (where did this come from, where did it go), to give feedback, or to cover latency. Never animate because you can. (Kowalski, "You don't need animations"; Rauno, _Web Interface Guidelines_.)
- **Frequency kills motion.** Things a user does hundreds of times a day (open command palette, send message, switch session) should be instant or near-instant. Raycast's and Linear's palettes have essentially no entrance motion. Rauno: "Actions that are frequent and low in novelty should avoid extraneous animations."
- **Ease-out for UI.** Entering and responding elements should start fast and settle. Built-in CSS `ease-out` is too weak; use a strong custom curve. (Kowalski.)
- **Keep UI motion short.** Interface motion should mostly stay under 300ms; a 180ms dropdown feels faster than a 400ms one. (Kowalski.)
- **Interruptibility.** Anything a user can trigger repeatedly must be retargetable mid-flight. Springs and CSS transitions are interruptible; CSS keyframe animations are not. (Kowalski, _Sonner_ write-up; Apple WWDC "Designing Fluid Interfaces".)
- **Only animate `transform` and `opacity`** (plus `filter` sparingly). Layout properties cause reflow; on RN they run on the JS thread unless using Reanimated layout animations.
- **Respect reduced motion** (section 22).

---

## 1. Springs vs easing curves

**How it works**

- _Easing curve_: fixed duration, progress mapped through a cubic-bezier. Deterministic, easy to sync.
- _Spring_: physical simulation (stiffness, damping, mass, initial velocity). Duration emerges from the physics. Carries velocity, so it handles interruption and gesture hand-off naturally.
- Apple (SwiftUI) and Motion expose a perceptual parametrisation: **duration + bounce** (`bounce: 0` is critically damped, no overshoot).

```css
/* Web: strong curves (Kowalski) */
--ease-out: cubic-bezier(0.23, 1, 0.32, 1); /* enter, respond */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1); /* move on screen */
--ease-in: cubic-bezier(0.55, 0.085, 0.68, 0.53); /* rarely: exit-to-nowhere */
```

```ts
// Reanimated
withSpring(1, { damping: 20, stiffness: 240, mass: 1 });          // snappy, ~no overshoot
withSpring(1, { duration: 350, dampingRatio: 1 });                 // Reanimated 3.6+ perceptual API
withTiming(1, { duration: 200, easing: Easing.bezier(0.23, 1, 0.32, 1) });

// Motion (web)
<motion.div animate={{ x: 0 }} transition={{ type: 'spring', duration: 0.35, bounce: 0.1 }} />
```

CSS can approximate springs with `linear()` easing (generated, e.g. by Jake Archibald's / Kevin Grajeda's linear() generators), but it loses velocity hand-off.

**Achieves**: springs feel physical and stay smooth when interrupted; curves give predictable choreography.

**Alternatives**: `linear()` spring approximations; Material 3 "expressive" spring tokens; plain timing.

**When not to**: colour/opacity fades (springs add nothing; use timing). Bouncy springs (bounce > 0.2) in a productivity tool read as toy-like, except for deliberately playful moments.

**Feasibility**: RN Easy (Reanimated). Web Easy (Motion, or CSS curves).

**Recommendation**: springs for anything spatial or gesture-driven (sheets, drawers, reorder, layout); custom ease-out timing for opacity, colour and small enter/exit.

---

## 2. Layout and shared-element transitions

**How it works**

- _FLIP_ (First, Last, Invert, Play): measure before and after, apply an inverse transform, animate transform to identity. This is what Motion's `layout` / `layoutId` do.
- _Shared element_: two components share an id; on mount of the second the system animates from the first's bounds.

```tsx
// Web (Motion): session tab indicator that slides between tabs
{active && <motion.div layoutId="tab-indicator" className="indicator" />}

// RN (Reanimated layout animations)
<Animated.View layout={LinearTransition.springify().damping(20)} entering={FadeIn.duration(150)} exiting={FadeOut.duration(100)} />

// RN shared element (Reanimated, experimental / v4 reworked)
<Animated.Image sharedTransitionTag={`agent-${id}`} />
```

**Achieves**: preserves object constancy: users track "the same thing" moving, not one thing vanishing and another appearing.

**Alternatives**: crossfade; View Transitions (section 3); just cutting.

**When not to**: long lists with many simultaneously changing items (expensive, visually noisy); content where size change distorts text (FLIP scales text; Motion corrects with `layout="position"` or scale correction).

**Feasibility**: Web Easy (Motion). RN: `layout` transitions Easy; shared element transitions Medium (Reanimated's shared transitions have been experimental and native-stack-only; budget fallbacks).

---

## 3. View Transitions API

**How it works**: the browser snapshots old and new DOM states and crossfades/morphs them via pseudo-elements you style with CSS.

```js
document.startViewTransition(() => {
  flushSync(() => setRoute(next));
});
```

```css
.session-header {
  view-transition-name: session-header;
}
::view-transition-old(root),
::view-transition-new(root) {
  animation-duration: 180ms;
}
@media (prefers-reduced-motion) {
  ::view-transition-group(*) {
    animation: none;
  }
}
```

Same-document transitions are supported in Chromium (so Electron), Safari 18+, and Firefox 144+. React has an experimental `<ViewTransition>` component.

**Achieves**: route/state morphs with near-zero JS, including elements that change DOM parent.

**Alternatives**: Motion `layoutId`; manual FLIP.

**When not to**: during streaming (each update would snapshot); interactions that must be interruptible (view transitions block input to the snapshot until done and can't be retargeted cleanly); RN.

**Feasibility**: Web/Electron Easy. RN: not applicable. Use as a web-only enhancement for route changes (e.g. workspace to settings).

---

## 4. Staggered lists

**How it works**: offset each child's start by a small delay.

```ts
// RN
<Animated.View entering={FadeInDown.delay(i * 30).duration(220).easing(Easing.bezier(0.23,1,0.32,1))} />
// Motion
const list = { show: { transition: { staggerChildren: 0.03 } } };
```

Keep per-item offset 20–40ms, cap total stagger (e.g. only the first 8 items stagger; the rest appear with the last).

**Achieves**: guides the eye in reading order; makes a batch arrival feel composed.

**Alternatives**: animate the container only; no motion.

**When not to**: lists the user opens often (session list, file tree), virtualized lists that mount on scroll (stagger on scroll looks broken), anything that delays reading.

**Feasibility**: RN Easy (but `entering` on FlatList/FlashList cells fires on recycle; gate by "first appearance"). Web Easy.

---

## 5. Streaming text reveal

**How it works**: LLM tokens arrive in irregular bursts. Options:

1. **Append raw** — honest, jittery.
2. **Smoothed buffer** — buffer tokens and release at a steady characters-per-frame rate that adapts to backlog (e.g. `charsPerFrame = clamp(backlog / 30, 1, 40)`). This is what Vercel AI SDK's `smoothStream` and many chat UIs do.
3. **Per-word fade** — wrap newly committed words in a span with a 150–250ms opacity (+ optional 2px blur → 0) fade.

```css
.token-new {
  animation: tokenIn 200ms cubic-bezier(0.23, 1, 0.32, 1) both;
}
@keyframes tokenIn {
  from {
    opacity: 0;
    filter: blur(2px);
  }
  to {
    opacity: 1;
    filter: none;
  }
}
```

Markdown: parse incrementally and treat incomplete syntax (unclosed code fence, half table) tolerantly (e.g. Vercel's `streamdown`) so blocks don't reflow when the closing fence arrives.

**Achieves**: perceived fluency, reduced jitter, readable pace.

**Alternatives**: show a typing indicator then reveal the full block (good for short replies or background agents).

**When not to**: per-character animation on long outputs (thousands of animated spans, blur filters are costly); when the user scrolls away (stop animating offscreen content); background sessions (just append).

**Feasibility**: Web Easy. RN Medium: per-word animated `Text` spans are expensive; prefer smoothed buffer plus a single fading "tail" view, or only fade at block granularity.

---

## 6. Skeletons and shimmer

**How it works**: placeholder shapes matching final layout; optional shimmer = moving gradient highlight.

```css
.skeleton {
  background: linear-gradient(90deg, var(--s1) 0%, var(--s2) 50%, var(--s1) 100%) 0 0 / 200% 100%;
  animation: shimmer 1.4s linear infinite;
}
@keyframes shimmer {
  to {
    background-position: -200% 0;
  }
}
```

RN: `expo-linear-gradient` inside a `MaskedView`, translated with Reanimated; or Skia shader.

**Achieves**: prevents layout shift, sets expectation of shape, reduces perceived wait.

**Alternatives**: delayed spinner (show only after ~300–400ms); blank + fade-in; cached stale content (best).

**When not to**: loads that usually finish quickly (skeleton flash is worse than nothing; delay showing it); content whose shape you can't predict; agent output (use a thinking state, section 24).

**Feasibility**: Easy everywhere. Use a _static_ pulse (opacity 0.5 ↔ 0.8) under reduced motion.

---

## 7. Optimistic UI

**How it works**: apply the expected result locally immediately, reconcile with server response, roll back on error.

```ts
// React 19
const [optimistic, addOptimistic] = useOptimistic(messages, (s, m) => [
  ...s,
  { ...m, pending: true },
]);
```

Pending items render at slightly reduced opacity (0.6–0.7) or with a small clock glyph; failure shows inline retry, not a modal.

**Achieves**: zero-latency feel; Linear's local-first sync model is the archetype.

**Alternatives**: spinner in button; disable-and-wait.

**When not to**: destructive or irreversible actions (deleting a worktree, force push), operations with high failure rates, anything where showing a wrong state is harmful.

**Feasibility**: Easy (state, not rendering). For Frogg: sending a prompt, renaming a session, toggling settings, archiving are ideal candidates.

---

## 8. Command palette motion

**How it works**: Raycast / Linear / Vercel palettes (often built on `cmdk`) open with either no animation or a ≤150ms scale 0.98→1 + opacity. The selected-item highlight may slide (Motion `layoutId`) but many top apps keep it instant to keep keyboard nav crisp. Height animates to fit results (cmdk exposes `--cmdk-list-height`).

```css
[cmdk-list] {
  height: var(--cmdk-list-height);
  transition: height 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
[cmdk-dialog] {
  animation: in 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
@keyframes in {
  from {
    opacity: 0;
    transform: scale(0.98);
  }
}
```

**When not to**: never animate the close (instant dismiss), never animate keyboard selection with springs that lag behind key repeat.

**Feasibility**: Web Easy (`cmdk`). RN Medium: custom; a bottom sheet palette on mobile.

---

## 9. Toasts (Sonner pattern)

**How it works** (Kowalski's Sonner):

- Toasts stack with depth: each older toast scales down (`scale: 1 - index * 0.05`) and offsets (`translateY: index * gap`), collapsed; hover expands to full list.
- CSS transitions (not keyframes) so rapid additions interrupt smoothly.
- Swipe to dismiss with velocity threshold; timers pause on hover and when tab hidden.
- Height of front toast drives stack sizing.

```ts
toast.promise(runAgent(), {
  loading: "Starting agent…",
  success: "Agent ready",
  error: "Failed to start",
});
```

**Achieves**: non-blocking feedback that doesn't pile up.

**Alternatives**: inline status (preferred for anything tied to a visible element), status bar, banners for persistent states.

**When not to**: errors that need action (use inline or dialog), confirmations of what the user can already see happened.

**Feasibility**: Web Easy (`sonner`). RN Easy-Medium (`sonner-native`, or `burnt` for native OS toasts).

---

## 10. Drawers and sheets

**How it works**: gesture-driven panels with spring physics; release velocity decides snap point; background scales/dims (iOS "card" effect). Vaul (Kowalski) on web; `@gorhom/bottom-sheet` on RN.

```ts
// Vaul-like snap logic
const snap = Math.abs(velocityY) > 0.4 ? (velocityY > 0 ? "closed" : "open") : nearest(points, y);
withSpring(target, { damping: 30, stiffness: 300, velocity: velocityY });
```

Rubber-band beyond bounds (resistance factor ~0.5 or logarithmic). Dim backdrop opacity tied to sheet position, not a separate timer.

**Achieves**: direct manipulation, spatial model on touch.

**Alternatives**: modal dialog (desktop), side panel (desktop), popover.

**When not to**: desktop/Electron primary surfaces (use split panes, not sheets); nested sheets more than one level deep.

**Feasibility**: RN Easy (`@gorhom/bottom-sheet`, native `formSheet` in react-native-screens). Web Easy (Vaul). Use platform-appropriate: sheets on mobile, panels/dialogs on desktop.

---

## 11. Hover and press micro-interactions

**How it works**

- _Press_: scale 0.97–0.98 on press-in with a quick timing (~100ms), spring back on release. Apply on press-in (not on click) so it feels instant.
- _Hover_: background tint change, instant on enter or ≤150ms, slightly slower out. Only on devices that hover: `@media (hover: hover) and (pointer: fine)`.
- _Hover-intent delays_: tooltips open after ~400–600ms, then subsequent tooltips open instantly while "warm" (Radix `skipDelayDuration`). Tooltips should not animate when already warm (Rauno).

```ts
const s = useSharedValue(1);
<Pressable onPressIn={() => (s.value = withTiming(0.97, { duration: 100 }))}
           onPressOut={() => (s.value = withSpring(1, { damping: 15, stiffness: 400 }))} />
```

**When not to**: scale on large surfaces (cards scaling 0.97 look like they collapse; use 0.99 or tint only); list rows (tint, no scale); text links.

**Feasibility**: Easy everywhere. Haptics on RN (`expo-haptics` `selectionAsync`) for toggles and snap points, sparingly.

---

## 12. Focus rings

**How it works**: show only for keyboard (`:focus-visible`), high contrast, offset from the element so it doesn't fight borders.

```css
:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
  border-radius: inherit;
}
/* or ring via box-shadow to follow radius in older engines */
box-shadow:
  0 0 0 2px var(--bg),
  0 0 0 4px var(--focus);
```

Don't animate the ring in (or ≤80ms). Composer input: use a subtle border colour change rather than a ring.

**Feasibility**: Web Easy. RN: hardware keyboard focus on iPad/Android/RN-web needs explicit `onFocus` styling; Medium.

---

## 13. Glass / blur (backdrop)

**How it works**: `backdrop-filter: blur(20px) saturate(180%)` over a translucent fill (e.g. `rgba(bg, 0.7)`), plus a 1px inner highlight border. Apple's 2025 "Liquid Glass" adds refraction and specular edges.

```css
.toolbar {
  background: color-mix(in oklab, var(--bg) 72%, transparent);
  backdrop-filter: blur(20px) saturate(1.8);
  border-bottom: 1px solid var(--hairline);
}
```

RN: `expo-blur` `<BlurView intensity={40} tint="systemChromeMaterial" />`; Android blur support historically experimental/costly — use a solid translucent fallback. Electron macOS: `vibrancy: 'sidebar'`; Windows 11: `backgroundMaterial: 'mica' | 'acrylic'`.

**Achieves**: hierarchy and context retention for floating chrome (headers over scrolling content, palettes).

**When not to**: over text-dense content where legibility drops; large animated blurred regions (GPU cost, battery); stacking blurs.

**Feasibility**: Web/Electron Easy. iOS Easy. Android Medium (fallback to solid).

---

## 14. Noise / grain

**How it works**: overlay a tiny tiled noise texture (SVG `feTurbulence` or a 128px PNG) at 2–6% opacity, often `mix-blend-mode: overlay`. Breaks up banding in gradients and adds tactile quality.

```html
<svg>
  <filter id="n">
    <feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="3" stitchTiles="stitch" />
  </filter>
  <rect width="100%" height="100%" filter="url(#n)" opacity=".04" />
</svg>
```

**When not to**: everywhere (looks dirty); on text surfaces; animated grain (costly, distracting).

**Feasibility**: Web Easy (static image). RN Easy as a tiled `ImageBackground`; Skia for procedural. Use only on large empty/brand surfaces (empty state, onboarding).

---

## 15. Gradients and glow borders

**How it works**

- _Gradient border_: element with `padding: 1px` and a gradient background, inner element with surface fill; or CSS `mask` with `mask-composite: exclude`.
- _Rotating/conic glow_ (Aceternity "moving border", Magic UI "border beam", "shine border"): `conic-gradient(from var(--angle), ...)` with `@property --angle` animated.

```css
@property --angle {
  syntax: "<angle>";
  initial-value: 0deg;
  inherits: false;
}
.beam {
  background: conic-gradient(from var(--angle), transparent 70%, var(--accent), transparent)
    border-box;
  animation: spin 3s linear infinite;
}
@keyframes spin {
  to {
    --angle: 360deg;
  }
}
```

**Achieves**: draws attention; signals "live" or "AI working".

**Alternatives**: solid accent border; subtle pulsing dot.

**When not to**: more than one at a time on screen; static decoration (marketing-site look, ages fast); text-heavy surfaces. Aceternity/Magic UI components are landing-page oriented — borrow ideas, not wholesale.

**Feasibility**: Web Easy. RN Medium: Skia `SweepGradient` with rotating matrix, or rotated `LinearGradient` behind a masked inner view. Good fit for exactly one thing: an actively running agent card (section 24).

---

## 16. Depth and elevation

**How it works**: layered shadows (several soft shadows with increasing blur) look more natural than one. In dark mode shadows are nearly invisible; use **lighter surfaces for higher elevation** plus a 1px top highlight (`inset 0 1px 0 rgba(255,255,255,0.06)`) — Linear, Vercel, Raycast all do this.

```css
--shadow-2: 0 1px 1px rgb(0 0 0 / 0.06), 0 2px 4px rgb(0 0 0 / 0.06), 0 8px 16px rgb(0 0 0 / 0.06);
--ring: 0 0 0 1px rgb(0 0 0 / 0.08); /* Vercel-style hairline */
```

Material 3 uses tonal elevation (surface tint increasing with level) instead of shadow in dark.

**Feasibility**: Web Easy. RN: iOS shadows Easy; Android uses `elevation` (single shadow) — RN 0.76+ `boxShadow` style prop supports multi-layer CSS-like shadows on new architecture. Prefer borders + tonal surfaces for cross-platform consistency.

---

## 17. Typography scale

**How it works**: modular scale with small ratio for dense apps (1.125–1.2). Product apps typically: 11/12/13/14/16/20/24/32. Tighten tracking on large sizes, loosen slightly on tiny caps. Use tabular numbers for counters/timers (`font-variant-numeric: tabular-nums`). `text-wrap: balance` for headings, `pretty` for paragraphs (Rauno).

Suggested: Inter / Geist / system UI for UI; Geist Mono / JetBrains Mono / Berkeley Mono for code. Body 14px desktop, 16px mobile (iOS Dynamic Type base 17pt), line-height 1.5 prose, 1.35 UI.

**Feasibility**: Easy. RN: `fontVariant: ['tabular-nums']`; respect `allowFontScaling` and Dynamic Type.

---

## 18. Density

**How it works**: a 4px base grid; row heights 28 (compact) / 32 (default desktop) / 44 (touch minimum, Apple HIG; Material 48dp). Offer a density setting rather than a single compromise. Linear-style apps run dense on desktop with generous whitespace in content.

**When not to**: dense on touch — tap targets must stay ≥44pt even if visual is smaller (expand hit area with `hitSlop`).

**Feasibility**: Easy (tokens keyed by platform + user setting).

---

## 19. Dark-mode palettes

**How it works**

- Avoid pure black backgrounds except OLED-specific themes; use near-black (`#0A0A0B`–`#111113`) with 3–4 surface steps.
- Build scales in **OKLCH** so lightness steps are perceptually even; Radix Colors provides 12-step scales with defined roles (1–2 bg, 3–5 component, 6–8 borders, 9–10 solid, 11–12 text) in light and dark, and P3 variants.
- Desaturate accents in dark mode; avoid pure white text (use ~92–95% L).
- Linear's 2024 redesign generated themes from three variables (base, accent, contrast) in LCH.

**Feasibility**: Easy. RN: no `oklch()`; precompute hex/P3 values at build time.

---

## 20. Radix / shadcn as a primitive baseline

- **Radix Primitives**: unstyled, accessible behaviour (focus trapping, dismiss, collision-aware popovers, typeahead). Animations via `data-state="open|closed"` + CSS, with `forceMount` for exit animations.
- **shadcn/ui**: copy-in components on Radix + Tailwind; good token architecture (`--background`, `--muted`, `--ring`) worth mirroring.
- RN equivalents: `@rn-primitives` (Radix-ported API) and React Native Reusables (shadcn for RN, NativeWind).

**Recommendation**: mirror shadcn's token naming across platforms; take behaviour from Radix on web and rn-primitives on native.

---

## 21. Perceived performance

- **Respond within 100ms** (visual acknowledgement), even if work takes longer.
- **Delay spinners** ~300–500ms, and once shown keep them ≥400ms to avoid flash.
- **Prefetch on hover/press-in** (Linear, Vercel). Load session transcript on hover over session row.
- **Keep stale content visible** while revalidating; dim slightly rather than blanking.
- **Progress honesty**: determinate progress when known; for agents, show steps (tool calls) rather than one indefinite spinner — that _is_ progress.
- **Ease-out progress bars** feel faster than linear.
- **Avoid layout shift**: reserve space for images, tool cards, and the composer's expanded state.

---

## 22. Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  *,
  ::before,
  ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Better: per-token approach — replace movement (translate/scale) with opacity crossfades rather than removing all feedback. Keep state changes (colour, opacity) and progress indicators; drop parallax, springs, auto-playing shimmer, rotating borders.

- RN: `useReducedMotion()` from Reanimated; layout animations accept `.reduceMotion(ReduceMotion.System)`; `AccessibilityInfo.isReduceMotionEnabled()`.
- Motion: `<MotionConfig reducedMotion="user">`.
- Electron: Chromium honours OS setting.

---

## 23. Other techniques worth stealing

| Technique                                                                                                 | Use in Frogg                                         | Source                             |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------- |
| `blur` + opacity on enter (filter: blur(4px) → 0)                                                         | popovers, new messages — masks imperfect transitions | Kowalski                           |
| Origin-aware popovers (`transform-origin` from trigger; Radix `--radix-popover-content-transform-origin`) | menus, model picker                                  | Radix, Kowalski                    |
| No animation on keyboard-initiated actions                                                                | palette, shortcuts                                   | Rauno                              |
| Number tickers (rolling digits, `font-variant-numeric: tabular-nums`)                                     | token/cost counters                                  | Magic UI, Family                   |
| Scroll-anchored chat ("stick to bottom" unless user scrolled up; show "jump to latest" pill)              | transcript                                           | `use-stick-to-bottom` (StackBlitz) |
| Clip-path reveals (`clip-path: inset(0 100% 0 0)` → `inset(0)`)                                           | diff hunks, progress                                 | Kowalski                           |
| Dynamic Island-style morphing pill                                                                        | global agent activity (section 24)                   | Apple, Family                      |

---

## 24. Fresh ideas for an agent chat app

**Agent "thinking" states**

- Replace three-dot typing with a **state-specific indicator**: _thinking_ (soft shimmering text label "Thinking" — gradient sweep across the glyphs, `background-clip: text`, ~2s loop), _reading files_, _running command_, _waiting for permission_ (static, amber, no motion — needs the user, so it must not look busy).
- Show elapsed-time and token counters as ticking tabular numbers only after the state persists a while; hide for quick turns.
- Collapsible reasoning block: streams in at low contrast (text-secondary), auto-collapses into a one-line summary ("Thought for N steps") when the answer starts.

**Multi-session activity indicators**

- Session list rows carry a **status dot with distinct motion per state**: running = slow breathing (opacity 0.5↔1, ~1.6s), needs-input = steady amber + badge, done-unread = static accent dot, error = static red. Motion only for "running", so the eye reads activity instantly.
- A compact **activity pill** in the title bar (Dynamic Island idea) morphing between "3 agents running" and the most recent event; click expands into a per-agent list via `layoutId`.
- Workspace-level **mini sparkline** of tool-call throughput per agent — cheap ambient awareness.
- When a background agent finishes, pulse its row once (scale 1→1.02→1, plus accent tint fade) instead of a toast; toast only if the app is unfocused (then OS notification).

**Tool-call cards**

- Card enters collapsed: icon + verb + target (`Read src/app.ts`, `Run npm test`). Running state: a thin indeterminate bar or border-beam along the top edge only — the only animated glow on screen.
- On completion: bar resolves to a check, card height animates to show a one-line result summary (`layout` spring). Expand reveals full output with clip-path reveal.
- Consecutive same-kind calls group into one stacked card ("Read 6 files") with Sonner-style stacking depth; expand to fan out.
- Failed tool calls: red left rule + error excerpt visible without expanding.

**Diff reveal**

- New hunks reveal top-to-bottom with clip-path (≤250ms per hunk, staggered 40ms, cap total).
- Additions fade a green background from 25% to 10% opacity over ~1s ("just changed" afterglow), then settle — tells the user what's new without permanent noise.
- File-level summary row with animated `+N −M` counters; chevron rotates with spring.
- Side-by-side on desktop, unified on mobile; transition between them with a view transition on web.

**Permission prompts**

- Slide the composer up into a permission bar (shared element: the composer _becomes_ the prompt), Approve/Deny with keyboard hints. Approve: fast collapse back into composer. Avoid modal dialogs that hide context.

**Composer**

- Send: message bubble morphs from the composer position into the transcript (FLIP from input rect), optimistic with pending opacity.
- Stop button replaces send with a crossfade + subtle rotate, and holds the same footprint.
- Voice: input waveform driven by mic level with Reanimated shared values; no decorative orbs.

**Transcript navigation**

- Mini-map rail on desktop showing user turns, tool calls (dots) and errors (red ticks) — click to jump with a short smooth scroll (or instant under reduced motion).
- "Jump to latest" pill shows count of new events while scrolled up.

**Agent identity**

- Each agent gets a hue from a fixed OKLCH ring (equal lightness, varied hue), used for its dot, cursor and card edge — consistent across sessions list, tabs and transcripts.

---

## 25. Suggested motion tokens

### Durations

| Token      | Value       | Use                                                |
| ---------- | ----------- | -------------------------------------------------- |
| `instant`  | 0ms         | palette open/close, keyboard nav, frequent toggles |
| `fast`     | 100ms       | press feedback, hover tint, focus                  |
| `quick`    | 150ms       | tooltips, small popovers, menu enter               |
| `base`     | 200ms       | dropdowns, toasts, card expand (timing)            |
| `moderate` | 280ms       | dialogs, panels, diff hunk reveal                  |
| `slow`     | 400ms       | rare: onboarding, large route transitions          |
| `ambient`  | 1600–2000ms | loops: running dot breathing, thinking shimmer     |

Exit = ~75% of enter duration.

### Curves

| Token           | cubic-bezier              | Use                                    |
| --------------- | ------------------------- | -------------------------------------- |
| `ease-out`      | `0.23, 1, 0.32, 1`        | default enter/respond                  |
| `ease-out-soft` | `0.16, 1, 0.3, 1`         | larger surfaces                        |
| `ease-in-out`   | `0.77, 0, 0.175, 1`       | on-screen movement                     |
| `ease-in`       | `0.55, 0.085, 0.68, 0.53` | exits that leave completely (rare)     |
| `linear`        | —                         | progress loops, shimmer, spinners only |

### Springs

| Token            | Reanimated `{damping, stiffness, mass}` | Motion `{duration, bounce}` | Use                                        |
| ---------------- | --------------------------------------- | --------------------------- | ------------------------------------------ |
| `spring-snappy`  | `{20, 400, 1}`                          | `{0.2, 0}`                  | press release, toggles, small layout       |
| `spring-default` | `{26, 260, 1}`                          | `{0.35, 0}`                 | layout changes, card expand, tab indicator |
| `spring-gentle`  | `{30, 180, 1}`                          | `{0.5, 0}`                  | sheets, drawers, panels                    |
| `spring-bouncy`  | `{12, 200, 1}`                          | `{0.45, 0.25}`              | rare delight: agent finished pulse         |

(Values are starting points; tune visually with the frogg-web-debug frame sampler.)

### Other tokens

- `stagger`: 30ms per item, max 8 items.
- `press-scale`: 0.97 (buttons), 0.99 (cards).
- `enter-offset`: 4–8px translate; `enter-blur`: 4px (web only).
- `tooltip-delay`: 500ms, `tooltip-skip-delay`: 300ms.
- `spinner-delay`: 400ms, `spinner-min-visible`: 400ms.
- Reduced motion: map all translate/scale/springs → opacity with `fast`; disable `ambient` loops (keep static colour state).

---

## Sources

- Emil Kowalski — [animations.dev](https://animations.dev/), [Building an animation course](https://emilkowal.ski/ui/building-an-animation-course), [Building a toast component (Sonner)](https://emilkowal.ski/ui/building-a-toast-component), [Vaul](https://github.com/emilkowalski/vaul), [review-animations standards](https://github.com/emilkowalski/skills/blob/main/skills/review-animations/STANDARDS.md), [emil-design-eng skill](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md)
- Rauno Freiberg — [Web Interface Guidelines repo](https://github.com/raunofreiberg/interfaces), [interfaces.rauno.me](https://interfaces.rauno.me), [Invisible Details of Interaction Design](https://rauno.me/craft/interaction-design), [Sebastian De Deyne summary](https://sebastiandedeyne.com/rauno-web-interface-guidelines/)
- Vercel — [Geist design system](https://vercel.com/geist/introduction), [AI SDK `smoothStream`](https://ai-sdk.dev/docs/reference/ai-sdk-core/smooth-stream), [Streamdown](https://github.com/vercel/streamdown)
- Linear — [How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui)
- Raycast — [raycast.com/blog](https://www.raycast.com/blog)
- Arc / The Browser Company — [arc.net](https://arc.net)
- Apple — [HIG: Motion](https://developer.apple.com/design/human-interface-guidelines/motion), [WWDC18 Designing Fluid Interfaces](https://developer.apple.com/videos/play/wwdc2018/803/), [WWDC23 Animate with springs](https://developer.apple.com/videos/play/wwdc2023/10158/), [HIG: Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
- Material 3 — [Motion overview](https://m3.material.io/styles/motion/overview), [Easing and duration tokens](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs)
- Motion — [motion.dev docs](https://motion.dev/docs), [Layout animations](https://motion.dev/docs/react-layout-animations)
- Reanimated — [Layout animations](https://docs.swmansion.com/react-native-reanimated/docs/layout-animations/entering-exiting-animations), [withSpring](https://docs.swmansion.com/react-native-reanimated/docs/animations/withSpring), [Shared element transitions](https://docs.swmansion.com/react-native-reanimated/docs/shared-element-transitions/overview), [useReducedMotion](https://docs.swmansion.com/react-native-reanimated/docs/device/useReducedMotion)
- View Transitions — [MDN View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API), [Chrome for Developers guide](https://developer.chrome.com/docs/web-platform/view-transitions)
- CSS `linear()` easing — [Jake Archibald's generator](https://linear-easing-generator.netlify.app/)
- Radix — [Primitives animation guide](https://www.radix-ui.com/primitives/docs/guides/animation), [Radix Colors scale roles](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)
- shadcn/ui — [ui.shadcn.com](https://ui.shadcn.com); RN — [React Native Reusables](https://reactnativereusables.com), [rn-primitives](https://rnprimitives.com)
- cmdk — [github.com/pacocoursey/cmdk](https://github.com/pacocoursey/cmdk); Sonner — [sonner.emilkowal.ski](https://sonner.emilkowal.ski); sonner-native — [github.com/gunnartorfis/sonner-native](https://github.com/gunnartorfis/sonner-native)
- Aceternity UI — [ui.aceternity.com](https://ui.aceternity.com); Magic UI — [magicui.design](https://magicui.design)
- `@gorhom/bottom-sheet` — [gorhom.dev/react-native-bottom-sheet](https://gorhom.dev/react-native-bottom-sheet/); `expo-blur` — [docs.expo.dev/versions/latest/sdk/blur-view](https://docs.expo.dev/versions/latest/sdk/blur-view/)
- Electron — [BrowserWindow `vibrancy` / `backgroundMaterial`](https://www.electronjs.org/docs/latest/api/browser-window)
- `use-stick-to-bottom` — [github.com/stackblitz-labs/use-stick-to-bottom](https://github.com/stackblitz-labs/use-stick-to-bottom)
- Nielsen Norman Group — [Response time limits](https://www.nngroup.com/articles/response-times-3-important-limits/)
