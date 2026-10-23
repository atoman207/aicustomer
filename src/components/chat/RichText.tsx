// AI の回答を読みやすく表示する（【見出し】・「・」の箇条書き・「※」の注記・電話番号／URL のリンク）
//   ・日本語の本文の書き方にそろえる：全角の英数字は半角、金額は 3 桁区切り、長い段落は 1〜2 文ずつの段落に（jtext.ts）
//   ・文字を少しずつ受け取っている途中（ストリーミング中）でもそのまま使える
import type { ReactNode } from "react";
import { polishJa, toParagraphs } from "@/lib/jtext";

const TOKEN = /(https?:\/\/[^\s）)」』]+|0120[-‐ー－]?\d{2,3}[-‐ー－]?\d{3}|0\d{1,4}[-‐ー－]\d{1,4}[-‐ー－]\d{3,4})/g;

/** **太字**（大事な金額・結論）。閉じていない **（届いている途中）は記号だけ消す */
function inline(text: string, key: string): ReactNode[] {
  const parts = text.split(/\*\*([^*\n]+)\*\*/);
  if (parts.length === 1) return links(text.replace(/\*\*/g, ""), key);
  return parts.flatMap<ReactNode>((p, i) =>
    i % 2 === 1
      ? [
          <strong key={`${key}-b${i}`} className="font-bold text-sumi-900">
            {links(p, `${key}-b${i}`)}
          </strong>,
        ]
      : links(p.replace(/\*\*/g, ""), `${key}-t${i}`),
  );
}

function links(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const v = m[0];
    if (v.startsWith("http")) {
      out.push(
        <a key={`${key}-${i++}`} href={v} target="_blank" rel="noreferrer" className="break-all font-medium text-ichi-green underline underline-offset-2">
          {v}
        </a>,
      );
    } else {
      out.push(
        <a key={`${key}-${i++}`} href={`tel:${v.replace(/[^\d]/g, "")}`} className="whitespace-nowrap font-bold text-ichi-red underline underline-offset-2">
          {v}
        </a>,
      );
    }
    last = at + v.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block = { type: "p" | "note" | "head" | "total"; text: string; rest?: string } | { type: "list"; items: string[] };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of polishJa(text).split("\n")) {
    let line = raw.trimEnd();
    if (!line.trim()) continue;
    // 表（| 品名 | 金額 |）は、1行ずつの箇条書きにする（スマホでも読めるように）。区切りの行（|---|）は捨てる
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).filter(Boolean);
      const prevList = out[out.length - 1];
      // 表の見出しの行（最初の行）は、そのあとに行が続くなら見出しとして出す
      if (!(prevList && prevList.type === "list") && cells.length > 1 && cells.every((c) => !/\d/.test(c))) {
        out.push({ type: "head", text: cells.join("・") });
        continue;
      }
      line = `・${cells[0]}${cells.length > 1 ? `：${cells.slice(1).join("／")}` : ""}`;
    }
    // Markdown の見出し（### 料金の目安）は【見出し】と同じに
    const md = line.match(/^\s*#{1,4}\s+(.+)$/);
    if (md) {
      out.push({ type: "head", text: md[1].replace(/\*\*/g, "") });
      continue;
    }
    const item = line.match(/^\s*(?:[・･•]|[-*]\s|\d+[.)．]\s)\s*(.*)$/);
    if (item) {
      const prev = out[out.length - 1];
      if (prev && prev.type === "list") prev.items.push(item[1]);
      else out.push({ type: "list", items: [item[1]] });
      continue;
    }
    // 料金表から計算した合計（「合計の目安：112,200円（税込）」）
    const total = line.match(/^合計の目安[：:]\s*(.+)$/);
    if (total) {
      out.push({ type: "total", text: total[1] });
      continue;
    }
    const head = line.match(/^【([^】]{1,40})】\s*(.*)$/);
    if (head) {
      out.push({ type: "head", text: head[1], rest: head[2] });
      continue;
    }
    if (/^\s*※/.test(line)) {
      out.push({ type: "note", text: line.trim() });
      continue;
    }
    // 文章は 1〜2 文ずつの段落に分ける
    for (const p of toParagraphs(line.trim())) out.push({ type: "p", text: p });
  }
  return out;
}

export default function RichText({ text }: { text: string }) {
  const list = blocks(text);
  return (
    <div className="rich-ja space-y-2.5">
      {list.map((b, i) => {
        if (b.type === "list") {
          return (
            <ul key={i} className="space-y-1 py-0.5">
              {b.items.map((it, j) => (
                <li key={j} className="relative pl-3.5 before:absolute before:left-0 before:top-[0.7em] before:h-1.5 before:w-1.5 before:rounded-full before:bg-ichi-green/70">
                  {inline(it, `${i}-${j}`)}
                </li>
              ))}
            </ul>
          );
        }
        if (b.type === "head") {
          return (
            <p key={i} className="pt-1 font-bold text-ichi-theme">
              {b.text}
              {b.rest ? <span className="ml-1 text-[0.85em] font-normal text-sumi-500">{inline(b.rest, `${i}h`)}</span> : null}
            </p>
          );
        }
        if (b.type === "total") {
          const m = b.text.match(/^([\d,]+円(?:〜[\d,]+円)?)(.*)$/);
          return (
            <p key={i} data-total className="my-1 flex flex-wrap items-baseline gap-x-2 rounded-xl bg-ichi-cream px-3 py-2 ring-1 ring-ichi-yellow/60">
              <span className="text-[0.85em] font-bold text-ichi-theme">合計の目安</span>
              <span className="text-[1.15em] font-bold tabular-nums text-ichi-red">{m ? m[1] : b.text}</span>
              {m?.[2] ? <span className="text-[0.8em] text-sumi-500">{m[2]}</span> : null}
            </p>
          );
        }
        if (b.type === "note") {
          return (
            <p key={i} className="text-[0.85em] leading-relaxed text-sumi-500">
              {inline(b.text, `${i}n`)}
            </p>
          );
        }
        return <p key={i}>{inline(b.text, `${i}p`)}</p>;
      })}
    </div>
  );
}
