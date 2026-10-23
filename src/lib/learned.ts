// 学習済みの回答（AI が一度作った回答を覚えておき、同じ質問には AI を使わずに答える：トークンの節約）と、
// AI が答えられなかった質問（マニュアルに書き足す候補）の記録
//   ・照合キーは、AI に渡す指示の全文（ルール・スプレッドシートの全文・数量の計算表）・回答のモデルと考える深さ・
//     お客様の質問（AI に渡す直近の質問すべて。言い回しの違い「ですか」「？」などはそろえる）から作る。
//     どれかが違えば別の質問として AI が答える → スプレッドシートを書き換える・回答の書き方を変える・モデルを変えると、
//     自動的に新しく答え直す
//   ・意味が近いだけの質問（「6枚」と「8枚」など）には使わない（金額を取り違えないため）
//   ・保存先：Redis（1 回答 1 キー・ANSWER_CACHE_DAYS 日で自動的に消える）。Redis がなければこのサーバーのメモリ
//   ・管理画面の一覧（learned）には、質問と回答の先頭だけを残す（再利用の回数は Redis の aic:answer-hits）
import { createHash } from "crypto";
import { env } from "./env";
import { kvCommand, kvConfigured, kvDeleteMatching, kvGet, kvPipeline, kvSet } from "./kv";
import { ANSWER_STYLE_VERSION } from "./prompts";
import { prepareStore, readCollection, writeCollection } from "./store";
import type { Channel } from "./types";

export interface LearnedAnswer {
  /** 照合キー（learnedKey） */
  key: string;
  /** お客様の質問（表示用） */
  question: string;
  answer: string;
  /** 根拠にした資料の項目（hash はスプレッドシートの版） */
  sources: { id: string; title: string; category?: string; hash: string }[];
  style: "text" | "voice";
  channel: Channel;
  createdAt: string;
  lastUsedAt: string;
  hits: number;
  /** 作ったときの回答の書き方の版（ANSWER_STYLE_VERSION） */
  version?: number;
  /** 作ったときのスプレッドシートの版（変わったら一覧に出さない。照合キーも変わるので使われない） */
  docVersion?: string;
}

export interface UnansweredQuestion {
  key: string;
  question: string;
  channel: Channel;
  firstAt: string;
  lastAt: string;
  count: number;
}

const MAX_LEARNED = 200;
const MAX_UNANSWERED = 200;
/** 管理画面の一覧に残す回答の長さ */
const PREVIEW_CHARS = 300;
/** Redis がないときにメモリに置く数 */
const MAX_MEMORY = 500;
const HITS_KEY = "aic:answer-hits";
const answerKey = (key: string) => `aic:answer:${key}`;
const ttlSeconds = () => Math.round(env.answerCacheDays * 86400);

const g = globalThis as unknown as { __learnedMemory?: Map<string, { answer: LearnedAnswer; expires: number }> };
const memory = (g.__learnedMemory ??= new Map());

/** 質問の言い回しの違い（です・ます・？・「教えてください」など）をそろえた照合キー */
export function questionKey(q: string): string {
  let s = q
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[、。，．,.!?！？「」『』（）()…・〜~ー-]/g, "");
  const tail = /(ですか|ますか|でしょうか|ください|下さい|ほしいです|欲しいです|教えて|知りたい|お願いします|おねがいします|ですね|ですよね|です|ます|かな|か|の|ね|よ|な)$/;
  for (let i = 0; i < 6 && tail.test(s); i++) s = s.replace(tail, "");
  return s;
}

/**
 * 学習済みの回答の照合キー。AI に渡す指示の全文（system）・モデル・考える深さ・お客様の質問がすべて同じときだけ同じになる
 * （AI に渡す会話のうち、お客様の発言だけを使う。AI の発言は、同じ質問なら同じ回答になるので含めない）
 */
export function learnedKey(parts: { model: string; effort?: string; system: string; questions: string[] }): string {
  return createHash("sha256")
    .update(JSON.stringify([ANSWER_STYLE_VERSION, parts.model, parts.effort ?? "", parts.system, parts.questions.map(questionKey)]))
    .digest("hex")
    .slice(0, 40);
}

let queue: Promise<void> = Promise.resolve();
function serial(fn: () => Promise<void>): Promise<void> {
  queue = queue.then(fn).catch(() => {});
  return queue;
}

/** 管理画面の一覧（今のスプレッドシートの版のものだけ。再利用の回数つき） */
export async function listLearned(docVersion?: string): Promise<LearnedAnswer[]> {
  await queue;
  const list = ((await readCollection<LearnedAnswer[]>("learned")) ?? []).filter(
    (x) => x.version === ANSWER_STYLE_VERSION && (!docVersion || x.docVersion === docVersion),
  );
  if (!list.length) return list;
  if (!kvConfigured()) return list.map((x) => ({ ...x, hits: memory.get(x.key)?.answer.hits ?? x.hits }));
  try {
    const flat = ((await kvCommand(["HGETALL", HITS_KEY])) as string[] | null) ?? [];
    const hits = new Map<string, number>();
    for (let i = 0; i + 1 < flat.length; i += 2) hits.set(flat[i], Number(flat[i + 1]) || 0);
    return list.map((x) => ({ ...x, hits: hits.get(x.key) ?? x.hits }));
  } catch {
    return list;
  }
}

