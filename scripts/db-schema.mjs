// Supabase のテーブル定義（src/lib/supabase-schema.ts）を supabase/schema.sql に書き出す
// 使い方: npm run db:schema   （Node 22.18 以降 / 24。書き出した SQL を Supabase の SQL Editor で実行）
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";

const root = process.cwd();
const { SCHEMA_SQL } = await import(pathToFileURL(path.join(root, "src/lib/supabase-schema.ts")).href);
const file = path.join(root, "supabase", "schema.sql");
mkdirSync(path.dirname(file), { recursive: true });
writeFileSync(file, SCHEMA_SQL);
console.log(`→ ${path.relative(root, file)}（Supabase の SQL Editor に貼り付けて実行してください）`);
