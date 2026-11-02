const { test } = require("node:test");
const assert = require("node:assert/strict");
const { injectSplash } = require("./splash.cjs");

const INDEX = `<html><head><title>x</title></head><body><div id="root"></div><script defer></script></body></html>`;

test("paints the brand name inside #root before the bundle runs", () => {
  const html = injectSplash(INDEX, "Frogg Next");
  assert.match(html, /<div id="root"><div class="frogg-splash"[^>]*><span>Frogg Next<\/span>/);
  assert.match(
    html,
    /<style id="frogg-splash-style">[\s\S]*<\/style><script id="frogg-splash-theme">/,
  );
  // The bundle's script still follows the root, so the splash is in the first paint.
  assert.ok(html.indexOf('frogg-splash"') < html.indexOf("<script defer"));
});

test("escapes the brand name", () => {
  assert.match(injectSplash(INDEX, "A<b>&"), /<span>A&lt;b&gt;&amp;<\/span>/);
});

test("fails loudly when the export changes shape", () => {
  assert.throws(() => injectSplash("<html><head></head><body></body></html>", "x"));
});

test("paints in the saved theme's shell colours before first paint", () => {
  const html = injectSplash(INDEX, "Frogg Next");
  assert.match(html, /html,body,#root\{background:var\(--fs-bg\)/);
  assert.match(
    html,
    /<script id="frogg-splash-theme">[^<]*frogg\.next\.chrome[^<]*<\/script><\/head>/,
  );
  // Material (the default theme) until the UI has saved anything.
  assert.match(html, /--fs-bg:#16181b/);
});
