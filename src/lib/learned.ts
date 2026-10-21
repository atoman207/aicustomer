// 学習済みの回答（OpenAI が一度作った回答を覚えておき、同じ質問には AI を使わずに答える）と、
// AI が答えられなかった質問（マニュアルに書き足す候補）の記録
//   ・回答の根拠にしたナレッジが変わったら、その回答は使わない（古い回答を出さないため）
//   ・回答の書き方のルール（prompts.ts の ANSWER_STYLE_VERSION）が変わったときも、以前の回答は使わない
import { ANSWER_STYLE_VERSION } from "./prompts";
import { readCollection, writeCollection } from "./store";
import type { Channel } from "./types";

export interface LearnedAnswer {
  key: string;
  question: string;
  answer: string;
  /** 根拠にしたナレッジ（id とその時点の内容のハッシュ） */
  sources: { id: string; title: string; hash: string }[];
  style: "text" | "voice";
  channel: Channel;
  createdAt: string;
  lastUsedAt: string;
  hits: number;
  /** 作ったときの回答の書き方の版（ANSWER_STYLE_VERSION） */
  version?: number;
}

export interface UnansweredQuestion {
  key: string;
  question: string;
  channel: Channel;
  firstAt: string;
  lastAt: string;
  count: number;
}

const MAX_LEARNED = 400;
const MAX_UNANSWERED = 200;

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

let queue: Promise<void> = Promise.resolve();
function serial(fn: () => Promise<void>): Promise<void> {
  queue = queue.then(fn).catch(() => {});
  return queue;
}

export async function listLearned(): Promise<LearnedAnswer[]> {
  await queue;
  // 以前の書き方の回答は使わないので、管理画面にも出さない
  return ((await readCollection<LearnedAnswer[]>("learned")) ?? []).filter((x) => (x.version ?? 1) === ANSWER_STYLE_VERSION);
}

/** 有効な学習済み回答を探す（根拠のナレッジが今も同じ内容であること） */
export async function findLearned(key: string, style: "text" | "voice", validHashes: Set<string>): Promise<LearnedAnswer | null> {
  const list = await listLearned();
  const hit = list.find((x) => x.key === key && x.style === style);
  if (!hit || (hit.version ?? 1) !== ANSWER_STYLE_VERSION) return null;
  if (!hit.sources.every((s) => validHashes.has(s.hash))) return null;
  void serial(async () => {
    const cur = (await readCollection<LearnedAnswer[]>("learned")) ?? [];
    const i = cur.findIndex((x) => x.key === key && x.style === style);
    if (i >= 0) {
      cur[i] = { ...cur[i], hits: cur[i].hits + 1, lastUsedAt: new Date().toISOString() };
      await writeCollection("learned", cur);
    }
  });
  return hit;
}

export function saveLearned(a: Omit<LearnedAnswer, "createdAt" | "lastUsedAt" | "hits" | "version">): Promise<void> {
  return serial(async () => {
    const cur = (await readCollection<LearnedAnswer[]>("learned")) ?? [];
    const now = new Date().toISOString();
    const next = [{ ...a, createdAt: now, lastUsedAt: now, hits: 0, version: ANSWER_STYLE_VERSION }, ...cur.filter((x) => !(x.key === a.key && x.style === a.style))];
    await writeCollection("learned", next.slice(0, MAX_LEARNED));
  });
}

export function deleteLearned(key: string): Promise<void> {
  return serial(async () => {
    const cur = (await readCollection<LearnedAnswer[]>("learned")) ?? [];
    await writeCollection(
      "learned",
      key === "*" ? [] : cur.filter((x) => x.key !== key),
    );
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
