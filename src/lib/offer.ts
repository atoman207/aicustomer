// 無料の訪問見積もりへの案内の時機（文字・声の相談で共通。ブラウザとサーバーの両方で使う）
//   一畳屋様のご指摘 2026-10-28「会話のなかで見積に誘導しない」（EST-20261028-NB0J 文字・3C4O 声）：
//   AI に任せると、具体的な相談が続いても提案しないことがあった。そこで、2回目以降の答え・条件（数量・大きさ）が
//   わかった答えで、まだ提案していなければ、この答えで必ず提案するよう AI に伝える（offerDue）

interface Turn {
  role: string;
  content: string;
}

/** AI がもう無料の訪問見積もりを提案した（「お伺いしましょうか？」「無料の訪問見積もり」など） */
const OFFERED = /訪問(?:見積|みつもり)|無料の?(?:お)?(?:見積|みつもり)|(?:見積|みつもり).{0,12}(?:いかが|しましょうか|いたしましょうか|ご依頼|ご希望でしたら)|お伺いしましょうか|伺いましょうか/;
/** お客様がお見積りを断った・今は考えたい */
const DECLINED =
  /(?:見積|みつもり|訪問|来て).{0,8}(?:いい(?:です|や)|結構|大丈夫|不要|いらない|まだ)|今は(?:いい|結構|大丈夫|まだ)|(?:検討|考え)(?:します|てみます|ます)|また(?:連絡|今度|にします)|やめておき/;
/**
 * 日程・訪問のことを聞いた（「11月9日ごろに取り付けできますか？」「いつ来てもらえますか」）：直前に提案していても、
 * もう一度提案する（訪問見積もりのときに日程も相談できるため。EST-20261028-NB0J の会話の流れ）
 */
const SCHEDULE = /\d+\s*月\s*\d+\s*日|[一二三四五六七八九十]+月|いつ(?:頃|ごろ)?(?:来|伺|でき|取り?付|工事|施工)|日程|何日|来週|来月|今週|今月中|(?:取り?付け|施工|工事|張替え?|交換)(?:は|って)?(?:いつ|でき(?:ます|る)|可能)|来て(?:もら|くれ|いただ)|訪問/;

/** 条件（数量・大きさ）が入った質問（「網戸4枚」「6畳」「2m」） */
const CONCRETE = /[0-9０-９一二三四五六七八九十]+\s*(?:畳|帖|枚|本|部屋|間|箇所|か所|ヶ所|カ所|m|ｍ|メートル|センチ|cm|平米|㎡|坪)/;

/** 答えの発言（金額・数字がある、またはつなぎの言葉より長い） */
const isAnswer = (text: string) => /\d|円/.test(text.normalize("NFKC")) || text.trim().length >= 30;

/**
 * この答えで、無料の訪問見積もりを提案するか。history はこの質問より前の会話、question はいまの質問、
 * busy は見積依頼を伺っている・確認画面を出した（もう提案はいらない）
 */
export function offerDue(history: Turn[], question: string, busy = false): boolean {
  if (busy) return false;
  const firstUser = history.findIndex((m) => m.role === "user");
  // あいさつ（最初の質問より前の AI の発言）と、声の相談のつなぎの言葉（「お調べしますね」）は数えない
  const answers = firstUser < 0 ? [] : history.slice(firstUser).filter((m) => m.role === "assistant" && isAnswer(m.content));
  const users = [...history.filter((m) => m.role === "user").slice(-5), { role: "user", content: question }];
  if (users.some((m) => DECLINED.test(m.content.normalize("NFKC")))) return false;
  const q = question.normalize("NFKC");
  // 日程・訪問の話、または提案のあとに大きさ・数量を答えた（「大きさは70×70cmくらいです」）：直前に提案していても、
  // この答えで提案する（提案しないと、お客様が「見積をお願いします」と言い直すまで1往復多くなる。EST-20261029-FJUM）
  if (SCHEDULE.test(q) || CONCRETE.test(q)) return true;
  if (answers.slice(-2).some((m) => OFFERED.test(m.content.normalize("NFKC")))) return false;
  return answers.length >= 1 || CONCRETE.test(q);
}

/** 文字の相談：この答えで提案するときに AI の指示の最後に足す */
export const OFFER_NOW = `# この答えの終わり方（必ず守る）
この答えの最後の1文で、無料の訪問見積もりを自然に提案してください（例：「正確な金額は、無料の訪問見積もりでご案内できます。よろしければ、ご都合のよい日にお伺いしましょうか？」）。この答えでは、ほかの質問は返さない（最後は提案の問いかけだけにする）。`;

/** AI を使わずに答えた（料金表から）ときに、答えのあとに足す提案 */
export const OFFER_LINE = "正確な金額は、無料の訪問見積もりでご案内できます。よろしければ、ご都合のよい日にお伺いしましょうか？";

/** 声の相談：search_knowledge の結果に足す（バックエンドが答えのあとに伝える） */
export const OFFER_AFTER_ANSWER = `答えを伝えたら、最後に「${OFFER_LINE}」のように、無料の訪問見積もりを一言で提案してください。`;

/** 答えの中に、もう提案が入っている */
export function hasOffer(text: string): boolean {
  return OFFERED.test(text.normalize("NFKC"));
}