/** 学習済みの回答を探す（なければ null。Redis が使えないときも null＝AI が答える） */
export async function findLearned(key: string): Promise<LearnedAnswer | null> {
  if (kvConfigured()) {
    try {
      await prepareStore();
      const raw = await kvGet(answerKey(key));
      if (!raw) return null;
      const hit = JSON.parse(raw) as LearnedAnswer;
      // 回数は待ってから返す（サーバーレスでは、応答のあとに残した処理が止められることがあるため）
      await kvCommand(["HINCRBY", HITS_KEY, key, "1"]).catch(() => {});
      return hit;
    } catch {
      return null;
    }
  }
  const m = memory.get(key);
  if (!m) return null;
  if (m.expires < Date.now()) {
    memory.delete(key);
    return null;
  }
  m.answer.hits += 1;
  m.answer.lastUsedAt = new Date().toISOString();
  return m.answer;
}

/** AI が作った回答を覚える（Redis には ANSWER_CACHE_DAYS 日。管理画面の一覧には先頭だけ） */
export async function saveLearned(a: Omit<LearnedAnswer, "createdAt" | "lastUsedAt" | "hits" | "version">): Promise<void> {
  const now = new Date().toISOString();
  const entry: LearnedAnswer = { ...a, question: a.question.slice(0, 300), answer: a.answer.slice(0, 8000), createdAt: now, lastUsedAt: now, hits: 0, version: ANSWER_STYLE_VERSION };
  if (kvConfigured()) {
    try {
      await prepareStore();
      await kvSet(answerKey(a.key), JSON.stringify(entry), ttlSeconds());
    } catch {
      return;
    }
  } else {
    memory.delete(a.key);
    memory.set(a.key, { answer: entry, expires: Date.now() + ttlSeconds() * 1000 });
    while (memory.size > MAX_MEMORY) memory.delete(memory.keys().next().value as string);
  }
  await serial(async () => {
    const cur = (await readCollection<LearnedAnswer[]>("learned")) ?? [];
    const cutoff = Date.now() - ttlSeconds() * 1000;
    // 一覧には、今のスプレッドシートの版・書き方の版で、期限内のものだけを残す
    const keep = cur.filter((x) => x.key !== a.key && x.version === ANSWER_STYLE_VERSION && x.docVersion === a.docVersion && Date.parse(x.createdAt) > cutoff);
    const next = [{ ...entry, answer: entry.answer.slice(0, PREVIEW_CHARS) }, ...keep].slice(0, MAX_LEARNED);
    const dropped = cur.filter((x) => !next.some((n) => n.key === x.key)).map((x) => x.key);
    if (dropped.length && kvConfigured()) await kvCommand(["HDEL", HITS_KEY, ...dropped]).catch(() => {});
    await writeCollection("learned", next);
  });
}

/** 学習済みの回答を消す（key=* ですべて）。次に同じ質問が来たら AI が答え直す */
export function deleteLearned(key: string): Promise<void> {
  return serial(async () => {
    const cur = (await readCollection<LearnedAnswer[]>("learned")) ?? [];
    if (kvConfigured()) {
      try {
        if (key === "*") {
          await kvDeleteMatching(answerKey("*"));
          await kvCommand(["DEL", HITS_KEY]);
        } else {
          await kvPipeline([
            ["DEL", answerKey(key)],
            ["HDEL", HITS_KEY, key],
          ]);
        }
      } catch {
        // 一覧からは消す（Redis の回答は期限で消える）
      }
    } else if (key === "*") memory.clear();
    else memory.delete(key);
    await writeCollection("learned", key === "*" ? [] : cur.filter((x) => x.key !== key));
  });
}

export async function listUnanswered(): Promise<UnansweredQuestion[]> {
  await queue;
  return (await readCollection<UnansweredQuestion[]>("unanswered")) ?? [];
}

export function logUnanswered(question: string, channel: Channel): Promise<void> {
  const key = questionKey(question);
  if (!key) return Promise.resolve();
  return serial(async () => {
    const cur = (await readCollection<UnansweredQuestion[]>("unanswered")) ?? [];
    const now = new Date().toISOString();
    const i = cur.findIndex((x) => x.key === key);
    if (i >= 0) cur[i] = { ...cur[i], count: cur[i].count + 1, lastAt: now, question };
    else cur.unshift({ key, question: question.slice(0, 300), channel, firstAt: now, lastAt: now, count: 1 });
    await writeCollection("unanswered", cur.slice(0, MAX_UNANSWERED));
  });
}

export function clearUnanswered(key?: string): Promise<void> {
  return serial(async () => {
    const cur = (await readCollection<UnansweredQuestion[]>("unanswered")) ?? [];
    await writeCollection("unanswered", key ? cur.filter((x) => x.key !== key) : []);
  });
}
