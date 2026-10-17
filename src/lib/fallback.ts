// デモモード（OpenAI APIキー未設定時）のルールベース応答・受付フロー
import { keywordSearch } from "./retrieval";
import type { AgentSession, AgentTurnResult, IntakeDraft, KnowledgeEntry, SearchHit } from "./types";
import { isLikelyPhone, normalizePhone, truncate } from "./utils";

const INTENT_ESTIMATE =
  /(見積|みつもり|依頼|お願いしたい|頼みたい|来てほしい|来て欲しい|訪問|申し込|予約|折り返し|やってほしい|工事したい|交換したい|張り替えたい|張替えたい|新調したい|お願いします)/;
const YES = /^(はい|ええ|うん|そう|大丈夫|ok|オッケー|お願い|間違いない|結構|よろしく|それで|問題ない|合って)/i;
const SKIP = /^(なし|ない|ありません|指定なし|特にない|特になし|お任せ|おまかせ|いいえ)/;
const BYE = /(ありがとうございました|以上です|終わります|失礼します|さようなら|もう大丈夫)/;
const FIX_TARGETS: { key: keyof IntakeDraft; test: RegExp; label: string }[] = [
  { key: "name", test: /(名前|氏名)/, label: "お名前" },
  { key: "address", test: /(住所)/, label: "ご住所" },
  { key: "phone", test: /(電話|番号)/, label: "お電話番号" },
  { key: "dates", test: /(希望日|日にち|日程|日付|希望)/, label: "ご希望日" },
  { key: "summary", test: /(内容|相談)/, label: "ご相談内容" },
];

export const NOT_FOUND_REPLY =
  "恐れ入りますが、その件は社内ナレッジに記載がないため、この場で正確にお答えできかねます。担当者より折り返しご案内いたしますので、お見積り・折り返しをご希望の場合は「見積をお願いします」とお伝えください。";

export function fallbackGreeting(company: string): string {
  return `こんにちは。${company}のAI相談員です（デモモード）。畳・襖・障子・網戸・リフォームについて、お気軽にご質問ください。`;
}

/** ナレッジ検索結果からテンプレート回答を生成 */
export function fallbackAnswer(hits: SearchHit[]): string {
  if (hits.length === 0 || hits[0].score < 0.12) return NOT_FOUND_REPLY;
  const top = hits[0];
  let reply = `「${top.entry.title}」についてご案内します。${top.entry.content}`;
  if (hits[1] && hits[1].score >= 0.25 && hits[1].entry.id !== top.entry.id) {
    reply += ` あわせて「${hits[1].entry.title}」もご参考ください。`;
  }
  reply += " お見積りや訪問をご希望の場合は「見積をお願いします」とお伝えください。";
  return reply;
}

function clean(text: string): string {
  return text
    .replace(/^(はい|えっと|えーと|あの|名前は|住所は|電話は|電話番号は|希望は)[、,]?\s*/u, "")
    .replace(/(です|になります|でお願いします|でお願い|でございます)[。.]?$/u, "")
    .replace(/[。]$/u, "")
    .trim();
}

function appendSummary(prev: string | undefined, text: string): string {
  const parts = [prev, text.trim()].filter((s): s is string => !!s && s.length > 0);
  return truncate(parts.join(" ／ "), 220);
}

function readback(d: IntakeDraft): string {
  const dates = d.dates.map((v, i) => `第${i + 1}希望 ${v}`).join("、");
  return `それでは内容を復唱いたします。お名前は ${d.name} 様。ご住所は ${d.address}。お電話番号は ${d.phone}。ご希望日は ${dates}。ご相談内容は「${
    d.summary || "（未入力）"
  }」。以上の内容でお間違いないでしょうか？よろしければ「はい」、修正があれば「お名前」「ご住所」「お電話番号」「希望日」「相談内容」のどれを直すかお伝えください。`;
}

