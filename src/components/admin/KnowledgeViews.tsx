"use client";

// 管理画面：登録済みナレッジの一覧・編集、追加した情報（文章・ファイル）ごとの詳細
import { ExternalLink, FileText, Loader2, Pencil, RefreshCw, Search, Table2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { categoryOf, ENTRY_CATEGORIES } from "@/lib/knowledge-categories";
import type { KnowledgeOrigin } from "@/lib/types";
import { AdminModal, api, ApiError, btn, Chip, ErrorNote, field, formatDate, formatSize, ORIGIN_LABEL, type AdminEntry, type Source } from "./shared";

// ---------------- ナレッジ 1 件 ----------------

export function EntryCard({ e, onEdit, onToggle, onDelete }: { e: AdminEntry; onEdit?: () => void; onToggle?: () => void; onDelete?: () => void }) {
  const [open, setOpen] = useState(false);
  const long = e.content.length > 220;
  return (
    <div className={`rounded-2xl border border-black/[0.08] bg-white p-4 transition ${e.enabled === false ? "opacity-55" : ""}`}>
      <div className="flex flex-wrap items-start gap-2">
        <p className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-[#0d0d0d]">{e.title}</p>
        <div className="flex items-center gap-0.5">
          {onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              className={`relative mr-1 h-5 w-9 rounded-full transition ${e.enabled === false ? "bg-black/15" : "bg-[#0d0d0d]"}`}
              aria-label={e.enabled === false ? "使う" : "使わない"}
              title={e.enabled === false ? "AI の回答に使っていません（クリックで使う）" : "AI の回答に使っています（クリックで使わない）"}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${e.enabled === false ? "left-0.5" : "left-[18px]"}`} />
            </button>
          ) : null}
          {onEdit ? (
            <button type="button" className={btn.icon} onClick={onEdit} aria-label="編集" title="編集">
              <Pencil className="h-4 w-4" />
            </button>
          ) : null}
          {onDelete ? (
            <button type="button" className={`${btn.icon} hover:text-red-600`} onClick={onDelete} aria-label="削除" title="削除">
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {e.origin ? <Chip>{ORIGIN_LABEL[e.origin]}</Chip> : null}
        {e.category ? <Chip tone="blue">{e.category}</Chip> : null}
        {e.hasTable ? (
          <Chip tone="green">
            <Table2 className="h-3 w-3" />
            料金表
          </Chip>
        ) : null}
        {e.edited && (e.origin === "manual" || e.origin === "company" || e.origin === "website") ? <Chip tone="amber">編集済み</Chip> : null}
        {e.enabled === false ? <Chip tone="red">使っていません</Chip> : null}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#3d3d3d]">{open || !long ? e.content : `${e.content.slice(0, 220)}…`}</p>
      {long ? (
        <button type="button" className="mt-1 text-xs text-[#5d5d5d] underline underline-offset-2" onClick={() => setOpen(!open)}>
          {open ? "閉じる" : "すべて表示"}
        </button>
      ) : null}
      {e.questions?.length ? <p className="mt-2 text-xs text-[#8f8f8f]">聞き方の例：{e.questions.slice(0, 4).join("／")}</p> : null}
    </div>
  );
}

// ---------------- 編集 ----------------

export function EntryEditor({ entry, onClose, onSaved }: { entry: AdminEntry | null; onClose: () => void; onSaved: (e: AdminEntry) => void }) {
  const [draft, setDraft] = useState<AdminEntry | null>(entry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft(entry);
    setError("");
  }, [entry]);
  if (!draft) return null;

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const j = await api<{ entry: AdminEntry }>(`/api/admin/knowledge/${encodeURIComponent(draft.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ category: draft.category, title: draft.title, content: draft.content, keywords: draft.keywords, questions: draft.questions ?? [] }),
      });
      onSaved(j.entry);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminModal open={!!entry} onClose={onClose} title="ナレッジを編集" wide>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
          <label className="text-xs text-[#5d5d5d]">
            分類
            <select className={`${field} mt-1`} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
              {[...new Set([draft.category, ...ENTRY_CATEGORIES].filter(Boolean))].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[#5d5d5d]">
            項目名
            <input className={`${field} mt-1`} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required />
          </label>
        </div>
        <label className="block text-xs text-[#5d5d5d]">
          内容（AI がお客様に答える文章）
          <textarea className={`${field} mt-1 min-h-[180px] leading-relaxed`} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} required />
        </label>
        <label className="block text-xs text-[#5d5d5d]">
          キーワード（読点・カンマ区切り）
          <input
            className={`${field} mt-1`}
            value={draft.keywords.join("、")}
            onChange={(e) => setDraft({ ...draft, keywords: e.target.value.split(/[、,，]+/).map((k) => k.trim()).filter(Boolean) })}
          />
        </label>
        <label className="block text-xs text-[#5d5d5d]">
          お客様の聞き方の例（1 行に 1 つ。近い質問には AI を使わずにこの内容で答えます）
          <textarea
            className={`${field} mt-1 min-h-[90px]`}
            value={(draft.questions ?? []).join("\n")}
            onChange={(e) => setDraft({ ...draft, questions: e.target.value.split("\n").map((k) => k.trim()).filter(Boolean) })}
          />
        </label>
        {draft.hasTable ? <p className="text-xs text-[#8f8f8f]">※料金表の金額は、元の Excel を修正してアップロードし直すと更新されます。</p> : null}
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className={btn.primary} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            保存して反映
          </button>
        </div>
      </form>
    </AdminModal>
  );
}

// 一覧で使う共通の操作（使う／使わない・削除）
function useEntryActions(setEntries: React.Dispatch<React.SetStateAction<AdminEntry[]>>, setError: (m: string) => void) {
  const toggle = useCallback(
    async (e: AdminEntry) => {
      try {
        const j = await api<{ entry: AdminEntry }>(`/api/admin/knowledge/${encodeURIComponent(e.id)}`, { method: "PATCH", body: JSON.stringify({ enabled: e.enabled === false }) });
        setEntries((list) => list.map((x) => (x.id === e.id ? { ...x, ...j.entry } : x)));
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [setEntries, setError],
  );
  const remove = useCallback(
    async (e: AdminEntry) => {
      const bundled = e.origin === "manual" || e.origin === "company" || e.origin === "website";
      if (!window.confirm(bundled ? `「${e.title}」を AI の回答に使わないようにしますか？` : `「${e.title}」を削除しますか？`)) return;
      try {
        await api(`/api/admin/knowledge/${encodeURIComponent(e.id)}`, { method: "DELETE" });
        setEntries((list) => (bundled ? list.map((x) => (x.id === e.id ? { ...x, enabled: false, edited: true } : x)) : list.filter((x) => x.id !== e.id)));
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [setEntries, setError],
  );
  return { toggle, remove };
}

// ---------------- 登録済みナレッジ ----------------

const ORIGINS: KnowledgeOrigin[] = ["admin", "upload", "manual", "company", "website"];

export function KnowledgeListView({ onSetupRequired }: { onSetupRequired: () => void }) {
  const [entries, setEntries] = useState<AdminEntry[]>([]);
  const [stale, setStale] = useState<{ id: string; title: string; missing: string[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [q, setQ] = useState("");
  const [origin, setOrigin] = useState<"" | KnowledgeOrigin>("");
  const [category, setCategory] = useState("");
  const [showDisabled, setShowDisabled] = useState(false);
  const [editing, setEditing] = useState<AdminEntry | null>(null);
  const [syncing, setSyncing] = useState(false);
  const { toggle, remove } = useEntryActions(setEntries, setError);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const j = await api<{ entries: AdminEntry[]; stale: typeof stale }>("/api/admin/knowledge");
      setEntries(j.entries);
      setStale(j.stale ?? []);
    } catch (e) {
      if (e instanceof ApiError && e.setupRequired) onSetupRequired();
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onSetupRequired]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resync() {
    if (!window.confirm("同梱のデータ（顧客対応マニュアル・会社情報・ホームページの JSON）を取り込み直しますか？\n管理画面で編集した項目はそのまま残ります。")) return;
    setSyncing(true);
    setInfo("");
    try {
      const j = await api<{ sync?: { upserted: number; removed: number } }>("/api/admin/setup", { method: "POST" });
      setInfo(`取り込みました（更新 ${j.sync?.upserted ?? 0} 件・削除 ${j.sync?.removed ?? 0} 件）`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  const categories = useMemo(() => [...new Set(entries.map((e) => e.category).filter(Boolean))].sort(), [entries]);
  const filtered = useMemo(() => {
    const f = q.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (showDisabled || e.enabled !== false) &&
        (!origin || e.origin === origin) &&
        (!category || e.category === category) &&
        (!f || `${e.title} ${e.content} ${e.category} ${e.keywords.join(" ")} ${(e.questions ?? []).join(" ")}`.toLowerCase().includes(f)),
    );
  }, [entries, q, origin, category, showDisabled]);
  const counts = useMemo(() => Object.fromEntries(ORIGINS.map((o) => [o, entries.filter((e) => e.origin === o && e.enabled !== false).length])), [entries]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[#0d0d0d]">登録済みナレッジ</h2>
          <p className="mt-1 text-sm text-[#5d5d5d]">AI がお客様に答えるときに使う情報です。編集はすぐに AI の回答に反映されます。</p>
        </div>
        <button type="button" className={btn.ghost} onClick={resync} disabled={syncing}>
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          同梱データを取り込み直す
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setOrigin("")} className={`rounded-full px-3 py-1 text-xs transition ${origin === "" ? "bg-[#0d0d0d] text-white" : "bg-black/[0.05] text-[#3d3d3d] hover:bg-black/10"}`}>
          すべて {entries.filter((e) => e.enabled !== false).length}
        </button>
        {ORIGINS.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setOrigin(o)}
            className={`rounded-full px-3 py-1 text-xs transition ${origin === o ? "bg-[#0d0d0d] text-white" : "bg-black/[0.05] text-[#3d3d3d] hover:bg-black/10"}`}
          >
            {ORIGIN_LABEL[o]} {counts[o] ?? 0}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8f8f8f]" />
          <input className={`${field} pl-9`} placeholder="キーワードで探す（例：ヘリ、営業時間、ダニ）" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={`${field} w-auto`} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="分類で絞り込み">
          <option value="">すべての分類</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-[#5d5d5d]">
          <input type="checkbox" checked={showDisabled} onChange={(e) => setShowDisabled(e.target.checked)} />
          使っていない項目も表示
        </label>
      </div>

      {stale.length ? (
        <p className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-800">
          内容が顧客対応マニュアルと合わないため、AI が使っていない会社情報：{stale.map((s) => `「${s.title}」`).join("")}（マニュアル側の表記が変わった可能性があります）
        </p>
      ) : null}
      <ErrorNote message={error} />
      {info ? <p className="rounded-xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">{info}</p> : null}

      {loading ? (
        <p className="flex items-center gap-2 py-10 text-sm text-[#8f8f8f]">
          <Loader2 className="h-4 w-4 animate-spin" />
          読み込み中…
        </p>
      ) : (
        <>
          <p className="text-xs text-[#8f8f8f]">{filtered.length} 件</p>
          <div className="space-y-2.5">
            {filtered.map((e) => (
              <EntryCard key={e.id} e={e} onEdit={() => setEditing(e)} onToggle={() => toggle(e)} onDelete={() => remove(e)} />
            ))}
            {filtered.length === 0 ? <p className="py-10 text-center text-sm text-[#8f8f8f]">該当するナレッジはありません</p> : null}
          </div>
        </>
      )}
      <EntryEditor entry={editing} onClose={() => setEditing(null)} onSaved={(saved) => setEntries((list) => list.map((x) => (x.id === saved.id ? { ...x, ...saved } : x)))} />
    </div>
  );
}

// ---------------- 追加した情報（文章・ファイル）ごとの詳細 ----------------

export function SourceView({ id, onDeleted, onSetupRequired }: { id: string; onDeleted: () => void; onSetupRequired: () => void }) {
  const [source, setSource] = useState<Source | null>(null);
  const [entries, setEntries] = useState<AdminEntry[]>([]);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<AdminEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toggle, remove } = useEntryActions(setEntries, setError);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    api<{ source: Source; entries: AdminEntry[]; fileUrl: string | null }>(`/api/admin/sources/${encodeURIComponent(id)}`)
      .then((j) => {
        if (!alive) return;
        setSource(j.source);
        setEntries(j.entries);
        setFileUrl(j.fileUrl);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.setupRequired) onSetupRequired();
        if (alive) setError((e as Error).message);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, onSetupRequired]);

  async function removeSource() {
    if (!source) return;
    const manual = source.category === "price_manual";
    if (!window.confirm(`「${source.name}」と、そこから作ったナレッジ ${entries.length} 件を削除しますか？${manual ? "\n（顧客対応マニュアルは同梱の内容に戻ります）" : ""}`)) return;
    setDeleting(true);
    try {
      await api(`/api/admin/sources/${encodeURIComponent(source.id)}`, { method: "DELETE" });
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 px-6 py-10 text-sm text-[#8f8f8f]">
        <Loader2 className="h-4 w-4 animate-spin" />
        読み込み中…
      </p>
    );
  }
  if (!source) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <ErrorNote message={error || "見つかりませんでした"} />
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-black/[0.05] text-[#3d3d3d]">
          {source.kind === "file" ? <FileText className="h-5 w-5" /> : <Pencil className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="break-all text-lg font-semibold text-[#0d0d0d]">{source.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[#8f8f8f]">
            <Chip tone="blue">{categoryOf(source.category).label}</Chip>
            <Chip tone={source.status === "done" ? "green" : source.status === "error" ? "red" : "amber"}>
              {source.status === "done" ? `ナレッジ ${source.entries_count} 件` : source.status === "error" ? "解析できませんでした" : "解析中"}
            </Chip>
            <span>{formatDate(source.created_at)}</span>
            {source.size && source.kind === "file" ? <span>{formatSize(source.size)}</span> : null}
          </div>
        </div>
        <div className="flex gap-2">
          {fileUrl ? (
            <a href={fileUrl} target="_blank" rel="noreferrer" className={btn.ghost}>
              <ExternalLink className="h-4 w-4" />
              元のファイル
            </a>
          ) : null}
          <button type="button" className={btn.danger} onClick={removeSource} disabled={deleting}>
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            削除
          </button>
        </div>
      </div>
      {source.error ? <p className={`rounded-xl px-4 py-2.5 text-sm ${source.status === "error" ? "bg-red-50 text-red-700" : "bg-black/[0.04] text-[#3d3d3d]"}`}>{source.error}</p> : null}
      {source.kind === "text" && source.excerpt ? (
        <div className="rounded-2xl bg-[#f4f4f4] px-4 py-3 text-sm leading-relaxed text-[#3d3d3d]">
          <p className="mb-1 text-xs text-[#8f8f8f]">入力した内容</p>
          <p className="whitespace-pre-wrap">{source.excerpt}</p>
        </div>
      ) : null}
      <ErrorNote message={error} />
      <div className="space-y-2.5">
        {entries.map((e) => (
          <EntryCard key={e.id} e={e} onEdit={() => setEditing(e)} onToggle={() => toggle(e)} onDelete={() => remove(e)} />
        ))}
      </div>
      <EntryEditor entry={editing} onClose={() => setEditing(null)} onSaved={(saved) => setEntries((list) => list.map((x) => (x.id === saved.id ? { ...x, ...saved } : x)))} />
    </div>
  );
}
