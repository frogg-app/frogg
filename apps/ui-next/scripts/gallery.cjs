// Rebuilds design-exploration/mockups/ui-next/index.html from the shots, newest checkpoint first.
const fs = require("fs");
const path = require("path");
module.exports = (dir) => {
  const shots = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .sort();
  const tags = [...new Set(shots.map((f) => f.split("-")[0]))].sort().toReversed();
  let notes = {};
  try {
    notes = JSON.parse(fs.readFileSync(path.join(dir, "notes.json"), "utf8"));
  } catch {}
  const html = [
    `<!doctype html><meta charset=utf-8><title>Frogg ui-next progress</title><link rel=stylesheet href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Space+Grotesk:wght@600&display=swap"><style>body{background:#080b0d;color:#f2f6f7;font:14px Inter,system-ui;padding:24px 32px}h1{font:600 22px "Space Grotesk"}h2{font:600 16px "Space Grotesk";color:#7fd9e6;margin:36px 0 4px}p{color:#9aa6a9;margin:0 0 12px;max-width:900px}div{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}figure{margin:0}img{max-height:380px;border:1px solid #ffffff29}figcaption{font:11px monospace;color:#9aa6a9;margin-top:4px}</style>`,
    `<h1>apps/ui-next · build progress</h1><p>Live daemon data (mock provider). Newest checkpoint first; click a shot for full size.</p>`,
  ];
  for (const t of tags) {
    html.push(`<h2>Checkpoint ${t}</h2>${notes[t] ? `<p>${notes[t]}</p>` : ""}<div>`);
    for (const s of shots.filter((f) => f.startsWith(t + "-")))
      html.push(
        `<figure><a href="${s}"><img src="${s}" loading=lazy></a><figcaption>${s.slice(t.length + 1, -4)}</figcaption></figure>`,
      );
    html.push("</div>");
  }
  fs.writeFileSync(path.join(dir, "index.html"), html.join("\n"));
};