function nextStep(d: IntakeDraft): { step: string; prompt: string; stage: AgentTurnResult["stage"] } {
  if (!d.name) return { step: "name", prompt: "まず、お名前をフルネームでお聞かせください。", stage: "collecting" };
  if (!d.address)
    return {
      step: "address",
      prompt: "ありがとうございます。次に、ご住所を市区町村から番地までお聞かせください。",
      stage: "collecting",
    };
  if (!d.phone)
    return {
      step: "phone",
      prompt: "ありがとうございます。折り返しご連絡できるお電話番号を、市外局番からお聞かせください。",
      stage: "collecting",
    };
  if (d.dates.length === 0)
    return {
      step: "date1",
      prompt: "訪問のご希望日時を伺います。第1希望の日にちと、午前か午後かをお聞かせください。",
      stage: "collecting",
    };
  if (d.dates.length === 1)
    return { step: "date2", prompt: "第2希望はございますか？なければ「なし」とお答えください。", stage: "collecting" };
  if (d.dates.length === 2)
    return { step: "date3", prompt: "第3希望はございますか？なければ「なし」とお答えください。", stage: "collecting" };
  return { step: "confirm", prompt: readback(d), stage: "confirming" };
}

/**
 * ルールベースの1ターン処理。session.fallbackStep を更新する（保存は呼び出し側）。
 */
export function fallbackTurn(session: AgentSession, text: string, entries: KnowledgeEntry[]): AgentTurnResult {
  const step = session.fallbackStep ?? "consult";
  const draft: IntakeDraft = { ...session.draft, dates: [...session.draft.dates] };
  const base = { draft, mode: "demo" as const, done: false };

  const advance = (): AgentTurnResult => {
    const n = nextStep(draft);
    session.fallbackStep = n.step;
    return { ...base, stage: n.stage, reply: n.prompt };
  };

  switch (step) {
    case "consult": {
      if (INTENT_ESTIMATE.test(text)) {
        if (!draft.summary) draft.summary = appendSummary(undefined, text);
        const n = nextStep(draft);
        session.fallbackStep = n.step;
        return { ...base, stage: n.stage, reply: `かしこまりました。お見積りのご依頼を承ります。${n.prompt}` };
      }
      if (BYE.test(text)) {
        return {
          ...base,
          stage: "consult",
          done: true,
          reply: "ご相談ありがとうございました。またいつでもお気軽にご連絡ください。",
        };
      }
      const hits = keywordSearch(text, entries, 3);
      draft.summary = appendSummary(draft.summary, text);
      return { ...base, stage: "consult", reply: fallbackAnswer(hits), sources: hits };
    }
    case "name":
      draft.name = clean(text);
      return advance();
    case "address":
      draft.address = clean(text);
      return advance();
    case "phone": {
      if (draft.phone && YES.test(text)) return advance();
      const p = normalizePhone(text);
      if (!isLikelyPhone(p)) {
        return {
          ...base,
          stage: "collecting",
          reply: "恐れ入ります、お電話番号を市外局番から数字でお聞かせください。例えば、ゼロキューゼロ、イチニサンヨン、ゴーロクナナハチ、のようにお願いします。",
        };
      }
      draft.phone = p;
      return advance();
    }
    case "date1":
      draft.dates = [clean(text)];
      return advance();
    case "date2":
    case "date3": {
      if (SKIP.test(text.trim())) {
        session.fallbackStep = "confirm";
        return { ...base, stage: "confirming", reply: readback(draft) };
      }
      draft.dates = [...draft.dates, clean(text)].slice(0, 3);
      return advance();
    }
    case "summary":
      draft.summary = clean(text);
      return advance();
    case "confirm": {
      if (YES.test(text.trim())) {
        session.fallbackStep = "done";
        return {
          ...base,
          stage: "completed",
          done: session.channel === "phone",
          reply:
            "ありがとうございます。ご依頼を受付いたしました。担当者より折り返しご連絡し、訪問日程を確定いたします。",
        };
      }
      for (const t of FIX_TARGETS) {
        if (t.test.test(text)) {
          if (t.key === "dates") draft.dates = [];
          else draft[t.key] = undefined;
          session.fallbackStep = t.key === "dates" ? "date1" : t.key;
          const n = nextStep(draft);
          session.fallbackStep = n.step;
          return { ...base, stage: "collecting", reply: `かしこまりました。${t.label}を改めてお聞かせください。` };
        }
      }
      return {
        ...base,
        stage: "confirming",
        reply:
          "恐れ入ります。この内容でよろしければ「はい」と、修正したい場合は「お名前」「ご住所」「お電話番号」「希望日」「相談内容」のどれを直すかお伝えください。",
      };
    }
    case "done":
    default:
      return {
        ...base,
        stage: "completed",
        done: true,
        reply: "受付は完了しております。担当者より折り返しご連絡いたします。ご相談ありがとうございました。",
      };
  }
}
