"use client";

// 管理画面「情報を追加」：ChatGPT のような入力欄に会社の情報を書くか、ファイルを添付して送ると、
// AI が解析して話題ごとのナレッジに整理し、Supabase に保存する（保存した内容はその場で確認・編集できる）
import { ArrowUp, FileText, Loader2, Paperclip, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SOURCE_CATEGORIES, UPLOAD_ACCEPT, UPLOAD_MAX_BYTES } from "@/lib/knowledge-categories";
import { EntryCard, EntryEditor } from "./KnowledgeViews";
import { api, ApiError, Chip, formatSize, type AdminEntry, type Source } from "./shared";

interface Turn {
  id: string;
  text: string;
  fileName?: string;
  fileSize?: number;
  category: string;
  pending: boolean;
  source?: Source;
  entries?: AdminEntry[];
  mode?: string;
  note?: string;
  error?: string;
}

const EXAMPLES = [
  { title: "営業のお知らせ", text: "年末年始の休業日は12月29日〜1月4日です。休業中もAI相談とAI電話受付はご利用いただけます。", category: "campaign" },
  { title: "商品の説明", text: "畳表「さくら」は熊本のブランドい草「ひのみどり」を使った国産の上質な畳表です。耐用年数の目安は20年です。", category: "product" },
  { title: "料金表（Excel）を差し替え", text: "", category: "price_manual", hint: "顧客対応マニュアルの Excel を添付" },
  { title: "パンフレット（PDF）を登録", text: "", category: "auto", hint: "PDF・写真・Word などを添付" },
];

const MODE_LABEL: Record<string, string> = { openai: "AI が解析", rules: "見出しごとに登録", table: "表を読み取り" };

