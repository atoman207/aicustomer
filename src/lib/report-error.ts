// 画面で起きたエラーを管理画面の「エラー履歴」に記録する（ブラウザ専用。失敗しても何もしない）
export function reportClientError(where: string, error: unknown): void {
  try {
    const e = error as { message?: string; digest?: string; stack?: string };
    const ua = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 120) : "";
    const message = `${e?.message ?? String(error)}${e?.digest ? `（digest ${e.digest}）` : ""}｜${ua}｜${typeof location !== "undefined" ? location.pathname : ""}`.slice(0, 300);
    void fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "browser", where, message }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // noop
  }
}
