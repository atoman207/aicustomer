// 依存ライブラリなしの .xlsx 読み取り（ZIP 展開 + シート XML の解析）。サーバー専用
//   ・共有文字列／インライン文字列／数値に対応（数式は計算結果の値を使用）
//   ・結合セルは左上のセルにだけ値が入る（Google スプレッドシートの getValues と同じ扱い）
import zlib from "zlib";

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  offset: number;
}

function readZipEntries(buf: Buffer): ZipEntry[] {
  // End of Central Directory（末尾から探す）
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("xlsx（ZIP）の形式が正しくありません");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    entries.push({ name, method, compressedSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipFile(buf: Buffer, e: ZipEntry): string {
  const nameLen = buf.readUInt16LE(e.offset + 26);
  const extraLen = buf.readUInt16LE(e.offset + 28);
  const start = e.offset + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return data.toString("utf8");
  if (e.method === 8) return zlib.inflateRawSync(data).toString("utf8");
  throw new Error(`未対応の圧縮形式です（${e.method}）`);
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/** <si> や <is> の中のテキスト（リッチテキストの <r><t> も連結。ふりがな <rPh> は除く） */
function richText(xml: string): string {
  const body = xml.replace(/<rPh[\s\S]*?<\/rPh>/g, "");
  return decodeXml([...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
}

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 数値セルの表記（44000.0 → 44000、0.1+0.2 のような誤差は丸める） */
function numberText(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1e6) / 1e6);
}

export interface XlsxSheet {
  name: string;
  /** rows[r][c]（0 始まり）。空行・空セルも位置を保つ */
  rows: string[][];
}

/** ワークブックの全シートを読み込む */
export function readXlsx(buf: Buffer): XlsxSheet[] {
  const entries = readZipEntries(buf);
  const file = (name: string): string | null => {
    const e = entries.find((x) => x.name === name);
    return e ? readZipFile(buf, e) : null;
  };
  const workbook = file("xl/workbook.xml");
  if (!workbook) throw new Error("xl/workbook.xml が見つかりません");
  const rels = file("xl/_rels/workbook.xml.rels") ?? "";
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\s[^>]*>/g)) {
    const id = m[0].match(/Id="([^"]+)"/)?.[1];
    const t = m[0].match(/Target="([^"]+)"/)?.[1];
    if (id && t) target.set(id, t.startsWith("/") ? t.slice(1) : `xl/${t}`);
  }
  const ss = file("xl/sharedStrings.xml") ?? "";
  const shared = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => richText(m[1]));

  const sheets: XlsxSheet[] = [];
  for (const m of workbook.matchAll(/<sheet\s[^>]*>/g)) {
    const name = decodeXml(m[0].match(/name="([^"]+)"/)?.[1] ?? "");
    const rid = m[0].match(/r:id="([^"]+)"/)?.[1] ?? "";
    const xml = file(target.get(rid) ?? "");
    if (!xml) continue;
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row\s([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rowNo = Number(r[1].match(/\br="(\d+)"/)?.[1] ?? rows.length + 1);
      const cells: string[] = [];
      for (const c of (r[2] ?? "").matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = c[1].match(/\br="([A-Z]+)\d+"/)?.[1];
        if (!ref) continue;
        const t = c[1].match(/\bt="([^"]+)"/)?.[1];
        const inner = c[2] ?? "";
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let text = "";
        if (t === "s") text = v !== undefined ? (shared[Number(v)] ?? "") : "";
        else if (t === "inlineStr") text = richText(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? "");
        else if (t === "b") text = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
        else if (t === "str" || t === "e") text = v !== undefined ? decodeXml(v) : "";
        else if (v !== undefined) text = numberText(decodeXml(v));
        cells[colIndex(ref)] = text;
      }
      rows[rowNo - 1] = Array.from(cells, (x) => x ?? "");
    }
    sheets.push({ name, rows: Array.from(rows, (x) => x ?? []) });
  }
  return sheets;
}
