const { existsSync, statSync } = require("node:fs");
const path = require("node:path");

function resolveAsset(root, requestUrl) {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== "frogg-next:" || url.host !== "app") return null;
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes("\\") || pathname.includes("\0")) return null;
    if (pathname === "/") return path.join(root, "index.html");
    const asset = path.resolve(root, `.${pathname}`);
    if (!asset.startsWith(`${path.resolve(root)}${path.sep}`)) return null;
    if (existsSync(asset) && statSync(asset).isFile()) return asset;
    // Expo's single-page export handles routes in the renderer.
    return path.extname(pathname) ? null : path.join(root, "index.html");
  } catch {
    return null;
  }
}

module.exports = { resolveAsset };
