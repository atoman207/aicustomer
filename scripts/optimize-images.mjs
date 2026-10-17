// public/images の JPEG を Web 向けに再圧縮し、OGP 画像を生成します（sharp は Next.js の依存として同梱）
// 使い方: node scripts/optimize-images.mjs
import { readdir, stat, rename } from "fs/promises";
import path from "path";
import sharp from "sharp";

const dir = path.resolve("public/images");
const MAX_WIDTH = { "hero-washitsu.jpg": 1920 };
const DEFAULT_MAX = 1600;

let before = 0;
let after = 0;
for (const file of (await readdir(dir)).filter((f) => f.endsWith(".jpg"))) {
  const src = path.join(dir, file);
  const sizeBefore = (await stat(src)).size;
  const tmp = `${src}.tmp`;
  await sharp(src)
    .rotate()
    .resize({ width: MAX_WIDTH[file] ?? DEFAULT_MAX, withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true, progressive: true })
    .toFile(tmp);
  const sizeAfter = (await stat(tmp)).size;
  if (sizeAfter < sizeBefore) {
    await rename(tmp, src);
    before += sizeBefore;
    after += sizeAfter;
    console.log(`${file}: ${(sizeBefore / 1024).toFixed(0)}KB → ${(sizeAfter / 1024).toFixed(0)}KB`);
  } else {
    await rename(tmp, `${src}.skip`).then(() => import("fs/promises").then((fs) => fs.unlink(`${src}.skip`)));
    before += sizeBefore;
    after += sizeBefore;
    console.log(`${file}: kept (${(sizeBefore / 1024).toFixed(0)}KB)`);
  }
}
console.log(`total: ${(before / 1024 / 1024).toFixed(2)}MB → ${(after / 1024 / 1024).toFixed(2)}MB`);

// OGP 画像（1200x630）
await sharp(path.join(dir, "hero-washitsu.jpg"))
  .resize(1200, 630, { fit: "cover", position: "attention" })
  .jpeg({ quality: 80, mozjpeg: true })
  .toFile(path.resolve("public/og.jpg"));
console.log("public/og.jpg generated");
