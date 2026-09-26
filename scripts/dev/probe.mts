// Drive the running `npm run preview` through a sequence of steps and print compact, text-only
// results: element boxes, computed styles, per-frame animation samples, screenshots and frame
// strips. Built for agents: one command replaces a throwaway Playwright script, and the output is
// a few lines instead of a page dump. Run `npm run probe -- --help` for usage.
import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Page } from "@playwright/test";
import { openPreview, readState, resolveRoute, root } from "./preview-page.mts";

const HELP = `npm run probe -- [target] [options] -s "<step>" [-s "<step>" ...]

Targets: chat | chat2 | settings[/x] | host[/x] | /route   (default: chat)

Options
  --width/--height <px>       viewport (default 1400x900)
  --mobile                    390x844 touch viewport
  --theme <dark|light>
  --chrome <windows|linux|mac>  reserve desktop window-control space (dev override)
  --bundle <text>             just check the served web bundle contains <text> (stale-code check)

Selectors: @id = [data-testid="id"], @id* = testID prefix, anything else is CSS.

Steps
  click <sel>                 click (waits 300ms after)
  hover <sel> | park          pointer over an element | pointer to the corner
  press <key>                 keyboard, e.g. Control+E
  wait <ms> | waitfor <sel>
  viewport <w>x<h>
  drag <sel> <dx> [dy] [hold] drag from an element's centre; "hold" keeps the button down
  move <dx> [dy]              move a held pointer relative to where the drag started
  release
  box <sel>                   x,y,w,h of every match
  style <sel> <prop,prop>     computed style of every match (w/h/x/y = box)
  text <sel>                  innerText of the first match
  eval <js>                   evaluate an expression, print JSON
  sample <sel> <props> <ms>   record props of every match each frame for <ms>, starting now;
                              printed (only changed rows) at the next "dump" or at the end
  dump
  shot <name> [sel|x,y,w,h]   PNG to .dev/shots/<name>.png
  frames <name> <n> [clip]    n rapid shots stacked into .dev/shots/<name>.png

Example (does the sidebar tab label ever show clipped while expanding?)
  npm run probe -- --chrome windows -s "click @workspace-explorer-toggle" \\
    -s "drag @workspace-explorer-sidebar-resize-handle 200 0 hold" -s "wait 500" \\
    -s "sample @explorer-sidebar-tab-* w,opacity 500" -s "move -100" -s "dump" -s release`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    width: { type: "string", default: "1400" },
    height: { type: "string", default: "900" },
    mobile: { type: "boolean", default: false },
    theme: { type: "string", default: "dark" },
    chrome: { type: "string" },
    bundle: { type: "string" },
    step: { type: "string", short: "s", multiple: true, default: [] },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

function css(selector: string): string {
  if (!selector.startsWith("@")) return selector;
  const id = selector.slice(1);
  return id.endsWith("*") ? `[data-testid^="${id.slice(0, -1)}"]` : `[data-testid="${id}"]`;
}

function parseClip(value: string | undefined) {
  if (!value || !/^\d+,\d+,\d+,\d+$/.test(value)) return null;
  const [x, y, width, height] = value.split(",").map(Number) as [number, number, number, number];
  return { x, y, width, height };
}

async function capture(page: Page, file: string, target: string | undefined): Promise<void> {
  const clip = parseClip(target);
  if (target && !clip) {
    await page.locator(css(target)).filter({ visible: true }).first().screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, clip: clip ?? undefined });
  }
}

// Runs in the page. Returns, per match, the requested props; w/h/x/y come from the box.
const READ_PROPS = `(sel, props) => [...document.querySelectorAll(sel)].map((el) => {
  const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  const box = { w: r.width, h: r.height, x: r.x, y: r.y };
  return props.map((p) => p in box ? Math.round(box[p]) : cs.getPropertyValue(p) || cs[p]);
})`;

async function checkBundle(text: string): Promise<void> {
  const state = await readState();
  const html = await (await fetch(state.localWebUrl)).text();
  const src = /src="([^"]*index\.ts\.bundle[^"]*)"/.exec(html)?.[1];
  if (!src) throw new Error("Could not find the bundle script tag");
  const bundle = await (
    await fetch(new URL(src.replaceAll("&amp;", "&"), state.localWebUrl))
  ).text();
  const hits = bundle.split("\n").filter((line) => line.includes(text));
  console.log(hits.length ? `found ${hits.length}x` : "NOT FOUND in served bundle");
  for (const line of hits.slice(0, 5)) console.log(`  ${line.trim().slice(0, 160)}`);
}

