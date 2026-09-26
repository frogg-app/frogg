import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { root, outputRoot, uiOutput, type BrandBuild } from "./resolve.mjs";

function ico(images: Buffer[]): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    const size = [16, 32, 48, 64, 128, 256][index];
    header[entry] = size % 256;
    header[entry + 1] = size % 256;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  return Buffer.concat([header, ...images]);
}

async function resize(source: string, size: number): Promise<Buffer> {
  return sharp(source)
    .resize(size, size, { fit: "contain", background: "#00000000" })
    .png()
    .toBuffer();
}

/**
 * The beta build's icons carry a "BETA" ribbon across the lower edge, so the two installs are
 * told apart at a glance in a dock, taskbar, launcher or browser tab.
 */
export function betaBadgeSvg(size: number, safeZone = 0): Buffer {
  // Adaptive launcher icons crop to the centre; keep the ribbon inside that safe zone.
  const inset = Math.round(size * safeZone);
  const width = size - inset * 2;
  const height = Math.round(width * 0.24);
  const top = size - inset - height;
  const font = Math.round(height * 0.62);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect x="${inset}" y="${top}" width="${width}" height="${height}" rx="${Math.round(height * 0.3)}" fill="#f59e0b"/>` +
      `<text x="${size / 2}" y="${top + height / 2}" dy="0.35em" text-anchor="middle" ` +
      `font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-weight="700" ` +
      `font-size="${font}" letter-spacing="${Math.round(font * 0.08)}" fill="#1c1917">BETA</text></svg>`,
  );
}

async function withBetaBadge(source: string | Buffer, size: number, safeZone = 0): Promise<Buffer> {
  const base = await sharp(source)
    .resize(size, size, { fit: "contain", background: "#00000000" })
    .png()
    .toBuffer();
  return sharp(base)
    .composite([{ input: betaBadgeSvg(size, safeZone) }])
    .png()
    .toBuffer();
}

/** Badged copies of the colour artwork; the notification icon is a mask and stays plain. */
async function channelAssetFiles(build: BrandBuild): Promise<BrandBuild["assetFiles"]> {
  if (!build.brand.channelBadge) return build.assetFiles;
  const directory = path.join(outputRoot, "channel-assets");
  await mkdir(directory, { recursive: true });
  const files: BrandBuild["assetFiles"] = { ...build.assetFiles };
  for (const [key, file] of Object.entries(build.assetFiles)) {
    if (key === "notification") continue;
    // The stock artwork is framed for mobile safe zones; badge the mark, not the padding.
    const source =
      build.brand.stockFrogg && key === "icon"
        ? await sharp(file).trim({ threshold: 1 }).png().toBuffer()
        : file;
    const target = path.join(directory, `${key}.png`);
    await writeFile(target, await withBetaBadge(source, 1024, key === "foreground" ? 0.2 : 0));
    files[key] = target;
  }
  return files;
}

export async function generateAssets(input: BrandBuild): Promise<void> {
  const assets = path.join(uiOutput, "assets");
  const publicDir = path.join(uiOutput, "public");
  const icons = path.join(outputRoot, "icons");
  await Promise.all([assets, publicDir, icons].map((dir) => mkdir(dir, { recursive: true })));
  await validateAssets(input);
  const build = { ...input, assetFiles: await channelAssetFiles(input) };
  const sources = {
    "icon.png": "icon",
    "icon-ios.png": "ios",
    "android-icon-foreground.png": "foreground",
    "notification-icon.png": "notification",
    "splash-icon.png": "splash",
  };
  for (const [name, key] of Object.entries(sources)) {
    const size = key === "notification" ? 96 : 1024;
    const source = build.assetFiles[key] ?? build.assetFiles.icon;
    if (build.brand.legacyFrogg) {
      await cp(source, path.join(assets, name));
    } else if (key === "notification" && !build.assetFiles.notification) {
      const mask = await resize(source, size);
      await sharp({ create: { width: size, height: size, channels: 4, background: "#ffffff" } })
        .composite([{ input: mask, blend: "dest-in" }])
        .png()
        .toFile(path.join(assets, name));
    } else {
      const pipeline = sharp(source).resize(size, size, {
        fit: "contain",
        background: "#00000000",
      });
      if (key === "ios") pipeline.flatten({ background: build.brand.colors.light.background });
      await pipeline.png().toFile(path.join(assets, name));
    }
  }
  await generateFavicons(build, assets);
  if (build.brand.legacyFrogg) {
    for (const name of [
      "favicon.ico",
      "apple-touch-icon.png",
      "pwa-icon-192.png",
      "pwa-icon-512.png",
    ]) {
      await cp(path.join(root, "apps/ui/public", name), path.join(publicDir, name));
    }
    await cp(
      path.join(root, "apps/ui/assets/images/favicon.png"),
      path.join(assets, "favicon.png"),
    );
  } else {
    await writeFile(
      path.join(publicDir, "favicon.ico"),
      ico(
        await Promise.all(
          [16, 32, 48, 64, 128, 256].map((size) => resize(build.assetFiles.icon, size)),
        ),
      ),
    );
    for (const [name, size] of Object.entries({
      "apple-touch-icon.png": 180,
      "pwa-icon-192.png": 192,
      "pwa-icon-512.png": 512,
    })) {
      // Separate maskable artwork leaves the required safe zone around the mark.
      await sharp({
        create: {
          width: size,
          height: size,
          channels: 4,
          background: build.brand.colors.dark.background,
        },
      })
        .composite([{ input: await resize(build.assetFiles.icon, Math.floor(size * 0.8)) }])
        .png()
        .toFile(path.join(publicDir, name));
    }
    await writeFile(path.join(assets, "favicon.png"), await resize(build.assetFiles.icon, 64));
  }
  await generateDesktopIcons(build, icons);
  await mkdir(path.join(publicDir, "brand"), { recursive: true });
  for (const appearance of ["light", "dark"]) {
    for (const status of ["", "-running", "-attention"]) {
      const name = `favicon-${appearance}${status}.png`;
      await cp(path.join(assets, name), path.join(publicDir, "brand", name));
    }
  }
  const requires = Object.keys(sources).concat([
    "favicon.png",
    ...["light", "dark"].flatMap((mode) =>
      ["", "-running", "-attention"].map((status) => `favicon-${mode}${status}.png`),
    ),
  ]);
  await writeFile(
    path.join(uiOutput, "assets.ts"),
    `// Generated by brand:prepare.\nexport const brandAssets = {\n${requires.map((name) => `  ${JSON.stringify(name)}: require(${JSON.stringify(`./assets/${name}`)}),`).join("\n")}\n};\n`,
  );
  const template = await readFile(path.join(root, "apps/ui/public/index.html"), "utf8");
  await writeFile(path.join(publicDir, "index.html"), template);
}

