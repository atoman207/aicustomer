// ご住所の町名の聞き違いを直す（サーバー）。一畳屋様のご要望 2026-10-28：
//   声の聞き取りで「玉名市岱明町（たいめいまち）」が「玉名市大名町」になる → 熊本県・大牟田市の町名の一覧（gazetteer.ts）にない町名は、
//   会話（お客様が言った住所・AI の復唱）を読んで、その市区町村の町名のうち読みが合うものに直す。決められなければ直さず「要確認」にする。
//   直すのは声で伺ったご住所だけ。文字で入力されたご住所は書かれたとおり（2026-10-28 夜のご指摘「テキストでも正確に聞き取らない」：
//   一覧は新しい町名・字の名前をすべては含まないため、正しく入力された町名を別の町名に直してしまうことがあった）
import { env } from "./env";
import { logError } from "./errorlog";
import { PLACE_CITIES, formatCities, formatTowns, kanaSimilarity, lookupAddress, replaceTown } from "./gazetteer";
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

/** AI が選んだ町名・市区町村の読みが、お客様の言った読みとこれ以上近ければ直す（遠ければ直さず「要確認」） */
const MIN_READING_MATCH = 0.6;

const TOWN_SCHEMA = {
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

const CITY_SCHEMA = {
  name: "address_city",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      heard_reading: { type: ["string", "null"] },
      city: { type: ["string", "null"] },
      address: { type: ["string", "null"] },
    },
    required: ["heard_reading", "city", "address"],
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

/** 住所の中の数字（番地・号）。直す前と後で変わっていないことを確かめる */
const digitsOf = (s: string) => (s.normalize("NFKC").match(/\d+/g) ?? []).join("-");

/** 熊本県・大牟田市の外のご住所（「福岡県久留米市」など）。一覧にないのは当然なので、直さず確かめもしない */
function outsideArea(address: string): boolean {
  const s = address.normalize("NFKC").replace(/\s+/g, "");
  const pref = s.match(/^(.{2,3}?[都道府県])/)?.[1];
  if (!pref || pref === "熊本県") return false;
  return !(pref === "福岡県" && s.startsWith("福岡県大牟田市"));
}

/** 市区町村が一覧にない（「熊本県上増敷上に三里町405の3」）：会話から、お客様が言った市区町村を一覧から選ぶ */
async function fixCity(address: string, messages: ChatMessage[]): Promise<string | null> {
  const ai = await chatCompletionJson<{ heard_reading: string | null; city: string | null; address: string | null }>({
    model: env.intakeModel,
    reasoningEffort: env.intakeReasoning,
    messages: [
      {
        role: "system",
        content: `あなたは熊本の住まいのリフォーム店の受付で、お客様のご住所を確かめる係です。
お客様が声で伝えたご住所を音声認識が文字にしたため、市区町村（郡・市・町・村・区）の漢字が聞き違いになっています（例：「しもましきぐん みさとまち」が「上増敷上に三里町」になる）。
【会話】でお客様がご住所を言った部分と AI の復唱を読み、お客様が実際に発音したと考えられる市区町村の読み（heard_reading。ひらがな。郡の名前も含めて）を考え、【市区町村の一覧】（漢字（よみ））から、読みが同じか、とても近いものを1つだけ選んで city に一覧のとおりの漢字で入れてください。
address には、市区町村をその漢字にしたご住所の全体（町名・番地・号はお客様が言ったとおり。番地の数字は変えない）を入れてください。
- 文字の漢字ではなく、音の近さで選ぶ。
- 読みの合う市区町村がない・2つ以上あって決められない・熊本県と大牟田市の外のご住所のときは、city と address を null にする。`,
      },
      { role: "user", content: `【ご住所】${address}\n\n【会話】\n${addressTalk(messages)}\n\n【市区町村の一覧】\n${formatCities()}` },
    ],
    jsonSchema: CITY_SCHEMA,
    temperature: 0,
    maxTokens: 300,
    timeoutMs: 20_000,
    purpose: "intake",
  });
  const city = PLACE_CITIES.find((c) => c.name === ai.city?.trim());
  const fixed = ai.address?.trim();
  if (!city || !fixed || !ai.heard_reading) return null;
  if (kanaSimilarity(ai.heard_reading, city.kana) < MIN_READING_MATCH) return null;
  if (!fixed.normalize("NFKC").replace(/^熊本県|^福岡県/, "").startsWith(city.name) || digitsOf(fixed) !== digitsOf(address)) return null;
  return fixed;
}

/**
 * 声で伺ったご住所の市区町村・町名が熊本県・大牟田市の一覧になければ、会話から読みの合うものを選んで直す。
 * 一覧にある・熊本県と大牟田市の外のご住所・文字で入力されたご住所は、そのまま返す（spoken：声で伺ったご住所か）
 */
export async function fixAddress(address: string | undefined, messages: ChatMessage[], opts: { spoken: boolean }): Promise<FixedAddress | null> {
  if (!address?.trim()) return null;
  if (!opts.spoken || outsideArea(address)) return { address, unsure: false };
  let current = address;
  let l = lookupAddress(current);
  // 「玉名市中央区坪井」→「熊本市中央区坪井」（区があるのは熊本市だけ）
  if (l.corrected) current = l.corrected.address;
  const changed = () => (current !== address ? { from: address } : {});
  if (l.status === "ok" || l.status === "empty") return { address: current, unsure: false, ...changed() };
  if (!env.hasOpenAI) return { address: current, unsure: true, ...changed() };
  try {
    if (l.status === "city_unknown") {
      const fixed = await fixCity(current, messages);
      if (!fixed) return { address: current, unsure: true, ...changed() };
      current = fixed;
      l = lookupAddress(current);
      if (l.corrected) current = l.corrected.address;
      if (l.status !== "town_unknown") return { address: current, unsure: l.status !== "ok", ...changed() };
    }
    const city = l.cities.map((c) => c.name).join("・");
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
- 読みの合う町名がない・2つ以上あって決められないときは town を null にする（一覧は新しい町名・字の名前をすべては含まないので、無理に選ばない）。`,
        },
        {
          role: "user",
          content: `【ご住所】${current}\n\n【会話】\n${addressTalk(messages)}\n\n【${city}の町名の一覧】\n${formatTowns(l.candidates, l.cities.length > 1)}`,
        },
      ],
      jsonSchema: TOWN_SCHEMA,
      temperature: 0,
      maxTokens: 300,
      timeoutMs: 20_000,
      purpose: "intake",
    });
    const pick = ai.town?.trim();
    const hit = pick ? l.candidates.find((t) => t.town === pick || `${t.city}${t.town}` === pick) : undefined;
    // 選んだ町名の読みが、お客様の言った読みと離れている：直さない（違う町名にしてしまわないように）
    if (!hit || !ai.heard_reading || kanaSimilarity(ai.heard_reading, hit.kana) < MIN_READING_MATCH) return { address: current, unsure: true, ...changed() };
    current = replaceTown(l, hit.town);
    return { address: current, unsure: false, ...changed() };
  } catch (e) {
    await logError("openai", "ご住所の町名の確認", e);
    return { address: current, unsure: true, ...changed() };
  }
}
