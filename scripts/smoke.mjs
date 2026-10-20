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

await check("GET / (トップページ：AIの窓口は文字・声の2つ＋電話ボタン)", async () => {
  const res = await fetch(`${BASE}/`);
  const html = await res.text();
  if (!res.ok || !html.includes("に相談する") || !html.includes("logo-color.svg")) throw new Error(`status ${res.status}`);
  const channels = [...html.matchAll(/data-channel="([^"]+)"/g)].map((m) => m[1]);
  if (channels.join(",") !== "/chat,/voice") throw new Error(`窓口: ${channels.join(",") || "なし"}`);
  if (!html.includes("営業時間外・土日はAIが受付") || !html.includes('href="tel:0120158108"')) throw new Error("電話ボタンの案内がありません");
  return `${res.status} ${html.length}B 窓口=${channels.join("・")}`;
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
await check("GET /api/knowledge（マニュアル・会社情報・ホームページの JSON）", async () => {
  const { res, body } = await json("/api/knowledge");
  if (res.status === 401) {
    // 管理画面のパスワード保護あり → 公開の接続状況で件数だけ確認
    const k = (await json("/api/status")).body.knowledge;
    if (k.source === "local" || !(k.entries > 0)) throw new Error(`knowledge ${k.source}(${k.entries}) ${k.warning ?? ""}`);
    return `401（管理画面のパスワード保護あり）／ ${k.source}: ${k.entries} entries`;
  }
  if (!res.ok || !Array.isArray(body.entries) || body.entries.length === 0) throw new Error(`status ${res.status}`);
  const st = body.stats ?? {};
  if (body.source === "local" || !(st.manualTables > 0) || !(st.company > 0) || !(st.website > 0)) throw new Error(`sources missing: ${body.source} ${JSON.stringify(st)}`);
  return `${body.entries.length} entries（${body.source}: 文章${st.manualText}・料金表${st.manualTables} / 会社情報${st.company} / HP${st.website}）`;
});
await check("管理画面の API（ADMIN_PASSWORD 設定時はログインが必要）", async () => {
  const { body } = await json("/api/status");
  const paths = ["/api/knowledge", "/api/estimates", "/api/conversations", "/api/usage", "/api/settings"];
  const codes = await Promise.all(paths.map(async (p) => (await fetch(`${BASE}${p}`)).status));
  const refresh = (await fetch(`${BASE}/api/knowledge/refresh`, { method: "POST" })).status;
  const all = [...codes, refresh];
  if (!body.admin.protected) return `未設定のため誰でも閲覧可（公開 URL では ADMIN_PASSWORD を設定）: ${all.join(",")}`;
  if (all.some((c) => c !== 401)) throw new Error(`保護されていない API: ${[...paths, "/api/knowledge/refresh"].filter((_, i) => all[i] !== 401).join(", ")}`);
  return `保護あり（${all.length} 件とも 401）`;
});
await check("POST /api/knowledge/search（料金は料金表から回答）", async () => {
  const { res, body } = await json("/api/knowledge/search", { method: "POST", body: JSON.stringify({ query: "6畳の畳の表替えはいくら？" }) });
  if (!res.ok || !(body.answer || body.hits?.length)) throw new Error(`status ${res.status} ${JSON.stringify(body).slice(0, 100)}`);
  if (body.answer && !/円/.test(body.answer)) throw new Error(`no price in answer: ${body.answer.slice(0, 80)}`);
  return `${body.mode}/${body.kind}: ${(body.answer ?? body.hits[0].title).slice(0, 40)}`;
});
await check("POST /api/chat（料金表から AI なしで即答）", async () => {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "smoke-price", channel: "web_text", messages: [{ role: "user", content: "朱雀の襖の両面はいくら？" }] }),
  });
  const text = await res.text();
  if (!res.ok || res.headers.get("x-mode") !== "local" || !/23,100円/.test(text)) throw new Error(`mode=${res.headers.get("x-mode")} ${text.slice(0, 80)}`);
  return `mode=local ${text.split("\n")[1] ?? ""}`;
});
await check("POST /api/knowledge/answer（よくある質問は AI なし）", async () => {
  const { res, body } = await json("/api/knowledge/answer", { method: "POST", body: JSON.stringify({ question: "営業時間を教えてください" }) });
  if (!res.ok || body.mode !== "local" || !/17:00/.test(body.reply)) throw new Error(`${body.mode} ${String(body.reply).slice(0, 80)}`);
  return `${body.mode}/${body.kind}: ${body.reply.slice(0, 30)}…`;
});
await check("POST /api/knowledge/answer（商品知識：耐用年数・障子の新調・ヘリの料金）", async () => {
  const cases = [
    ["極みは何年もちますか？", "faq", /30年/],
    ["障子の新調はいくらですか？", "faq", /現場を見て/],
    ["畳のヘリの値段は？", "price", /純金/],
  ];
  const out = [];
  for (const [question, kind, re] of cases) {
    const { res, body } = await json("/api/knowledge/answer", { method: "POST", body: JSON.stringify({ question }) });
    if (!res.ok || body.kind !== kind || !re.test(body.reply)) throw new Error(`${question} → ${body.mode}/${body.kind} ${String(body.reply).slice(0, 50)}`);
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
    }),
  });
  if (!res.ok || !body.ok) throw new Error(`status ${res.status} ${JSON.stringify(body)}`);
  return `${body.estimate.id} → ${body.sink}`;
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