async function generateDesktopIcons(build: BrandBuild, icons: string): Promise<void> {
  // Mobile artwork includes a safe zone that makes the desktop taskbar mark too small.
  // Ignore near-transparent source noise when finding the stock mark bounds.
  // Custom brands retain their chosen artwork framing.
  const source = build.brand.legacyFrogg
    ? await sharp(build.assetFiles.icon).trim({ threshold: 1 }).png().toBuffer()
    : build.assetFiles.icon;
  const render = async (size: number): Promise<Buffer> => {
    const inset = build.brand.stockFrogg ? Math.max(1, Math.round(size * 0.01)) : 0;
    return sharp(source)
      .resize(size - inset * 2, size - inset * 2, { fit: "contain", background: "#00000000" })
      .extend({ top: inset, bottom: inset, left: inset, right: inset, background: "#00000000" })
      .png()
      .toBuffer();
  };
  for (const [name, size] of Object.entries({
    "32x32.png": 32,
    "64x64.png": 64,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 1024,
  })) {
    await writeFile(path.join(icons, name), await render(size));
  }
  const icon = ico(await Promise.all([16, 32, 48, 64, 128, 256].map((size) => render(size))));
  await writeFile(path.join(icons, "icon.ico"), icon);
  const chunks = [];
  for (const [type, size] of Object.entries({ ic07: 128, ic08: 256, ic09: 512, ic10: 1024 })) {
    const png = await render(size);
    const header = Buffer.alloc(8);
    header.write(type);
    header.writeUInt32BE(png.length + 8, 4);
    chunks.push(header, png);
  }
  const header = Buffer.alloc(8);
  header.write("icns");
  header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4);
  await writeFile(path.join(icons, "icon.icns"), Buffer.concat([header, ...chunks]));
}

export async function validateAssets(build: BrandBuild): Promise<void> {
  const metadata = await sharp(build.assetFiles.icon).metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width !== metadata.height ||
    metadata.width < 1024
  ) {
    throw new Error(
      "assets.icon must be a square image at least 1024 × 1024 pixels (or a 1024-square SVG)",
    );
  }
}

async function generateFavicons(build: BrandBuild, assets: string): Promise<void> {
  for (const appearance of ["light", "dark"] as const) {
    for (const status of ["", "-running", "-attention"]) {
      const name = `favicon-${appearance}${status}.png`;
      if (build.brand.legacyFrogg) {
        await cp(path.join(root, "apps/ui/assets/images", name), path.join(assets, name));
      } else {
        const source =
          appearance === "light" ? build.assetFiles.faviconLight : build.assetFiles.faviconDark;
        const image = sharp(await resize(source ?? build.assetFiles.icon, 64));
        if (status) {
          const fill = status === "-running" ? "#2563eb" : "#d97706";
          const badge = Buffer.from(
            `<svg width="64" height="64"><circle cx="50" cy="50" r="12" fill="${fill}" stroke="white" stroke-width="3"/></svg>`,
          );
          image.composite([{ input: badge }]);
        }
        await image.png().toFile(path.join(assets, name));
      }
    }
  }
}
