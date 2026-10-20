// 一畳屋ホームページを学習して database/website.json を作り直す
// 使い方: npm run learn:site     （Node 22.18 以降 / 24 で実行。src/lib/site-learn.ts をそのまま読み込みます）
import { writeFileSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";

const root = process.cwd();
const { learnWebsite } = await import(pathToFileURL(path.join(root, "src/lib/site-learn.ts")).href);
const result = await learnWebsite();
for (const p of result.pages) console.log(`${p.path.padEnd(10)} ${p.label.padEnd(12)} ${p.error ? `失敗: ${p.error}` : `${p.entries} 件`}`);
if (result.entries.length === 0) {
  console.error("学習できたページがないため、database/website.json は更新しませんでした");
  process.exit(1);
}
const file = path.join(root, "database", "website.json");
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`→ ${path.relative(root, file)}（${result.entries.length} 件）`);
