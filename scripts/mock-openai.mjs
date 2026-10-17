// OpenAI API の最小モック（動作確認用）。
// 使い方: node scripts/mock-openai.mjs  → 別ターミナルで
//   OPENAI_API_KEY=sk-mock OPENAI_BASE_URL=http://localhost:3199/v1 npm start
import http from "http";

const PORT = Number(process.env.MOCK_PORT || 3199);

function hashVec(text, dim = 16) {
  let h = 2166136261;
  const v = [];
  for (let i = 0; i < dim; i++) {
    for (const ch of `${text}${i}`) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    v.push(((h >>> 0) % 1000) / 1000 - 0.5);
  }
  return v;
}

const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const url = req.url ?? "";
  const json = (code, obj) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  if (!(req.headers.authorization ?? "").startsWith("Bearer ")) return json(401, { error: { message: "missing api key" } });

  if (url.startsWith("/v1/models/")) return json(200, { id: decodeURIComponent(url.split("/").pop()), object: "model" });

  if (url === "/v1/chat/completions") {
    const b = JSON.parse(body || "{}");
    const sys = b.messages?.[0]?.content ?? "";
    const lastUser = [...(b.messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "";
    if (b.response_format?.type === "json_schema") {
      const content = JSON.stringify({
        reply: `（モック）かしこまりました。「${lastUser.slice(0, 20)}」について承りました。復唱内容で受付いたします。`,
        stage: "completed",
        draft: {
          name: "山田 花子",
          address: "熊本県熊本市中央区水前寺1-2-3",
          phone: "090-1234-5678",
          dates: ["10月20日 午前", "10月21日 午後"],
          summary: "6畳和室の畳の表替え（モック要約）",
        },
        customer_confirmed: true,
        end_call: true,
      });
      return json(200, { id: "chatcmpl-mock", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] });
    }
    const text = sys.includes("要約")
      ? "6畳和室の畳の表替えをご希望。ペットがいるため和紙表も検討（モック要約）。"
      : `（モック応答）ご質問「${lastUser.slice(0, 30)}」について、社内ナレッジに基づきご案内します。正式なお見積りは現地確認後にご提示します。`;
    if (b.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const c of text.match(/.{1,6}/g) ?? [text]) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
        await new Promise((r) => setTimeout(r, 5));
      }
      res.write("data: [DONE]\n\n");
      return res.end();
    }
    return json(200, { choices: [{ message: { role: "assistant", content: text } }] });
  }

  if (url === "/v1/embeddings") {
    const b = JSON.parse(body || "{}");
    const inputs = Array.isArray(b.input) ? b.input : [b.input];
    return json(200, { data: inputs.map((t, i) => ({ index: i, embedding: hashVec(String(t)) })) });
  }

  if (url === "/v1/audio/speech") {
    res.writeHead(200, { "content-type": "audio/mpeg" });
    return res.end(Buffer.from([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0]));
  }

  if (url === "/v1/realtime/client_secrets") {
    return json(200, { value: "ek_mock", expires_at: Math.floor(Date.now() / 1000) + 600, session: {} });
  }

  json(404, { error: { message: `mock: unknown endpoint ${url}` } });
});

server.listen(PORT, () => console.log(`mock openai listening on http://localhost:${PORT}/v1`));
