// 顧客対応マニュアル（Excel）を AI の回答情報源 database/manual.json に変換する
// 使い方: npm run knowledge:build                         （database/顧客対応マニュアル.xlsx のシート「ＡＩ相談ソース」）
//         npm run knowledge:build -- <Excelのパス> <シート名>
//   Node 22.18 以降 / 24 で実行（src/lib/xlsx.ts・manual.ts をそのまま読み込みます）
//   社内向けの行（思案中のメモ・原価など。database/manual-rules.json の規則）は JSON に入れず、件数だけを残します
import crypto from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";

const root = process.cwd();
const xlsxPath = path.resolve(root, process.argv[2] ?? "database/顧客対応マニュアル.xlsx");
const sheetName = process.argv[3] ?? "ＡＩ相談ソース";
const lib = (file) => import(pathToFileURL(path.join(root, "src/lib", file)).href);
const { readXlsx } = await lib("xlsx.ts");
const { DEFAULT_MANUAL_RULES, gridToManual } = await lib("manual.ts");

const rules = { ...DEFAULT_MANUAL_RULES, ...JSON.parse(readFileSync(path.join(root, "database", "manual-rules.json"), "utf8")) };
const buf = readFileSync(xlsxPath);
const sheets = readXlsx(buf);
const sheet = sheets.find((s) => s.name === sheetName) ?? sheets[0];
if (!sheet) {
  console.error(`シートがありません: ${xlsxPath}`);
  process.exit(1);
}
const manual = gridToManual(sheet.rows, rules);
if (manual.entries.length === 0) {
  console.error("ナレッジにできる内容がありませんでした。database/manual.json は更新していません");
  process.exit(1);
}

const body = {
  source: path.basename(xlsxPath),
  sheet: sheet.name,
  sourceSha1: crypto.createHash("sha1").update(buf).digest("hex").slice(0, 12),
  excludedCount: manual.excluded.length,
  // origin は読み込み時に付けるので保存しない
  entries: manual.entries.map(({ origin: _origin, ...e }) => e),
  tables: manual.tables,
};
const file = path.join(root, "database", "manual.json");
const prev = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
const same = prev && JSON.stringify({ ...prev, convertedAt: undefined }) === JSON.stringify({ ...body, convertedAt: undefined });

console.log(`${body.source}／シート「${body.sheet}」：文章 ${manual.entries.length - manual.tables.length} 件・料金表 ${manual.tables.length} 表`);
if (manual.excluded.length) {
  console.log(`社内向けとして除外（JSON には入れていません）：${manual.excluded.length} 行`);
  for (const line of manual.excluded) console.log(`  - ${line.slice(0, 60)}`);
}
if (same) {
  console.log(`→ 変更なし（${path.relative(root, file)} はそのまま）`);
} else {
  const { excludedCount, entries, tables, ...head } = body;
  writeFileSync(file, `${JSON.stringify({ ...head, convertedAt: new Date().toISOString(), excludedCount, entries, tables }, null, 2)}\n`);
  console.log(`→ ${path.relative(root, file)} を更新しました（${manual.entries.length} 件）。コミットして再デプロイすると AI の回答に反映されます`);
}
