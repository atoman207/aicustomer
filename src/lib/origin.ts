// リクエストが届いた URL の頭（https://ホスト名）。Next の部品を使わない（twiml.ts など、どこからでも使えるように）

export function requestOrigin(req: Request): string {
  const h = req.headers;
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000").split(",")[0].trim();
  const proto = (h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https")).split(",")[0].trim();
  return `${proto}://${host}`;
}
