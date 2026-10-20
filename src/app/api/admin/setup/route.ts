import { error, json, requireAdmin } from "@/lib/http";
import { getKnowledge, invalidateKnowledgeCache } from "@/lib/knowledge";
import { syncBundled } from "@/lib/knowledge-db";
import { ensureBucket, supabaseProjectRef, supabaseState } from "@/lib/supabase";
import { SCHEMA_SQL } from "@/lib/supabase-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function describe(state: Awaited<ReturnType<typeof supabaseState>>) {
  const ref = supabaseProjectRef();
  return {
    ok: true,
    supabase: state,
    projectRef: ref,
    sqlEditorUrl: ref ? `https://supabase.com/dashboard/project/${ref}/sql/new` : "https://supabase.com/dashboard",
    tableEditorUrl: ref ? `https://supabase.com/dashboard/project/${ref}/editor` : "https://supabase.com/dashboard",
    sql: SCHEMA_SQL,
  };
}

/** Supabase の接続状況と、テーブルを作る SQL */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return json(describe(await supabaseState(true)));
}

/** 接続を確認し、使えるならファイルの保存先を用意して同梱のナレッジを取り込む */
export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const state = await supabaseState(true);
  if (!state.ready) return json(describe(state));
  try {
    await ensureBucket();
    const sync = await syncBundled(true);
    invalidateKnowledgeCache();
    const snapshot = await getKnowledge(true);
    return json({ ...describe(state), sync, entries: snapshot.entries.length, source: snapshot.source });
  } catch (e) {
    return error(`初期設定に失敗しました：${(e as Error).message}`, 500);
  }
}
