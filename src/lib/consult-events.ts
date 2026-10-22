// ページのほかの場所から AI 相談の画面（ConsultConsole）を操作する合図（ブラウザ専用・小さく保つ）

/** window に送るイベントの名前 */
export const CONSULT_EVENT = "ichijoya:consult";

export type ConsultCommand = { action: "voice" } | { action: "text" } | { action: "ask"; q: string };

/** このページに相談の画面があれば、そこに合図を送る（送ったら true） */
export function sendConsultCommand(cmd: ConsultCommand): boolean {
  if (typeof document === "undefined" || !document.querySelector("[data-consult-console]")) return false;
  window.dispatchEvent(new CustomEvent(CONSULT_EVENT, { detail: cmd }));
  return true;
}
