// ナレッジ（Googleスプレッドシートの指定1シート）の読み込み・キャッシュ
import { env } from "./env";
import { gasRequest, sheetsGetValues } from "./google";
import { getLocalKnowledge } from "./store";
import type { KnowledgeEntry, KnowledgeSnapshot, KnowledgeSource } from "./types";

interface Cache {
  snapshot: KnowledgeSnapshot;
  expires: number;
}
const g = globalThis as unknown as { __knowledgeCache?: Cache | null };

export const SOURCE_LABEL: Record<KnowledgeSource, string> = {
  sheets_api: "Googleスプレッドシート（Sheets API）",
  gas: "Googleスプレッドシート（GAS連携）",
  csv: "Googleスプレッドシート（公開CSV）",
  local: "ローカルのサンプルナレッジ（シート未接続）",
};

/** RFC4180 準拠の簡易CSVパーサ（改行・引用符対応） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function splitKeywords(s: string): string[] {
  return s
    .split(/[、,，/／;；|｜\n\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

const HEADER_MAP: { key: keyof KnowledgeEntry; patterns: RegExp }[] = [
  { key: "category", patterns: /(カテゴリ|分類|区分|category)/i },
  { key: "title", patterns: /(質問|項目|タイトル|見出し|件名|title|question)/i },
  { key: "content", patterns: /(回答|内容|本文|説明|answer|content)/i },
  { key: "keywords", patterns: /(キーワード|検索語|タグ|keyword|tag)/i },
  { key: "note", patterns: /(備考|メモ|注意|note)/i },
];

/** シートの行配列をナレッジに変換。1行目がヘッダーなら列名で判定、なければ列順で判定 */
export function rowsToEntries(rows: string[][]): KnowledgeEntry[] {
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => (h ?? "").trim());
  const colIndex: Partial<Record<keyof KnowledgeEntry, number>> = {};
  let headerMatched = 0;
  header.forEach((h, i) => {
    for (const { key, patterns } of HEADER_MAP) {
      if (colIndex[key] === undefined && patterns.test(h)) {
        colIndex[key] = i;
        headerMatched++;
        break;
      }
    }
  });
  let body = rows;
  if (headerMatched >= 2) {
    body = rows.slice(1);
  } else {
    const n = header.length;
    if (n >= 4) Object.assign(colIndex, { category: 0, title: 1, content: 2, keywords: 3, note: 4 });
    else if (n === 3) Object.assign(colIndex, { category: 0, title: 1, content: 2 });
    else Object.assign(colIndex, { title: 0, content: 1 });
  }
  const pick = (r: string[], key: keyof KnowledgeEntry) => {
    const i = colIndex[key];
    return i === undefined ? "" : (r[i] ?? "").toString().trim();
  };
  const entries: KnowledgeEntry[] = [];
  body.forEach((r, idx) => {
    const title = pick(r, "title");
    const content = pick(r, "content");
    if (!title && !content) return;
    entries.push({
      id: `s${String(idx + 1).padStart(3, "0")}`,
      category: pick(r, "category") || "その他",
      title: title || content.slice(0, 30),
      content: content || title,
      keywords: splitKeywords(pick(r, "keywords")),
      note: pick(r, "note") || undefined,
    });
  });
  return entries;
}

interface RemoteResult {
  entries: KnowledgeEntry[];
  source: KnowledgeSource;
  sheetName?: string;
}

export function remoteKnowledgeConfigured(): boolean {
  return (
    (env.hasServiceAccount && env.knowledgeSheetId !== "") || env.gasWebhookUrl !== "" || env.knowledgeCsvUrl !== ""
  );
}

async function loadRemote(errors: string[]): Promise<RemoteResult | null> {
  if (env.hasServiceAccount && env.knowledgeSheetId) {
    try {
      const rows = await sheetsGetValues(env.knowledgeSheetId, `${env.knowledgeSheetName}!A1:F2000`);
      const entries = rowsToEntries(rows);
      if (entries.length > 0) return { entries, source: "sheets_api", sheetName: env.knowledgeSheetName };
      errors.push("Sheets API: 対象シートにデータがありません");
    } catch (e) {
      errors.push(`Sheets API: ${(e as Error).message}`);
    }
  }
  if (env.gasWebhookUrl) {
    try {
      const json = await gasRequest<{
        ok?: boolean;
        rows?: string[][];
        entries?: KnowledgeEntry[];
        error?: string;
        sheet?: string;
      }>({ action: "knowledge", sheet: env.knowledgeSheetName }, "GET");
      if (json.error) throw new Error(json.error);
      const entries = json.entries && json.entries.length > 0 ? json.entries : rowsToEntries(json.rows ?? []);
      if (entries.length > 0) return { entries, source: "gas", sheetName: json.sheet ?? env.knowledgeSheetName };
      errors.push("GAS: 対象シートにデータがありません");
    } catch (e) {
      errors.push(`GAS: ${(e as Error).message}`);
    }
  }
  if (env.knowledgeCsvUrl) {
    try {
      const res = await fetch(env.knowledgeCsvUrl, { cache: "no-store", redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const entries = rowsToEntries(parseCsv(await res.text()));
      if (entries.length > 0) return { entries, source: "csv", sheetName: env.knowledgeSheetName };
      errors.push("CSV: データがありません");
    } catch (e) {
      errors.push(`CSV: ${(e as Error).message}`);
    }
  }
  return null;
}

export async function getKnowledge(force = false): Promise<KnowledgeSnapshot> {
  const now = Date.now();
  if (!force && g.__knowledgeCache && g.__knowledgeCache.expires > now) return g.__knowledgeCache.snapshot;

  const errors: string[] = [];
  const remote = remoteKnowledgeConfigured() ? await loadRemote(errors) : null;
  let snapshot: KnowledgeSnapshot;
  if (remote) {
    snapshot = {
      entries: remote.entries,
      source: remote.source,
      sourceLabel: SOURCE_LABEL[remote.source],
      sheetName: remote.sheetName,
      fetchedAt: new Date(now).toISOString(),
      warning: errors.length ? errors.join(" / ") : undefined,
    };
  } else {
    const local = await getLocalKnowledge();
    snapshot = {
      entries: local,
      source: "local",
      sourceLabel: SOURCE_LABEL.local,
      fetchedAt: new Date(now).toISOString(),
      warning: errors.length ? `シート読込に失敗したためローカルナレッジを使用中: ${errors.join(" / ")}` : undefined,
    };
  }
  g.__knowledgeCache = { snapshot, expires: now + env.knowledgeCacheSeconds * 1000 };
  return snapshot;
}

export function invalidateKnowledgeCache(): void {
  g.__knowledgeCache = null;
}

/** プロンプトに埋め込む用のテキスト化（長すぎる場合は切り詰め） */
export function knowledgeToPromptText(entries: KnowledgeEntry[], maxChars = 16000): string {
  const blocks = entries.map((e, i) => `${i + 1}. 【${e.category}】${e.title}\n${e.content}`);
  let out = "";
  for (const b of blocks) {
    if (out.length + b.length + 2 > maxChars) {
      out += "\n（以降省略：search_knowledge で検索可能）";
      break;
    }
    out += (out ? "\n\n" : "") + b;
  }
  return out;
}
