// What the packaged app (app.asar) must contain, and a check that it does. main.cjs and
// preload.cjs are bundled, so their local requires are inlined; what remains are files they
// open at run time by `__dirname` path, which have to be shipped beside them. 1.6.14-beta.1
// crashed on launch because one such file was left out.
const ENTRY_POINTS = ["main.cjs", "preload.cjs"];
const PACKAGED_FILES = [
  ...ENTRY_POINTS,
  "identity.json",
  "web/**/*",
  "package.json",
  "LICENSE",
  "NOTICE",
];

/** Local files a script loads at run time: `require("./x")` and `path.join(__dirname, "x")`. */
function runtimeReferences(source) {
  const found = new Set();
  for (const match of source.matchAll(/require\(\s*["']\.\/([^"']+)["']\s*\)/g))
    found.add(match[1]);
  for (const match of source.matchAll(/\(\s*__dirname\s*,\s*["']([^"']+)["']/g))
    found.add(match[1]);
  return [...found].map((file) => file.replace(/^\.\//, ""));
}

/** True when a packaged path (forward slashes, no leading slash) matches a `files` entry. */
function isPackaged(file, files = PACKAGED_FILES) {
  return files.some((pattern) =>
    pattern.endsWith("/**/*")
      ? file.startsWith(pattern.slice(0, -4)) || file === pattern.slice(0, -5)
      : file === pattern,
  );
}

/**
 * Files the app needs that the package lacks. `entries` lists the asar's paths; `read` returns a
 * packaged file's text. Directories referenced by `__dirname` (the web root) count when any file
 * sits under them.
 */
function missingFromPackage(entries, read) {
  const have = new Set(entries.map((e) => e.replace(/\\/g, "/").replace(/^\//, "")));
  const present = (file) => have.has(file) || [...have].some((e) => e.startsWith(`${file}/`));
  const missing = ENTRY_POINTS.filter((entry) => !have.has(entry));
  for (const entry of ENTRY_POINTS.filter((e) => have.has(e))) {
    for (const ref of runtimeReferences(read(entry)))
      if (!present(ref)) missing.push(`${ref} (used by ${entry})`);
  }
  return missing;
}

module.exports = {
  ENTRY_POINTS,
  PACKAGED_FILES,
  isPackaged,
  missingFromPackage,
  runtimeReferences,
};
