import { error, json, requireAdmin } from "@/lib/http";
import { analyze, extract, type AnalysisResult } from "@/lib/ingest";
import { invalidateKnowledgeCache } from "@/lib/knowledge";
import { categoryOf, UPLOAD_MAX_BYTES } from "@/lib/knowledge-categories";
import { createSource, entryToRow, getSource, insertRows, listSources, replaceManual, rowToEntry, updateSource } from "@/lib/knowledge-db";
import { ensureBucket, storageUpload, supabaseReady } from "@/lib/supabase";
import type { KnowledgeSourceRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const notReady = () => error("Supabase のセットアップが必要です（管理画面の「セットアップ」をご確認ください）", 503, { setupRequired: true });

/** 追加した情報・アップロードしたファイルの一覧（新しい順） */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!(await supabaseReady())) return notReady();
  return json({ ok: true, sources: await listSources(200) });
}

function safeName(name: string): string {
  const base = name.normalize("NFKC").replace(/[\\/:*?"<>|\s]+/g, "_").slice(-80);
  return base || "file";
}

/**
 * 情報の追加：文章（text）またはファイル（file）を受け取り、解析して Supabase に保存する。
 * multipart/form-data：category（プルダウンの値）・text・file
 */
export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!(await supabaseReady())) return notReady();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return error("送信内容を読み取れませんでした（ファイルは 4MB までです）", 400);
  }
  const category = categoryOf(String(form.get("category") ?? "auto")).value;
  const text = String(form.get("text") ?? "").trim().slice(0, 60_000);
  const fileField = form.get("file");
  const file = fileField instanceof File && fileField.size > 0 ? fileField : null;
  if (!text && !file) return error("内容を入力するか、ファイルを選んでください");
  if (file && file.size > UPLOAD_MAX_BYTES) return error("ファイルは 4MB までです。分けてアップロードしてください", 413);
  if (category === "price_manual" && (!file || !/\.(xlsx|xlsm|csv)$/i.test(file.name))) {
    return error("「料金表・顧客対応マニュアル」は Excel（.xlsx）または CSV ファイルをアップロードしてください");
  }

  const firstLine = text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
  const source = await createSource({
    kind: file ? "file" : "text",
    name: file ? file.name.slice(0, 200) : firstLine.slice(0, 60) || "手入力",
    mime: file?.type || (file ? "application/octet-stream" : "text/plain"),
    size: file ? file.size : text.length,
    category,
    excerpt: file ? null : text.slice(0, 300),
  });

  try {
    let result: AnalysisResult;
    let storagePath: string | null = null;
    if (file) {
      const data = new Uint8Array(await file.arrayBuffer());
      // 原本を Storage に保存（失敗しても解析は続ける）
      try {
        await ensureBucket();
        storagePath = `${source.id}/${safeName(file.name)}`;
        await storageUpload(storagePath, data, file.type || "application/octet-stream");
      } catch {
        storagePath = null;
      }
      result = await analyze({ extracted: extract(file.name, file.type, data), name: file.name, category, note: text || undefined });
    } else {
      result = await analyze({ extracted: { kind: "text", text }, name: source.name, category });
    }

    let count = 0;
    if (result.manual) {
      count = await replaceManual(source.id, result.manual);
    } else {
      const short = source.id.replace(/-/g, "").slice(0, 8);
      const origin = file ? "upload" : "admin";
      const base = file ? 500 : 100;
      const rows = result.entries.map((e, i) => {
        const id = `${file ? "u" : "a"}-${short}-${String(i + 1).padStart(2, "0")}`;
        return entryToRow({ id, category: e.category, title: e.title, content: e.content, keywords: e.keywords, questions: e.questions }, origin, base + i, {
          source_id: source.id,
          price_table: e.table ? { ...e.table, id } : null,
        });
      });
      await insertRows(rows);
      count = rows.length;
    }
    const patch: Partial<KnowledgeSourceRecord> = {
      status: "done",
      entries_count: count,
      storage_path: storagePath,
      excerpt: (result.excerpt || text).slice(0, 300) || null,
      error: count === 0 ? "お客様対応に使える情報が見つかりませんでした" : (result.note ?? null),
    };
    await updateSource(source.id, patch);
    invalidateKnowledgeCache();
    const detail = await getSource(source.id);
    return json({ ok: true, source: detail.source, entries: detail.rows.map((r) => ({ ...rowToEntry(r), hasTable: Boolean(r.price_table) })), mode: result.mode, note: result.note });
  } catch (e) {
    const message = (e as Error).message.slice(0, 300);
    await updateSource(source.id, { status: "error", error: message }).catch(() => undefined);
    return error(`解析できませんでした：${message}`, 422, { source: { ...source, status: "error", error: message } });
  }
}
