// AI の利用状況（回答の出どころの件数・OpenAI のトークン数）を日別に記録する
//   管理画面の「AIの利用状況」に表示し、学習済みナレッジで答えた割合とトークン使用量を確認できるようにする
import { readCollection, writeCollection } from "./store";

export type AnswerOriginKind = "local" | "cache" | "openai" | "notfound" | "smalltalk" | "demo";

export interface DailyUsage {
  answers: Record<AnswerOriginKind, number>;
  tokens: { prompt: number; completion: number; embedding: number };
  calls: Record<string, number>;
}

type UsageBook = Record<string, DailyUsage>;

const KEEP_DAYS = 31;

function today(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}

function empty(): DailyUsage {
  return {
    answers: { local: 0, cache: 0, openai: 0, notfound: 0, smalltalk: 0, demo: 0 },
    tokens: { prompt: 0, completion: 0, embedding: 0 },
    calls: {},
  };
}

// 同時に書き込むと取りこぼすため、1 プロセス内では順番に更新する
let queue: Promise<void> = Promise.resolve();

function update(fn: (d: DailyUsage) => void): Promise<void> {
  queue = queue
    .then(async () => {
      const book = (await readCollection<UsageBook>("usage")) ?? {};
      const key = today();
      const d = book[key] ?? empty();
      fn(d);
      book[key] = d;
      const keys = Object.keys(book).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete book[k];
      await writeCollection("usage", book);
    })
    .catch(() => {
      // 記録の失敗は応答に影響させない
    });
  return queue;
}

/** 1 件の回答がどこから作られたか */
export function recordAnswer(kind: AnswerOriginKind): Promise<void> {
  return update((d) => {
    d.answers[kind] = (d.answers[kind] ?? 0) + 1;
  });
}

/** OpenAI の呼び出し 1 回分 */
export function recordTokens(purpose: string, usage: { prompt?: number; completion?: number; embedding?: number }): Promise<void> {
  return update((d) => {
    d.calls[purpose] = (d.calls[purpose] ?? 0) + 1;
    d.tokens.prompt += usage.prompt ?? 0;
    d.tokens.completion += usage.completion ?? 0;
    d.tokens.embedding += usage.embedding ?? 0;
  });
}

export async function getUsage(days = 7): Promise<{ date: string; usage: DailyUsage }[]> {
  await queue;
  const book = (await readCollection<UsageBook>("usage")) ?? {};
  return Object.keys(book)
    .sort()
    .reverse()
    .slice(0, days)
    .map((date) => ({ date, usage: { ...empty(), ...book[date], answers: { ...empty().answers, ...book[date].answers } } }));
}
