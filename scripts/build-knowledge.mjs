// Googleスプレッドシート（顧客対応マニュアルのタブ）を読み込み、保存版 database/manual.json を作り直す
//   保存版は、スプレッドシートを読めないとき（Google の障害・共有の解除など）に AI が使う同じシートの写し
// 使い方: npm run knowledge:build                 （.env の GOOGLE_SERVICE_ACCOUNT_EMAIL・GOOGLE_PRIVATE_KEY・KNOWLEDGE_SHEET_ID・KNOWLEDGE_SHEET_GID）
//         npm run knowledge:build -- <Excelのパス> [シート名]   （スプレッドシートを Excel で書き出したファイルから作る場合）
//   Node 22.18 以降 / 24 で実行（src/lib の TypeScript をそのまま読み込みます）
//   社内向けの行（思案中のメモ・原価など。database/manual-rules.json の規則）は JSON に入れず、件数だけを残します
import crypto from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";

const root = process.cwd();
const lib = (file) => import(pathToFileURL(path.join(root, "src/lib", file)).href);

// .env を読む（npm run から直接実行するため。すでにある環境変数は上書きしない）
const envFile = path.join(root, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}

const { DEFAULT_MANUAL_RULES, gridToManual } = await lib("manual.ts");
const rules = { ...DEFAULT_MANUAL_RULES, ...JSON.parse(readFileSync(path.join(root, "database", "manual-rules.json"), "utf8")) };

let grid;
let source;
let sheetName;
let hashInput;
const xlsxArg = process.argv[2];
if (xlsxArg) {
  const { readXlsx } = await lib("xlsx.ts");
  const xlsxPath = path.resolve(root, xlsxArg);
  const buf = readFileSync(xlsxPath);
  const sheets = readXlsx(buf);
  const sheet = sheets.find((s) => s.name === (process.argv[3] ?? "ＡＩ相談ソース")) ?? sheets[0];
  if (!sheet) {
    console.error(`シートがありません: ${xlsxPath}`);
    process.exit(1);
  }
  grid = sheet.rows;
  source = path.basename(xlsxPath);
  sheetName = sheet.name;
  hashInput = buf;
} else {
  const { env } = await lib("env.ts");
  const { sheetsReadTab, sheetsListTabs } = await lib("google.ts");
  if (!env.hasServiceAccount || !env.knowledgeSheetId) {
    console.error("GOOGLE_SERVICE_ACCOUNT_EMAIL・GOOGLE_PRIVATE_KEY・KNOWLEDGE_SHEET_ID を .env に設定してください（または Excel のパスを指定）");
    process.exit(1);
  }
  let title;
  let tab;
  try {
    title = (await sheetsListTabs(env.knowledgeSheetId)).title;
    tab = await sheetsReadTab(env.knowledgeSheetId, { gid: env.knowledgeSheetGid, name: env.knowledgeSheetName });
  } catch (e) {
    console.error(`読み込めませんでした：${e.message}`);
    process.exit(1);
  }
  grid = tab.rows;
  source = `Googleスプレッドシート「${title}」`;
  sheetName = tab.title;
  hashInput = JSON.stringify(grid);
}

const manual = gridToManual(grid, rules);
if (manual.entries.length === 0) {
  console.error("ナレッジにできる内容がありませんでした。database/manual.json は更新していません");
  process.exit(1);
}

const body = {
  source,
  sheet: sheetName,
  sourceSha1: crypto.createHash("sha1").update(hashInput).digest("hex").slice(0, 12),
  excludedCount: manual.excluded.length,
  // origin は読み込み時に付けるので保存しない
  entries: manual.entries.map(({ origin: _origin, ...e }) => e),
  tables: manual.tables,
};
const out = path.join(root, "database", "manual.json");
const prev = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null;
const same = prev && JSON.stringify({ ...prev, convertedAt: undefined }) === JSON.stringify({ ...body, convertedAt: undefined });
if (same) {
  console.log(`変更なし（${out}）`);
} else {
  writeFileSync(out, `${JSON.stringify({ ...body, convertedAt: new Date().toISOString() }, null, 2)}\n`);
  console.log(`更新しました: ${out}`);
}
console.log(`読み込み元: ${source}／シート「${sheetName}」`);
console.log(`文章 ${manual.entries.length - manual.tables.length} 件・料金表 ${manual.tables.length} 表（${manual.tables.map((t) => `${t.title} ${t.rows.length}行`).join("・")}）`);
if (manual.excluded.length) {
  console.log(`社内向けとして除外した行：${manual.excluded.length} 行`);
  for (const line of manual.excluded) console.log(`  - ${line.slice(0, 80)}`);
}
