// システムのエラーを 1 か所に記録する（管理画面の「エラー履歴」）
//   OpenAI・音声（Realtime）・LINE・スプレッドシート・電話などで起きたエラーを新しい順に最大 200 件
//   同じエラーが続いたときは 1 件にまとめて回数を数える。記録に失敗しても本来の処理は止めない
import type { ErrorLogItem, ErrorSource } from "./errorlog-types";
import { readCollection, writeCollection } from "./store";
import { truncate } from "./utils";

export { ERROR_SOURCE_LABEL, type ErrorLogItem, type ErrorSource } from "./errorlog-types";

const MAX = 200;
const MERGE_MS = 10 * 60 * 1000;
let queue: Promise<void> = Promise.resolve();

/** エラーを記録する（await すると保存まで待つ。サーバーレスでは await を推奨） */
export function logError(source: ErrorSource, where: string, err: unknown): Promise<void> {
  const message = truncate(err instanceof Error ? err.message : String(err ?? ""), 300) || "（内容なし）";
  console.error(`[error:${source}] ${where}: ${message}`);
  queue = queue
    .then(async () => {
      const now = new Date().toISOString();
      const cur = ((await readCollection<ErrorLogItem[]>("error_log")) ?? []).slice();
      const head = cur[0];
      if (head && head.source === source && head.where === where && head.message === message && Date.now() - Date.parse(head.at) < MERGE_MS) {
        cur[0] = { ...head, at: now, count: (head.count ?? 1) + 1 };
      } else {
        cur.unshift({ at: now, source, where: truncate(where, 80), message });
      }
      await writeCollection("error_log", cur.slice(0, MAX));
    })
    .catch(() => undefined);
  return queue;
}

export async function listErrors(): Promise<ErrorLogItem[]> {
  await queue;
  return (await readCollection<ErrorLogItem[]>("error_log")) ?? [];
}

export async function clearErrors(): Promise<void> {
  await queue;
  await writeCollection("error_log", []);
}
