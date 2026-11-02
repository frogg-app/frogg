const { test } = require("node:test");
const assert = require("node:assert/strict");
const { injectSplash } = require("./splash.cjs");

const INDEX = `<html><head><title>x</title></head><body><div id="root"></div><script defer></script></body></html>`;

test("paints the brand name inside #root before the bundle runs", () => {
  const html = injectSplash(INDEX, "Frogg Next");
  assert.match(html, /<div id="root"><div class="frogg-splash"[^>]*><span>Frogg Next<\/span>/);
  assert.match(html, /<style id="frogg-splash-style">[\s\S]*<\/style><\/head>/);
  // The script still follows the root, so the splash is in the first paint.
  assert.ok(html.indexOf('frogg-splash"') < html.indexOf("<script"));
});

test("escapes the brand name", () => {
  assert.match(injectSplash(INDEX, "A<b>&"), /<span>A&lt;b&gt;&amp;<\/span>/);
});

test("fails loudly when the export changes shape", () => {
  assert.throws(() => injectSplash("<html><head></head><body></body></html>", "x"));
});