export function AddView({ ready, onSaved, onSetupRequired }: { ready: boolean; onSaved: (s: Source) => void; onSetupRequired: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("auto");
  const [dragging, setDragging] = useState(false);
  const [hint, setHint] = useState("");
  const [editing, setEditing] = useState<AdminEntry | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = turns.some((t) => t.pending);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [text]);

  function pick(f: File | null | undefined) {
    if (!f) return;
    if (f.size > UPLOAD_MAX_BYTES) {
      setHint(`ファイルは ${formatSize(UPLOAD_MAX_BYTES)} までです（${f.name}：${formatSize(f.size)}）`);
      return;
    }
    setHint("");
    setFile(f);
    if (/\.(xlsx|xlsm)$/i.test(f.name) && /マニュアル|料金/.test(f.name)) setCategory("price_manual");
  }

  async function send() {
    if (busy || (!text.trim() && !file)) return;
    if (category === "price_manual" && !file) {
      setHint("「料金表・顧客対応マニュアル」は Excel ファイルを添付してください");
      return;
    }
    const turn: Turn = { id: `${Date.now()}`, text: text.trim(), fileName: file?.name, fileSize: file?.size, category, pending: true };
    setTurns((list) => [...list, turn]);
    const form = new FormData();
    form.set("category", category);
    if (text.trim()) form.set("text", text.trim());
    if (file) form.set("file", file);
    setText("");
    setFile(null);
    setHint("");
    try {
      const j = await api<{ source: Source; entries: AdminEntry[]; mode: string; note?: string }>("/api/admin/sources", { method: "POST", body: form });
      setTurns((list) => list.map((t) => (t.id === turn.id ? { ...t, pending: false, source: j.source, entries: j.entries, mode: j.mode, note: j.note } : t)));
      onSaved(j.source);
    } catch (e) {
      if (e instanceof ApiError && e.setupRequired) onSetupRequired();
      setTurns((list) => list.map((t) => (t.id === turn.id ? { ...t, pending: false, error: (e as Error).message } : t)));
    }
  }

  const empty = turns.length === 0;
  const composer = (
    <div
      className={`rounded-[26px] border bg-white p-2.5 shadow-[0_2px_14px_rgba(0,0,0,0.07)] transition ${dragging ? "border-[#0d0d0d] ring-4 ring-black/5" : "border-black/10"}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        pick(e.dataTransfer.files?.[0]);
      }}
    >
      {file ? (
        <div className="mb-2 flex items-center gap-2 rounded-2xl bg-[#f4f4f4] px-3 py-2">
          <FileText className="h-5 w-5 shrink-0 text-[#5d5d5d]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-[#0d0d0d]">{file.name}</p>
            <p className="text-[11px] text-[#8f8f8f]">{formatSize(file.size)}</p>
          </div>
          <button type="button" className="grid h-7 w-7 place-items-center rounded-full text-[#5d5d5d] hover:bg-black/10" onClick={() => setFile(null)} aria-label="添付を外す">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      <textarea
        ref={areaRef}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={file ? "ファイルについての補足があれば入力（任意）" : "会社の情報を入力するか、ファイルを添付してください（Enter で送信・Shift+Enter で改行）"}
        className="block max-h-[260px] w-full resize-none bg-transparent px-2.5 py-2 text-[15px] leading-relaxed text-[#0d0d0d] outline-none placeholder:text-[#8f8f8f]"
        disabled={!ready}
        aria-label="追加する情報"
      />
      <div className="mt-1 flex items-center gap-1.5">
        <input ref={fileRef} type="file" accept={UPLOAD_ACCEPT} className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="grid h-9 w-9 place-items-center rounded-full border border-black/10 text-[#3d3d3d] transition hover:bg-black/[0.05] disabled:opacity-40"
          aria-label="ファイルを添付"
          title="ファイルを添付（Excel・CSV・Word・PowerPoint・PDF・画像・テキスト）"
          disabled={!ready}
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-9 max-w-[60vw] cursor-pointer truncate rounded-full border border-black/10 bg-white px-3 text-[13px] text-[#3d3d3d] outline-none hover:bg-black/[0.03] sm:max-w-[340px]"
          aria-label="分類"
          disabled={!ready}
        >
          {SOURCE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!ready || busy || (!text.trim() && !file)}
          className="grid h-9 w-9 place-items-center rounded-full bg-[#0d0d0d] text-white transition hover:bg-black/80 disabled:bg-black/15"
          aria-label="送信して保存"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {empty ? (
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-4 py-10 sm:px-6">
            <h2 className="text-center text-2xl font-semibold text-[#0d0d0d] sm:text-[28px]">一畳屋の情報を AI に教える</h2>
            <p className="mt-2 text-center text-sm leading-relaxed text-[#5d5d5d]">
              文章を入力するか、ファイル（Excel・CSV・Word・PowerPoint・PDF・画像・テキスト）を添付して送ってください。
              <br className="hidden sm:inline" />
              AI が内容を解析して話題ごとに整理し、データベースに保存します。保存した情報は、すぐにお客様への回答に使われます。
            </p>
            <div className="mt-6">{composer}</div>
            {hint ? <p className="mt-2 text-center text-xs text-red-600">{hint}</p> : null}
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.title}
                  type="button"
                  disabled={!ready}
                  onClick={() => {
                    setCategory(ex.category);
                    if (ex.text) setText(ex.text);
                    else fileRef.current?.click();
                    areaRef.current?.focus();
                  }}
                  className="rounded-2xl border border-black/[0.08] px-4 py-3 text-left transition hover:bg-black/[0.03] disabled:opacity-50"
                >
                  <p className="text-sm font-medium text-[#0d0d0d]">{ex.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-[#8f8f8f]">{ex.text || ex.hint}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6">
            {turns.map((t) => (
              <div key={t.id} className="space-y-3">
                <div className="flex justify-end">
                  <div className="max-w-[85%] space-y-1.5">
                    {t.fileName ? (
                      <div className="ml-auto flex w-fit items-center gap-2 rounded-2xl border border-black/[0.08] bg-white px-3 py-2">
                        <FileText className="h-4 w-4 text-[#5d5d5d]" />
                        <span className="text-sm text-[#0d0d0d]">{t.fileName}</span>
                        <span className="text-[11px] text-[#8f8f8f]">{formatSize(t.fileSize)}</span>
                      </div>
                    ) : null}
                    {t.text ? <p className="whitespace-pre-wrap rounded-3xl bg-[#f4f4f4] px-5 py-2.5 text-[15px] leading-relaxed text-[#0d0d0d]">{t.text}</p> : null}
                    <p className="text-right text-[11px] text-[#8f8f8f]">{SOURCE_CATEGORIES.find((c) => c.value === t.category)?.label}</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-black/10 bg-white">
                    <img src="/ichijoya/logo-symbol.svg" alt="" className="w-[60%]" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-3 pt-1">
                    {t.pending ? (
                      <p className="flex items-center gap-2 text-sm text-[#5d5d5d]">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t.fileName ? "ファイルを読み取って整理しています…（PDF や長い資料は 1 分ほどかかります）" : "内容を整理しています…"}
                      </p>
                    ) : t.error ? (
                      <p className="text-sm text-red-600">{t.error}</p>
                    ) : (
                      <>
                        <p className="text-[15px] leading-relaxed text-[#0d0d0d]">
                          {t.entries?.length ? (
                            <>
                              <Sparkles className="mr-1 inline h-4 w-4 text-[#0d0d0d]" />
                              {t.entries.length} 件のナレッジとしてデータベースに保存しました。AI の回答にすぐ使われます。
                            </>
                          ) : (
                            "お客様対応に使える情報が見つかりませんでした。内容を確認して、もう一度お試しください。"
                          )}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {t.mode ? <Chip>{MODE_LABEL[t.mode] ?? t.mode}</Chip> : null}
                          {t.note ? <Chip tone="amber">{t.note}</Chip> : null}
                        </div>
                        <div className="space-y-2">
                          {(t.entries ?? []).map((e) => (
                            <EntryCard key={e.id} e={e} onEdit={() => setEditing(e)} />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>
      {!empty ? (
        <div className="border-t border-black/[0.04] bg-white px-4 pb-4 pt-3 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            {composer}
            {hint ? <p className="mt-2 text-xs text-red-600">{hint}</p> : null}
            <p className="mt-2 text-center text-[11px] text-[#8f8f8f]">AI は資料に書かれた事実だけを使い、原価などの社内向けの情報は登録しません。保存した内容は「登録済みナレッジ」で編集できます。</p>
          </div>
        </div>
      ) : null}
      <EntryEditor
        entry={editing}
        onClose={() => setEditing(null)}
        onSaved={(saved) => setTurns((list) => list.map((t) => ({ ...t, entries: t.entries?.map((x) => (x.id === saved.id ? { ...x, ...saved } : x)) })))}
      />
    </div>
  );
}
