// ご住所の町名の聞き違いを直す（サーバー）。一畳屋様のご要望 2026-10-28：
//   声の聞き取りで「玉名市岱明町（たいめいまち）」が「玉名市大名町」になる → 熊本県・大牟田市の町名の一覧（gazetteer.ts）にない町名は、
//   会話（お客様が言った住所・AI の復唱）を読んで、その市区町村の町名のうち読みが合うものに直す。決められなければ直さず「要確認」にする
import { env } from "./env";
import { logError } from "./errorlog";
import { formatTowns, lookupAddress, replaceTown } from "./gazetteer";
import { chatCompletionJson } from "./openai";
import type { ChatMessage } from "./types";
import { truncate } from "./utils";

export interface FixedAddress {
  address: string;
  /** 町名が一覧になく、直せなかった（確認画面でお客様に確かめていただく） */
  unsure: boolean;
  /** 直す前の住所（直したときだけ） */
  from?: string;
}

const SCHEMA = {
  name: "address_town",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      heard_reading: { type: ["string", "null"] },
      town: { type: ["string", "null"] },
    },
    required: ["heard_reading", "town"],
  },
};

/** 会話のうち、ご住所のやりとり（お客様の発言と AI の復唱）が入る最後のほう */
function addressTalk(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-24)
    .map((m) => `${m.role === "user" ? "お客様" : "AI"}：${truncate(m.content.replace(/\s+/g, " "), 300)}`)
    .join("\n");
}

/**
 * ご住所の町名が熊本県・大牟田市の町名の一覧になければ、会話から読みの合う町名を選んで直す。
 * 一覧にある・市区町村がわからない・熊本県と大牟田市の外のご住所は、そのまま返す
 */
export async function fixAddress(address: string | undefined, messages: ChatMessage[]): Promise<FixedAddress | null> {
  if (!address?.trim()) return null;
  const l = lookupAddress(address);
  if (l.status !== "town_unknown") return { address, unsure: false };
  if (!env.hasOpenAI) return { address, unsure: true };
  const city = l.cities.map((c) => c.name).join("・");
  try {
    const ai = await chatCompletionJson<{ heard_reading: string | null; town: string | null }>({
      model: env.intakeModel,
      reasoningEffort: env.intakeReasoning,
      messages: [
        {
          role: "system",
          content: `あなたは熊本の住まいのリフォーム店の受付で、お客様のご住所の町名を確かめる係です。
お客様が声で伝えたご住所を音声認識が文字にしたため、町名の漢字が聞き違いになっていることがあります（例：お客様は「たまなし たいめいまち」と言ったのに「玉名市大名町」と文字になる）。
【ご住所】の町名の部分「${l.head}」は、${city}の町名の一覧にありません。【会話】でお客様がご住所を言った部分と AI の復唱を読み、お客様が実際に発音したと考えられる町名の読み（heard_reading。ひらがな）を考え、【${city}の町名の一覧】（漢字（よみ））から、読みが同じか、とても近い町名を1つだけ選んで town に一覧のとおりの漢字で入れてください。
- 文字の漢字の読み方は1つとは限らない（「大名」は「たいめい」とも読める）。文字の漢字ではなく、音の近さで選ぶ。
- お客様が言っていない大字・町名を足さない（「岱明町」とだけ言ったなら、一覧の「岱明町◯◯」は選ばない）。
- 読みの合う町名がない・2つ以上あって決められないときは town を null にする。`,
        },
        {
          role: "user",
          content: `【ご住所】${address}\n\n【会話】\n${addressTalk(messages)}\n\n【${city}の町名の一覧】\n${formatTowns(l.candidates, l.cities.length > 1)}`,
        },
      ],
      jsonSchema: SCHEMA,
      temperature: 0,
      maxTokens: 300,
      timeoutMs: 20_000,
      purpose: "intake",
    });
    const pick = ai.town?.trim();
    const hit = pick ? l.candidates.find((t) => t.town === pick || `${t.city}${t.town}` === pick) : undefined;
    if (!hit) return { address, unsure: true };
    return { address: replaceTown(l, hit.town), unsure: false, from: address };
  } catch (e) {
    await logError("openai", "ご住所の町名の確認", e);
    return { address, unsure: true };
  }
}