// oxlint-disable-next-line complexity -- flat step-verb dispatcher
async function main(): Promise<void> {
  if (values.bundle) return checkBundle(values.bundle);
  const target = positionals[0] ?? "chat";
  resolveRoute(target, await readState());
  const pageErrors: string[] = [];
  const { browser, page } = await openPreview({
    target,
    viewport: values.mobile
      ? { width: 390, height: 844 }
      : { width: Number(values.width), height: Number(values.height) },
    theme: values.theme === "light" ? "light" : "dark",
    mobile: values.mobile,
    query: values.chrome ? { chrome: values.chrome } : undefined,
    pageErrors,
  });
  await mkdir(path.join(root, ".dev/shots"), { recursive: true });
  let dragOrigin: { x: number; y: number } | null = null;
  let sampling: { sel: string; props: string[]; until: number } | null = null;

  const dump = async () => {
    if (!sampling) return;
    await page.waitForTimeout(Math.max(0, sampling.until - Date.now()) + 50);
    const rows = (await page.evaluate("window.__probeSamples")) as [number, unknown[][]][];
    console.log(`sample ${sampling.sel} [${sampling.props.join(",")}] per match; t=ms`);
    let last = "";
    for (const [t, matches] of rows) {
      const line = matches.map((m) => m.join(",")).join(" | ");
      if (line !== last) console.log(`  ${String(t).padStart(4)}  ${line}`);
      last = line;
    }
    sampling = null;
  };

  try {
    for (const step of values.step ?? []) {
      const [verb, ...args] = step.trim().split(/\s+/);
      const rest = step
        .trim()
        .slice((verb ?? "").length)
        .trim();
      const locate = (sel: string) => page.locator(css(sel)).filter({ visible: true }).first();
      switch (verb) {
        case "click":
          await locate(args[0]!).click({ timeout: 30_000 });
          await page.waitForTimeout(300);
          break;
        case "hover":
          await locate(args[0]!).hover({ timeout: 30_000 });
          break;
        case "park":
          await page.mouse.move(1, 1);
          break;
        case "press":
          await page.keyboard.press(args[0]!);
          break;
        case "wait":
          await page.waitForTimeout(Number(args[0]));
          break;
        case "waitfor":
          await locate(args[0]!).waitFor({ timeout: 30_000 });
          break;
        case "viewport": {
          const [w, h] = args[0]!.split("x").map(Number);
          await page.setViewportSize({ width: w!, height: h! });
          break;
        }
        case "drag": {
          const box = await locate(args[0]!).boundingBox();
          if (!box) throw new Error(`drag: ${args[0]} not found`);
          dragOrigin = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          const dx = Number(args[1] ?? 0);
          const dy = Number(args[2] ?? 0);
          await page.mouse.move(dragOrigin.x, dragOrigin.y);
          await page.mouse.down();
          // A small first move so drag handles register the gesture before the jump.
          await page.mouse.move(dragOrigin.x + Math.sign(dx) * 4, dragOrigin.y + Math.sign(dy) * 4);
          await page.waitForTimeout(50);
          await page.mouse.move(dragOrigin.x + dx, dragOrigin.y + dy, { steps: 4 });
          if (args[3] !== "hold") {
            await page.mouse.up();
            dragOrigin = null;
          }
          break;
        }
        case "move":
          if (!dragOrigin) throw new Error("move: no held drag");
          await page.mouse.move(
            dragOrigin.x + Number(args[0]),
            dragOrigin.y + Number(args[1] ?? 0),
          );
          break;
        case "release":
          await page.mouse.up();
          dragOrigin = null;
          break;
        case "box":
        case "style": {
          const props = verb === "box" ? ["x", "y", "w", "h"] : args[1]!.split(",");
          const out = (await page.evaluate(
            `(${READ_PROPS})(${JSON.stringify(css(args[0]!))}, ${JSON.stringify(props)})`,
          )) as unknown[][];
          console.log(
            `${verb} ${args[0]} [${props.join(",")}]: ${out.map((m) => m.join(",")).join(" | ") || "no match"}`,
          );
          break;
        }
        case "text":
          console.log(
            `text ${args[0]}: ${JSON.stringify(((await locate(args[0]!).innerText()) ?? "").slice(0, 300))}`,
          );
          break;
        case "eval":
          console.log(`eval: ${JSON.stringify(await page.evaluate(rest)).slice(0, 500)}`);
          break;
        case "sample": {
          await dump();
          const [sel, props, ms] = args as [string, string, string];
          sampling = { sel, props: props.split(","), until: Date.now() + Number(ms) };
          await page.evaluate(`(() => {
            const read = ${READ_PROPS}; const sel = ${JSON.stringify(css(sel))};
            const props = ${JSON.stringify(props.split(","))}; const t0 = performance.now();
            window.__probeSamples = [];
            const tick = () => {
              const t = Math.round(performance.now() - t0);
              window.__probeSamples.push([t, read(sel, props)]);
              if (t < ${Number(ms)}) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          })()`);
          break;
        }
        case "dump":
          await dump();
          break;
        case "shot": {
          const file = path.join(root, ".dev/shots", `${args[0]}.png`);
          await capture(page, file, args[1]);
          console.log(`shot ${file}`);
          break;
        }
        case "frames": {
          const [name, count, clip] = args as [string, string, string | undefined];
          const dir = path.join(root, ".dev/shots", `.${name}-frames`);
          await mkdir(dir, { recursive: true });
          const files: string[] = [];
          for (let i = 0; i < Number(count); i++) {
            const file = path.join(dir, `${i}.png`);
            await capture(page, file, clip);
            files.push(file);
          }
          const out = path.join(root, ".dev/shots", `${name}.png`);
          execFileSync("convert", [...files, "-append", out]);
          await rm(dir, { recursive: true });
          console.log(`frames ${out} (${count} stacked top-to-bottom)`);
          break;
        }
        default:
          throw new Error(`Unknown step "${step}". See npm run probe -- --help`);
      }
    }
    await dump();
    for (const message of pageErrors) console.error(`[page error] ${message}`);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
