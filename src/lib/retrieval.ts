// ナレッジ検索（キーワード + 埋め込みのハイブリッド）。サーバー専用
import crypto from "crypto";
import { env } from "./env";
import { embed } from "./openai";
import { getEmbeddingCache, saveEmbeddingCache } from "./store";
import type { KnowledgeEntry, SearchHit } from "./types";
import { clamp, cosine, normalizeJa } from "./utils";

function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  if (s.length === 1) set.add(s);
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function overlapRatio(q: Set<string>, t: Set<string>): number {
  if (q.size === 0) return 0;
  let n = 0;
  q.forEach((b) => {
    if (t.has(b)) n++;
  });
  return n / q.size;
}

export function keywordScore(query: string, e: KnowledgeEntry): number {
  const q = normalizeJa(query);
  if (!q) return 0;
  const qb = bigrams(q);
  const body = overlapRatio(qb, bigrams(normalizeJa(`${e.title}${e.content}`)));
  const title = overlapRatio(qb, bigrams(normalizeJa(e.title)));
  let kw = 0;
  for (const k of e.keywords) {
    const nk = normalizeJa(k);
    if (nk && q.includes(nk)) kw += clamp(nk.length / 3, 0.4, 1);
  }
  const kwScore = clamp(kw / 2, 0, 1);
  const cat = normalizeJa(e.category);
  const catBoost = cat && q.includes(cat) ? 0.1 : 0;
  return clamp(0.45 * body + 0.15 * title + 0.4 * kwScore + catBoost, 0, 1);
}

export function keywordSearch(query: string, entries: KnowledgeEntry[], k = 5, minScore = 0.08): SearchHit[] {
  return entries
    .map((entry) => ({ entry, score: keywordScore(query, entry) }))
    .filter((h) => h.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

function entryHash(e: KnowledgeEntry): string {
  return crypto
    .createHash("sha1")
    .update(`${env.embeddingModel}|${e.title}|${e.content}|${e.keywords.join(",")}`)
    .digest("hex");
}

async function entryVectors(entries: KnowledgeEntry[]): Promise<Map<string, number[]>> {
  const cache = await getEmbeddingCache();
  const result = new Map<string, number[]>();
  const missing: { e: KnowledgeEntry; h: string }[] = [];
  for (const e of entries) {
    const h = entryHash(e);
    if (cache[h]) result.set(e.id, cache[h]);
    else missing.push({ e, h });
  }
  if (missing.length > 0) {
    const texts = missing.map(({ e }) => `${e.category} ${e.title}\n${e.content}\n${e.keywords.join(" ")}`);
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += 64) vectors.push(...(await embed(texts.slice(i, i + 64))));
    missing.forEach(({ e, h }, i) => {
      cache[h] = vectors[i];
      result.set(e.id, vectors[i]);
    });
    // 古いキャッシュを間引き（現行エントリのハッシュのみ保持）
    const keep = new Set(entries.map(entryHash));
    const pruned: Record<string, number[]> = {};
    for (const [h, v] of Object.entries(cache)) if (keep.has(h)) pruned[h] = v;
    await saveEmbeddingCache(pruned);
  }
  return result;
}

export interface SearchResult {
  hits: SearchHit[];
  mode: "hybrid" | "keyword";
  error?: string;
}

/** OpenAI キーがあれば埋め込み+キーワードのハイブリッド、なければキーワードのみ */
export async function hybridSearch(query: string, entries: KnowledgeEntry[], k = 5, keywordQuery = query): Promise<SearchResult> {
  const kwAll = entries.map((entry) => ({ entry, score: keywordScore(keywordQuery, entry) }));
  const keywordOnly = (): SearchHit[] =>
    kwAll
      .filter((h) => h.score >= 0.08)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  if (!env.hasOpenAI || entries.length === 0 || !query.trim()) {
    return { hits: keywordOnly(), mode: "keyword" };
  }
  try {
    const [vectors, [qv]] = await Promise.all([entryVectors(entries), embed([query])]);
    const merged: SearchHit[] = kwAll.map(({ entry, score }) => {
      const v = vectors.get(entry.id);
      const cos = v ? cosine(qv, v) : 0;
      const sem = clamp((cos - 0.2) / 0.45, 0, 1);
      return { entry, score: clamp(0.6 * sem + 0.4 * score + (score > 0.3 ? 0.1 : 0), 0, 1) };
    });
    return {
      hits: merged
        .filter((h) => h.score >= 0.18)
        .sort((a, b) => b.score - a.score)
        .slice(0, k),
      mode: "hybrid",
    };
  } catch (e) {
    return { hits: keywordOnly(), mode: "keyword", error: (e as Error).message };
  }
}
