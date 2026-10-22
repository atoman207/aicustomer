// 起動中のサーバーに対する疎通テスト。使い方: BASE_URL=http://localhost:3000 node scripts/smoke.mjs
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
let failed = 0;
const results = [];

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push(["PASS", name, detail ?? ""]);
  } catch (e) {
    failed++;
    results.push(["FAIL", name, e.message]);
  }
}

const json = async (path, init) => {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { res, body, text };
};

const form = (obj) => new URLSearchParams(obj).toString();

await check("GET / (トップページ：そのまま相談できる 1 つの画面＝文字の入力欄＋声のマイク＋電話ボタン)", async () => {
  const res = await fetch(`${BASE}/`);
  const html = await res.text();
  if (!res.ok || !html.includes("に相談する") || !html.includes("logo-color.svg")) throw new Error(`status ${res.status}`);
  if (!html.includes("data-consult-console") || !html.includes('aria-label="ご質問"') || !html.includes("data-voice-button")) throw new Error("トップページに相談の画面（入力欄・マイク）がありません");
  if (/data-channel="\/voice"/.test(html) || /文字で相談|声で相談/.test(html)) throw new Error("文字・声で入口（見出し）が分かれています");
  if (!html.includes("営業時間外・土日はAIが受付") || !html.includes('href="tel:0120158108"')) throw new Error("電話ボタンの案内がありません");
  return `${res.status} ${html.length}B 相談の画面（文字・声）あり`;
});
await check("GET /voice（以前の声の相談の入口 → 同じ相談の画面へ）", async () => {
  const res = await fetch(`${BASE}/voice?embed=1`, { redirect: "manual" });
  const to = res.headers.get("location") ?? "";
  if (res.status < 300 || res.status >= 400 || !/\/chat\?/.test(to) || !/voice=1/.test(to) || !/embed=1/.test(to)) throw new Error(`${res.status} → ${to}`);
  return `${res.status} → ${to}`;
});
for (const p of ["/", "/chat", "/voice", "/phone", "/admin"]) {
  await check(`GET ${p}`, async () => {
    const res = await fetch(`${BASE}${p}`);
    const html = await res.text();
    if (!res.ok) throw new Error(`status ${res.status}`);
    // 電話受付のテスト画面（/phone）はスタッフ用：お客様向けのメニューには出さず、検索にも載せない
    if (p !== "/admin" && /href="\/phone"/.test(html)) throw new Error("お客様向けの画面に /phone へのリンクがあります");
    if (p === "/phone" && !/<meta name="robots" content="noindex/.test(html)) throw new Error("noindex がありません");
    return `${res.status}${p === "/phone" ? " noindex" : ""}`;
  });
}
await check("GET /api/status", async () => {
  const { res, body } = await json("/api/status");
  if (!res.ok || !body.ok) throw new Error(`status ${res.status}`);
  return `openai=${body.openai.configured} knowledge=${body.knowledge.source}(${body.knowledge.entries}) reception=${body.reception.sink}`;
});
await check("Googleスプレッドシート（回答の情報源・受付の記録先）", async () => {
  const { body } = await json("/api/status");
  if (body.supabase) throw new Error("Supabase の接続が残っています");
  // パスワード保護時、ログインしていなければ接続先の詳しい情報は出さない（動いているかどうかだけ）
  if (!body.sheet && body.admin.protected) return `詳細は管理画面だけ（ナレッジ ${body.knowledge.source}・${body.knowledge.entries} 件／受付 ${body.reception.sink}）`;
  if (!body.sheet?.configured) return `未設定（保存版 ${body.knowledge.source} で回答）`;
  return `サービスアカウントで接続（ナレッジ ${body.knowledge.source}・${body.knowledge.entries} 件${body.knowledge.warning ? `・${body.knowledge.warning.slice(0, 60)}` : ""}／受付 ${body.reception.sink}）`;
});
await check("GET /api/knowledge（回答の根拠は指定のスプレッドシートだけ）", async () => {
  const { res, body } = await json("/api/knowledge");
  if (res.status === 401) {
    // 管理画面のパスワード保護あり → 公開の接続状況で件数だけ確認
    const k = (await json("/api/status")).body.knowledge;
    if (k.source === "local" || !(k.entries > 0)) throw new Error(`knowledge ${k.source}(${k.entries}) ${k.warning ?? ""}`);
    return `401（管理画面のパスワード保護あり）／ ${k.source}: ${k.entries} entries`;
  }
  if (!res.ok || !Array.isArray(body.entries) || body.entries.length === 0) throw new Error(`status ${res.status}`);
  const st = body.stats ?? {};
  if (body.source === "local" || !(st.manualText > 0) || !(st.manualTables > 0)) throw new Error(`sources missing: ${body.source} ${JSON.stringify(st)}`);
  const origins = [...new Set(body.entries.map((e) => e.origin))];
  // 既定はスプレッドシートだけ（KNOWLEDGE_INCLUDE_WEBSITE=1 のときだけホームページも補足に使う）
  if (body.websiteUsed === false && origins.some((o) => o !== "manual")) throw new Error(`スプレッドシート以外の情報源: ${origins.join(",")}`);
  if (origins.some((o) => o !== "manual" && o !== "website")) throw new Error(`スプレッドシート・ホームページ以外の情報源: ${origins.join(",")}`);
  return `${body.entries.length} entries（${body.source}: 文章${st.manualText}・料金表${st.manualTables}${body.websiteUsed ? ` / HP${st.website}` : "・ホームページは使わない"}）`;
});
await check("管理画面の API（ADMIN_PASSWORD 設定時はログインが必要）", async () => {
  const { body } = await json("/api/status");
  const paths = ["/api/knowledge", "/api/estimates", "/api/conversations", "/api/usage", "/api/settings", "/api/admin/knowledge", "/api/admin/errors"];
  const codes = await Promise.all(paths.map(async (p) => (await fetch(`${BASE}${p}`)).status));
  const refresh = (await fetch(`${BASE}/api/knowledge/refresh`, { method: "POST" })).status;
  const all = [...codes, refresh];
  if (!body.admin.protected) return `未設定のため誰でも閲覧可（公開 URL では ADMIN_PASSWORD を設定）: ${all.join(",")}`;
  if (all.some((c) => c !== 401)) throw new Error(`保護されていない API: ${[...paths, "/api/knowledge/refresh"].filter((_, i) => all[i] !== 401).join(", ")}`);
  if (body.sheet || body.twilio || body.line || body.knowledge.warning) throw new Error("ログインなしの /api/status に接続先の詳しい情報があります");
  return `保護あり（${all.length} 件とも 401・公開の接続状況は動作の有無だけ）`;
});
await check("今のホームページへの埋め込み（embed.js）と、ほかのサイトの中で開けない設定", async () => {
  const js = await fetch(`${BASE}/embed.js`);
  const code = await js.text();
  if (!js.ok || !/javascript/.test(js.headers.get("content-type") ?? "") || !code.includes("ichijoyaAi")) throw new Error(`embed.js: ${js.status}`);
  const chat = (await fetch(`${BASE}/chat`)).headers.get("content-security-policy") ?? "";
  if (!/frame-ancestors 'self' https?:\/\//.test(chat)) throw new Error(`/chat の frame-ancestors: ${chat || "なし"}`);
  const admin = await fetch(`${BASE}/admin`);
  const adminCsp = admin.headers.get("content-security-policy") ?? "";
  if (!/frame-ancestors 'none'/.test(adminCsp) || admin.headers.get("x-frame-options") !== "DENY") throw new Error(`/admin: ${adminCsp} ${admin.headers.get("x-frame-options")}`);
  return `embed.js ${Math.round(code.length / 1024)}KB／相談のページ：${chat.replace("frame-ancestors ", "")}／管理画面：none`;
});
await check("POST /api/knowledge/search（声の相談のツール：料金も資料から回答）", async () => {
  const { res, body } = await json("/api/knowledge/search", { method: "POST", body: JSON.stringify({ query: "6畳の畳の表替えはいくら？" }) });
  if (!res.ok || !(body.answer || body.hits?.length)) throw new Error(`status ${res.status} ${JSON.stringify(body).slice(0, 100)}`);
  if (body.answer && !/円/.test(body.answer)) throw new Error(`no price in answer: ${body.answer.slice(0, 80)}`);
  return `${body.mode}/${body.kind}: ${(body.answer ?? body.hits[0].title).slice(0, 40)}`;
});
await check("POST /api/chat（料金：AI があれば資料の全文から・デモは料金表から直接）", async () => {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "smoke-price", channel: "web_text", messages: [{ role: "user", content: "朱雀の襖の両面はいくら？" }] }),
  });
  const text = (await res.text()).normalize("NFKC");
  const mode = res.headers.get("x-mode");
  if (!res.ok || !["local", "openai"].includes(mode ?? "") || !/23,100円/.test(text) || /枠交換/.test(text)) throw new Error(`mode=${mode} ${text.slice(0, 120)}`);
  return `mode=${mode} ${text.replace(/\s+/g, " ").slice(0, 50)}`;
});
await check("POST /api/knowledge/answer（営業時間はスプレッドシートの内容で回答）", async () => {
  const { res, body } = await json("/api/knowledge/answer", { method: "POST", body: JSON.stringify({ question: "営業時間を教えてください" }) });
  const reply = String(body.reply ?? "").normalize("NFKC");
  if (!res.ok || !/(8:00|8時)/.test(reply) || !/(17:00|17時|5時)/.test(reply)) throw new Error(`${body.mode} ${String(body.reply).slice(0, 80)}`);
  return `${body.mode}/${body.kind}: ${body.reply.slice(0, 30)}…`;
});
await check("POST /api/knowledge/answer（料金表・シートにない質問）", async () => {
  const cases = [
    // AI があれば資料の全文から（llm）、デモは料金表から直接（price）
    ["畳のヘリの値段は？", /^(price|llm)$/, /7,700円/],
    ["6畳の表替えはいくら？", /^(price|llm)$/, /\d{2,3},\d{3}円/],
    // 資料にない質問：AI なし（デモ・検索の方式）なら定型文、資料の全文で答える方式なら AI が資料にないと判断して折り返しを案内
    ["駐車場は何台とめられますか？", /^(notfound|llm)$/, /お答えできかねます|担当者より折り返し/],
  ];
  const out = [];
  for (const [question, kind, re] of cases) {
    const { res, body } = await json("/api/knowledge/answer", { method: "POST", body: JSON.stringify({ question }) });
    const kindOk = kind instanceof RegExp ? kind.test(body.kind) : body.kind === kind;
    if (!res.ok || !kindOk || !re.test(body.reply)) throw new Error(`${question} → ${body.mode}/${body.kind} ${String(body.reply).slice(0, 50)}`);
    out.push(`${body.kind}`);
  }
  return out.join("・");
});
await check("GET /api/usage", async () => {
  const { res, body } = await json("/api/usage");
  if (res.status === 401) return "401（管理画面のパスワード保護あり）";
  if (!res.ok || !Array.isArray(body.days)) throw new Error(`status ${res.status}`);
  const d = body.days[0]?.usage;
  return d ? `今日：ナレッジ回答 ${d.answers.local + d.answers.cache} / AI ${d.answers.openai} / tokens ${d.tokens.prompt + d.tokens.completion}` : "記録なし";
});
await check("POST /api/chat (ストリーム)", async () => {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "smoke-chat", channel: "web_text", messages: [{ role: "user", content: "網戸の張替えは即日できますか？" }] }),
  });
  const text = await res.text();
  if (!res.ok || text.length < 10) throw new Error(`status ${res.status}`);
  return `mode=${res.headers.get("x-mode")} ${text.slice(0, 40)}…`;
});
await check("POST /api/summarize", async () => {
  const { res, body } = await json("/api/summarize", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "6畳の畳を表替えしたい。ペットがいます。" }] }) });
  if (!res.ok || !body.ok) throw new Error(`status ${res.status}`);
  return `${body.mode}: ${String(body.summary).slice(0, 40)}`;
});
await check("POST /api/chat（見積依頼の聞き取り：お名前・ご住所・お電話番号 → ご希望日時 → 確認画面）", async () => {
  const messages = [];
  let intake = { active: false, draft: { dates: [] } };
  const turns = ["6畳の和室の表替えを考えています", "見積をお願いします", "疎通花子、熊本市中央区水前寺1-2-3、090-1234-5678", "11月2日の午前か11月4日の午後"];
  let reply = "";
  for (const t of turns) {
    messages.push({ role: "user", content: t });
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "smoke-intake", channel: "web_text", messages, intake }),
    });
    reply = await res.text();
    if (!res.ok) throw new Error(`"${t}" → ${res.status}`);
    const header = res.headers.get("x-intake");
    if (header) intake = JSON.parse(decodeURIComponent(header));
    messages.push({ role: "assistant", content: reply });
  }
  const d = intake.draft;
  if (!intake.ready || d.name !== "疎通花子" || d.phone !== "090-1234-5678" || d.dates.length !== 2 || !/内容を確認して送信/.test(reply)) {
    throw new Error(`ready=${intake.ready} ${JSON.stringify(d)} ${reply.slice(0, 60)}`);
  }
  if (!d.summary || /090|疎通花子/.test(d.summary)) throw new Error(`要約: ${d.summary}`);
  return `${d.name}／${d.address}／${d.phone}／${d.dates.join("・")}／要約「${d.summary.slice(0, 24)}…」`;
});
await check("POST /api/estimates/draft（確認画面：会話から読み取り）", async () => {
  const messages = [
    { role: "user", content: "襖を4枚張り替えたいです" },
    { role: "assistant", content: "かしこまりました。お名前を教えていただけますか？" },
    { role: "user", content: "疎通次郎です" },
    { role: "assistant", content: "ご住所をお願いします。" },
    { role: "user", content: "合志市栄3415-11" },
  ];
  const { res, body } = await json("/api/estimates/draft", { method: "POST", body: JSON.stringify({ messages, draft: { dates: [] } }) });
  if (!res.ok || !body.ok) throw new Error(`status ${res.status}`);
  const d = body.draft;
  if (!d.name?.startsWith("疎通次郎") || d.address !== "合志市栄3415-11" || !/襖/.test(d.summary ?? "")) throw new Error(JSON.stringify(d));
  if (body.missing.join(",") !== "phone,dates") throw new Error(`missing=${body.missing}`);
  return `${body.mode}: ${d.name}／${d.address}／足りない項目=${body.missing.join("・")}`;
});
await check("声の相談（簡易音声）：そろったら確認画面を表示（受付はお客様の送信で）", async () => {
  const start = await json("/api/agent/start", { method: "POST", body: JSON.stringify({ channel: "web_voice" }) });
  if (!start.res.ok) throw new Error(`start ${start.res.status}`);
  const sid = start.body.sessionId;
  const turns = ["見積をお願いします", "疎通三郎です", "熊本市東区保田窪2-1-21", "09011112222", "11月5日の午前", "なし", "なし", "はい"];
  let last;
  let session = start.body.session;
  for (const t of turns) {
    last = await json("/api/agent/turn", { method: "POST", body: JSON.stringify({ sessionId: sid, text: t, session }) });
    if (!last.res.ok) throw new Error(`turn "${t}" → ${last.res.status}`);
    session = last.body.session;
    if (last.body.formReady) break;
  }
  if (!last.body.formReady || last.body.estimate || !/確認画面/.test(last.body.reply)) throw new Error(`formReady=${last.body.formReady} estimate=${last.body.estimate?.id} ${last.body.reply}`);
  return `mode=${last.body.mode} draft=${last.body.draft.name}／${last.body.draft.phone}／${last.body.draft.dates.join("・")}`;
});
await check("POST /api/estimates (未確認は拒否)", async () => {
  const { res } = await json("/api/estimates", { method: "POST", body: JSON.stringify({ name: "x", confirmed: false }) });
  if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
  return "400 as expected";
});
await check("POST /api/estimates (登録)", async () => {
  const { res, body } = await json("/api/estimates", {
    method: "POST",
    body: JSON.stringify({
      channel: "web_text",
      name: "疎通 太郎",
      address: "熊本県熊本市中央区1-1",
      phone: "090-0000-0000",
      summary: "smoke test",
      preferredDates: ["10月20日 午前"],
      confirmed: true,
      sessionId: "smoke-chat",
      autofill: { filled: ["name", "address", "phone", "dates", "summary"], edited: ["address"] },
    }),
  });
  if (!res.ok || !body.ok) throw new Error(`status ${res.status} ${JSON.stringify(body)}`);
  if (body.estimate.autofill?.edited?.join(",") !== "address") throw new Error(`autofill: ${JSON.stringify(body.estimate.autofill)}`);
  return `${body.estimate.id} → ${body.sink}（会話から自動入力 ${body.estimate.autofill.filled.length} 項目）`;
});
await check("電話受付フロー（agent start → 受付完了）", async () => {
  const start = await json("/api/agent/start", { method: "POST", body: JSON.stringify({ channel: "phone" }) });
  if (!start.res.ok) throw new Error(`start ${start.res.status}`);
  const sid = start.body.sessionId;
  // 実モデルでは質問の順序が多少変わるため、復唱確認（confirming）には「はい」を追加で返す
  const turns = ["襖の張替えは何日かかりますか", "見積をお願いします", "山田花子です", "熊本市中央区水前寺1-2-3", "09012345678", "10月20日の午前", "なし", "なし", "はい", "はい", "はい"];
  let last;
  let session;
  for (const t of turns) {
    last = await json("/api/agent/turn", { method: "POST", body: JSON.stringify({ sessionId: sid, text: t, session }) });
    if (!last.res.ok) throw new Error(`turn "${t}" → ${last.res.status} ${JSON.stringify(last.body)}`);
    session = last.body.session;
    if (last.body.stage === "completed") break;
  }
  if (last.body.stage !== "completed" || !last.body.estimate) throw new Error(`stage=${last.body.stage} mode=${last.body.mode} reply=${last.body.reply}`);
  return `mode=${last.body.mode} estimate=${last.body.estimate.id}`;
});
await check("POST /api/realtime/session", async () => {
  const { res, body } = await json("/api/realtime/session", { method: "POST" });
  if (!res.ok || !body.ok) throw new Error(`status ${res.status}`);
  return `mode=${body.mode}`;
});
await check("POST /api/tts", async () => {
  const res = await fetch(`${BASE}/api/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "テスト" }) });
  if (res.status !== 200 && res.status !== 204) throw new Error(`status ${res.status}`);
  return `status ${res.status} mode=${res.headers.get("x-mode")}`;
});
await check("POST /api/twilio/voice (TwiML)", async () => {
  const res = await fetch(`${BASE}/api/twilio/voice`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ CallSid: "CA_smoke", From: "+819000000000", To: "+815000000000" }),
  });
  const xml = await res.text();
  if (!res.ok || !xml.includes("<Response>")) throw new Error(`status ${res.status}`);
  return xml.includes("<Gather") ? "AI対応（Gather）" : "スタッフ転送（Dial）";
});
await check("POST /api/twilio/gather (TwiML)", async () => {
  const res = await fetch(`${BASE}/api/twilio/gather`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ CallSid: "CA_smoke", SpeechResult: "畳の料金を教えてください" }),
  });
  const xml = await res.text();
  if (!res.ok || !xml.includes("<Say")) throw new Error(`status ${res.status}`);
  return xml.replace(/<[^>]+>/g, " ").trim().slice(0, 50) + "…";
});
await check("GET /api/line/webhook", async () => {
  const { res, body } = await json("/api/line/webhook");
  if (!res.ok) throw new Error(`status ${res.status}`);
  return `configured=${body.configured}`;
});
await check("GET /api/settings", async () => {
  const { res, body } = await json("/api/settings");
  if (res.status === 401) return "401（管理画面のパスワード保護あり）";
  if (!res.ok || !body.routing) throw new Error(`status ${res.status}`);
  return `${body.routing.handler}: ${body.routing.reason}`;
});

for (const [s, name, detail] of results) console.log(`${s === "PASS" ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
