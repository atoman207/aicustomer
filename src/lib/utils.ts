// サーバー・クライアント共用のユーティリティ（Node専用APIは使わない）

export function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

/** JST の ISO8601 文字列（+09:00） */
export function nowJstIso(d: Date = new Date()): string {
  const t = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(
    t.getUTCMinutes(),
  )}:${pad(t.getUTCSeconds())}+09:00`;
}

export function formatJst(iso: string, withSeconds = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" as const } : {}),
    hour12: false,
  }).format(d);
}

export function newId(prefix: string, d: Date = new Date()): string {
  const t = new Date(d.getTime() + 9 * 3600 * 1000);
  const ymd = `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${ymd}-${rand}`;
}

export function uid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 日本語テキストの正規化（全角→半角、小文字化、空白・記号除去） */
export function normalizeJa(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[、。，．,.!?！？「」『』（）()\[\]【】・:：;；"'`~〜ー\-/／]/g, "");
}

/** 全角数字などを半角にし、電話番号らしく整形 */
export function normalizePhone(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‐－―ー−]/g, "-")
    .replace(/[^\d+\-]/g, "");
}

export function isLikelyPhone(s: string): boolean {
  const digits = normalizePhone(s).replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 11;
}

/** 発信者番号（+81 形式も）を国内形式にする。非通知など電話番号として使えない場合は undefined */
export function domesticPhone(raw: string | undefined): string | undefined {
  const p = normalizePhone(raw ?? "").replace(/^\+81-?/, "0");
  return isLikelyPhone(p) ? p : undefined;
}

const DIGIT_READING = ["ゼロ", "イチ", "ニ", "サン", "ヨン", "ゴ", "ロク", "ナナ", "ハチ", "キュウ"];

/** 電話番号の数字を読み上げ用のカタカナに（例：4444 → ヨンヨンヨンヨン） */
export function readDigits(digits: string): string {
  return digits.replace(/\D/g, "").split("").map((d) => DIGIT_READING[Number(d)]).join("");
}

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}
