"use client";

import {
  CheckCircle2,
  ClipboardList,
  Copy,
  Database,
  Download,
  FileSpreadsheet,
  Loader2,
  LogOut,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Modal, Spinner } from "./ui";
import type {
  AppSettings,
  ConversationLog,
  EstimateRequest,
  EstimateStatus,
  IntegrationStatus,
  KnowledgeEntry,
  KnowledgeSource,
  PhoneMode,
} from "@/lib/types";
import { CHANNEL_LABEL } from "@/lib/types";
import { formatJst, truncate } from "@/lib/utils";

type Tab = "receptions" | "conversations" | "phone" | "knowledge" | "status";

const TABS: { key: Tab; label: string; icon: typeof ClipboardList }[] = [
  { key: "receptions", label: "受付一覧", icon: ClipboardList },
  { key: "conversations", label: "会話履歴", icon: MessageSquareText },
  { key: "phone", label: "電話・営業時間", icon: Settings2 },
  { key: "knowledge", label: "ナレッジ", icon: Database },
  { key: "status", label: "接続状況", icon: ShieldCheck },
];

const STATUS_LABEL: Record<EstimateStatus, string> = { new: "新規", contacted: "連絡済み", scheduled: "日程確定", closed: "完了" };
const DAY_LABEL = ["日", "月", "火", "水", "木", "金", "土"];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string; ok?: boolean };
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j;
}

export default function AdminDashboard({
  initialStatus,
  initialSettings,
  protectedMode,
}: {
  initialStatus: IntegrationStatus;
  initialSettings: AppSettings;
  protectedMode: boolean;
}) {
  const [tab, setTab] = useState<Tab>("receptions");
  const router = useRouter();

  async function logout() {
    await fetch("/api/admin/login", { method: "DELETE" });
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1 rounded-full border border-washi-300 bg-white/80 p-1">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${
                tab === key ? "bg-ai-600 text-white shadow-soft" : "text-sumi-600 hover:bg-washi-100"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Badge tone={initialStatus.openai.configured ? "green" : "amber"}>{initialStatus.openai.configured ? "OpenAI 接続" : "デモモード"}</Badge>
          {protectedMode ? (
            <button type="button" className="btn-ghost text-xs" onClick={logout}>
              <LogOut className="h-4 w-4" />
              ログアウト
            </button>
          ) : (
            <Badge tone="amber">ADMIN_PASSWORD 未設定（誰でも閲覧可）</Badge>
          )}
        </div>
      </div>

      {tab === "receptions" ? <ReceptionsTab storage={initialStatus.storage} /> : null}
      {tab === "conversations" ? <ConversationsTab /> : null}
      {tab === "phone" ? <PhoneSettingsTab initialSettings={initialSettings} /> : null}
      {tab === "knowledge" ? <KnowledgeTab /> : null}
      {tab === "status" ? <StatusTab initialStatus={initialStatus} /> : null}
    </div>
  );
}

// ---------------- 受付一覧 ----------------

function ReceptionsTab({ storage }: { storage: IntegrationStatus["storage"] }) {
  const [items, setItems] = useState<EstimateRequest[]>([]);
  const [sinkLabel, setSinkLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const j = await api<{ estimates: EstimateRequest[]; sinkLabel: string }>("/api/estimates");
      setItems(j.estimates);
      setSinkLabel(j.sinkLabel);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      items.filter((e) => {
        if (channel && e.channel !== channel) return false;
        if (status && e.status !== status) return false;
        if (q) {
          const hay = `${e.name} ${e.phone} ${e.address} ${e.summary} ${e.id}`.toLowerCase();
          if (!hay.includes(q.toLowerCase())) return false;
        }
        return true;
      }),
    [items, channel, status, q],
  );

  async function changeStatus(id: string, next: EstimateStatus) {
    setItems((prev) => prev.map((e) => (e.id === id ? { ...e, status: next } : e)));
    try {
      await api(`/api/estimates/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
    } catch (e) {
      setError((e as Error).message);
      void load();
    }
  }

  function exportCsv() {
    const header = ["受付日時", "受付経路", "氏名", "住所", "電話番号", "相談内容", "第1希望", "第2希望", "第3希望", "受付番号", "確認状況", "ステータス"];
    const rows = filtered.map((e) => [
      formatJst(e.receivedAt),
      CHANNEL_LABEL[e.channel],
      e.name,
      e.address,
      e.phone,
      e.summary,
      e.preferredDates[0] ?? "",
      e.preferredDates[1] ?? "",
      e.preferredDates[2] ?? "",
      e.id,
      e.confirmedByCustomer ? "お客様確認済み" : "未確認",
      STATUS_LABEL[e.status],
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `受付一覧_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-washi-200 bg-washi-100/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-tatami-600" />
          <p className="text-sm font-semibold text-sumi-800">受付一覧</p>
          <span className="text-xs text-sumi-400">{filtered.length} 件 ／ 記録先：{sinkLabel || "—"}</span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input className="input w-44" placeholder="氏名・電話・内容で検索" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input w-40" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">全経路</option>
            {Object.entries(CHANNEL_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select className="input w-32" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全ステータス</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={load}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            更新
          </button>
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
        </div>
      </div>
      {error ? <p className="px-4 py-2 text-sm text-shu-600">{error}</p> : null}
      {!storage.persistent ? (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          現在の保存先は「{storage.label}」です。{storage.detail ?? ""}
          スプレッドシート連携（GAS）を設定すると、受付は常にシートへ記録されます。
        </p>
      ) : null}
      <div className="max-h-[70vh] overflow-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>受付日時</th>
              <th>経路</th>
              <th>氏名</th>
              <th>電話番号</th>
              <th>相談内容（AI要約・確認済み）</th>
              <th>希望日</th>
              <th>記録</th>
              <th>ステータス</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-sumi-400">
                  <Spinner className="mx-auto h-5 w-5" />
                </td>
              </tr>
            ) : null}
            {!loading && filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-sumi-400">
                  受付はまだありません
                </td>
              </tr>
            ) : null}
            {filtered.map((e) => (
              <ReceptionRow key={e.id} e={e} open={open === e.id} onToggle={() => setOpen(open === e.id ? null : e.id)} onStatus={(s) => changeStatus(e.id, s)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReceptionRow({ e, open, onToggle, onStatus }: { e: EstimateRequest; open: boolean; onToggle: () => void; onStatus: (s: EstimateStatus) => void }) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-washi-50" onClick={onToggle}>
        <td className="whitespace-nowrap">{formatJst(e.receivedAt)}</td>
        <td className="whitespace-nowrap">
          <Badge tone={e.channel === "phone" ? "blue" : e.channel === "line" ? "green" : "neutral"}>{CHANNEL_LABEL[e.channel]}</Badge>
        </td>
        <td className="whitespace-nowrap font-medium text-sumi-800">{e.name}</td>
        <td className="whitespace-nowrap font-mono text-xs">{e.phone}</td>
        <td className="min-w-[240px] max-w-[420px]">{open ? e.summary : truncate(e.summary, 60)}</td>
        <td className="min-w-[160px] text-xs">
          {e.preferredDates.map((d, i) => (
            <div key={i}>
              第{i + 1}：{d}
            </div>
          ))}
        </td>
        <td className="text-xs">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-1">
              {e.confirmedByCustomer ? <CheckCircle2 className="h-3.5 w-3.5 text-tatami-500" /> : <XCircle className="h-3.5 w-3.5 text-amber-500" />}
              {e.confirmedByCustomer ? "確認済み" : "未確認"}
            </span>
            <span className="text-sumi-400">{e.syncedTo.join(" / ")}</span>
            {e.syncError ? <span className="text-shu-600">同期エラー</span> : null}
          </div>
        </td>
        <td onClick={(ev) => ev.stopPropagation()}>
          <select className="input py-1 text-xs" value={e.status} onChange={(ev) => onStatus(ev.target.value as EstimateStatus)}>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </td>
      </tr>
      {open ? (
        <tr className="bg-washi-50/80">
          <td colSpan={8} className="text-xs text-sumi-600">
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <span className="text-sumi-400">受付番号：</span>
                {e.id}
              </div>
              <div>
                <span className="text-sumi-400">住所：</span>
                {e.address}
              </div>
              <div>
                <span className="text-sumi-400">セッション：</span>
                {e.sessionId ?? "—"}
              </div>
              {e.syncError ? <div className="text-shu-600 sm:col-span-3">同期エラー：{e.syncError}</div> : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ---------------- 会話履歴 ----------------

function ConversationsTab() {
  const [items, setItems] = useState<ConversationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<ConversationLog | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const j = await api<{ conversations: ConversationLog[] }>("/api/conversations?limit=150");
      setItems(j.conversations);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-washi-200 bg-washi-100/70 px-4 py-3">
        <MessageSquareText className="h-4 w-4 text-ai-600" />
        <p className="text-sm font-semibold text-sumi-800">会話履歴</p>
        <span className="text-xs text-sumi-400">{items.length} 件（直近）</span>
        <button type="button" className="btn-secondary ml-auto px-3 py-1.5 text-xs" onClick={load}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          更新
        </button>
      </div>
      {error ? <p className="px-4 py-2 text-sm text-shu-600">{error}</p> : null}
      <div className="max-h-[70vh] overflow-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>更新日時</th>
              <th>経路</th>
              <th>往復</th>
              <th>モード</th>
              <th>最初のご相談</th>
              <th>受付番号</th>
            </tr>
          </thead>
          <tbody>
            {!loading && items.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-sumi-400">
                  会話履歴はまだありません。テキスト相談・音声相談・電話シミュレーターを使うと記録されます。
                </td>
              </tr>
            ) : null}
            {items.map((c) => {
              const firstUser = c.messages.find((m) => m.role === "user")?.content ?? "";
              return (
                <tr key={c.id} className="cursor-pointer hover:bg-washi-50" onClick={() => setView(c)}>
                  <td className="whitespace-nowrap">{formatJst(c.updatedAt)}</td>
                  <td className="whitespace-nowrap">
                    <Badge tone={c.channel === "phone" ? "blue" : c.channel === "line" ? "green" : "neutral"}>{CHANNEL_LABEL[c.channel]}</Badge>
                  </td>
                  <td>{c.messages.length}</td>
                  <td className="text-xs">{c.meta?.mode ?? "—"}</td>
                  <td className="max-w-[420px]">{truncate(firstUser, 70) || "—"}</td>
                  <td className="font-mono text-xs">{c.estimateId ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Modal open={!!view} onClose={() => setView(null)} title={view ? `${CHANNEL_LABEL[view.channel]}｜${formatJst(view.startedAt)}` : ""} wide>
        {view ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 text-xs text-sumi-500">
              <span>ID: {view.id}</span>
              {view.estimateId ? <span>受付番号: {view.estimateId}</span> : null}
              {Object.entries(view.meta ?? {}).map(([k, v]) => (
                <span key={k}>
                  {k}: {v}
                </span>
              ))}
            </div>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto rounded-xl bg-white p-3">
              {view.messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`bubble max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-ai-600 text-white" : "border border-washi-200 bg-washi-50 text-sumi-800"}`}>
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

// ---------------- 電話・営業時間 ----------------

function PhoneSettingsTab({ initialSettings }: { initialSettings: AppSettings }) {
  const [s, setS] = useState<AppSettings>(initialSettings);
  const [holidaysText, setHolidaysText] = useState(initialSettings.phone.holidays.join("\n"));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [routing, setRouting] = useState<{ handler: string; reason: string } | null>(null);
  const [now, setNow] = useState("");

  const refreshRouting = useCallback(async () => {
    try {
      const j = await api<{ routing: { handler: string; reason: string }; now: string }>("/api/settings");
      setRouting(j.routing);
      setNow(j.now);
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    void refreshRouting();
    const t = setInterval(refreshRouting, 30000);
    return () => clearInterval(t);
  }, [refreshRouting]);

  async function save() {
    setSaving(true);
    setMsg("");
    try {
      const holidays = holidaysText
        .split(/\n|,|、/)
        .map((h) => h.trim())
        .filter(Boolean);
      const j = await api<{ settings: AppSettings; routing: { handler: string; reason: string }; now: string }>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ ...s, phone: { ...s.phone, holidays } }),
      });
      setS(j.settings);
      setRouting(j.routing);
      setNow(j.now);
      setMsg("保存しました。電話シミュレーター／Twilio 着信に即時反映されます。");
    } catch (e) {
      setMsg(`保存に失敗しました：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const modes: { key: PhoneMode; label: string; desc: string }[] = [
    { key: "ai_off_hours", label: "休日・営業時間外のみAI対応", desc: "営業時間内はスタッフの電話へ転送し、それ以外はAIが受付します（推奨）" },
    { key: "ai_always", label: "常時AI対応", desc: "営業時間に関係なく、すべての着信をAIが受付します" },
    { key: "human_always", label: "常にスタッフ対応（AI停止）", desc: "すべての着信を転送先の電話につなぎます" },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="card space-y-6 p-5">
        <div>
          <p className="font-serif text-base font-bold text-sumi-800">AI・スタッフの電話対応切替</p>
          <div className="mt-3 grid gap-2">
            {modes.map((m) => (
              <label
                key={m.key}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 ${
                  s.phone.mode === m.key ? "border-ai-400 bg-ai-50" : "border-washi-300 bg-white hover:bg-washi-50"
                }`}
              >
                <input type="radio" className="mt-1" name="phoneMode" checked={s.phone.mode === m.key} onChange={() => setS({ ...s, phone: { ...s.phone, mode: m.key } })} />
                <span>
                  <span className="block text-sm font-semibold text-sumi-800">{m.label}</span>
                  <span className="block text-xs text-sumi-500">{m.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">営業日</label>
            <div className="flex flex-wrap gap-2">
              {DAY_LABEL.map((d, i) => {
                const on = s.phone.businessDays.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() =>
                      setS({
                        ...s,
                        phone: { ...s.phone, businessDays: on ? s.phone.businessDays.filter((x) => x !== i) : [...s.phone.businessDays, i].sort() },
                      })
                    }
                    className={`h-9 w-9 rounded-full text-sm font-semibold ${on ? "bg-ai-600 text-white" : "bg-washi-200 text-sumi-500"}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="label">営業開始</label>
            <input type="time" className="input" value={s.phone.openTime} onChange={(e) => setS({ ...s, phone: { ...s.phone, openTime: e.target.value } })} />
          </div>
          <div>
            <label className="label">営業終了</label>
            <input type="time" className="input" value={s.phone.closeTime} onChange={(e) => setS({ ...s, phone: { ...s.phone, closeTime: e.target.value } })} />
          </div>
          <div>
            <label className="label">休業日（YYYY-MM-DD を改行区切り）</label>
            <textarea className="input min-h-[80px]" value={holidaysText} onChange={(e) => setHolidaysText(e.target.value)} placeholder={"2026-12-30\n2026-12-31\n2027-01-01"} />
          </div>
          <div>
            <label className="label">スタッフ転送先の電話番号</label>
            <input className="input" value={s.phone.forwardNumber} onChange={(e) => setS({ ...s, phone: { ...s.phone, forwardNumber: e.target.value } })} placeholder="例：+8196XXXXXXX" />
            <p className="mt-1 text-xs text-sumi-400">Twilio から転送するため国際形式（+81…）を推奨</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">会社名（AIの名乗り）</label>
            <input className="input" value={s.companyName} onChange={(e) => setS({ ...s, companyName: e.target.value })} />
          </div>
          <div>
            <label className="label">お客様向け電話番号（表示用）</label>
            <input className="input" value={s.companyPhone} onChange={(e) => setS({ ...s, companyPhone: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">LINE 友だち追加URL（「LINEで見積依頼」の遷移先）</label>
            <input className="input" value={s.lineAddFriendUrl} onChange={(e) => setS({ ...s, lineAddFriendUrl: e.target.value })} placeholder="https://lin.ee/xxxxxxx" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">電話の第一声（{"{company}"} は会社名に置換）</label>
            <textarea className="input min-h-[80px]" value={s.greeting} onChange={(e) => setS({ ...s, greeting: e.target.value })} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button type="button" className="btn-primary" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            保存する
          </button>
          {msg ? <p className="text-sm text-sumi-600">{msg}</p> : null}
        </div>
      </div>

      <aside className="space-y-4">
        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-sumi-400">現在の判定</p>
          <p className="mt-2 text-sm text-sumi-500">{now || "—"}</p>
          {routing ? (
            <div className={`mt-2 rounded-xl px-3 py-2 text-sm font-semibold ${routing.handler === "ai" ? "bg-tatami-50 text-tatami-700" : "bg-ai-50 text-ai-700"}`}>
              {routing.handler === "ai" ? "AI受付が対応中" : "スタッフへ転送中"}
              <span className="block text-xs font-normal opacity-80">{routing.reason}</span>
            </div>
          ) : null}
          <p className="mt-3 text-xs text-sumi-400">30秒ごとに自動更新。設定保存後すぐに反映されます。</p>
        </div>
        <div className="card p-5 text-xs text-sumi-500">
          <p className="font-semibold text-sumi-700">専門知識なしで運用できるポイント</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>AI／スタッフの切替はこの画面のラジオボタンだけ</li>
            <li>年末年始などの休業日は日付を書き足すだけ</li>
            <li>ナレッジの更新はスプレッドシートを編集するだけ（約1分で反映）</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

// ---------------- ナレッジ ----------------

interface KnowledgeResp {
  entries: KnowledgeEntry[];
  source: KnowledgeSource;
  sourceLabel: string;
  fetchedAt: string;
  sheetName?: string;
  warning?: string;
  remoteConfigured: boolean;
}

function KnowledgeTab() {
  const [data, setData] = useState<KnowledgeResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [testQ, setTestQ] = useState("");
  const [testing, setTesting] = useState(false);
  const [hits, setHits] = useState<{ id: string; title: string; category: string; content: string; score: number }[] | null>(null);
  const [testMode, setTestMode] = useState("");
  const [editing, setEditing] = useState<KnowledgeEntry | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError("");
    try {
      const j = refresh ? await api<KnowledgeResp>("/api/knowledge/refresh", { method: "POST" }) : await api<KnowledgeResp>("/api/knowledge");
      setData(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const f = filter.trim().toLowerCase();
    if (!f) return data.entries;
    return data.entries.filter((e) => `${e.category} ${e.title} ${e.content} ${e.keywords.join(" ")}`.toLowerCase().includes(f));
  }, [data, filter]);

  async function runTest() {
    if (!testQ.trim()) return;
    setTesting(true);
    try {
      const j = await api<{ hits: NonNullable<typeof hits>; mode: string }>("/api/knowledge/search", { method: "POST", body: JSON.stringify({ query: testQ, k: 5 }) });
      setHits(j.hits);
      setTestMode(j.mode);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(false);
    }
  }

  async function persist(entries: KnowledgeEntry[]) {
    setSaving(true);
    setError("");
    try {
      const j = await api<KnowledgeResp>("/api/knowledge", { method: "PUT", body: JSON.stringify({ entries }) });
      setData(j);
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function saveEntry(entry: KnowledgeEntry) {
    if (!data) return;
    const exists = data.entries.some((e) => e.id === entry.id);
    const next = exists ? data.entries.map((e) => (e.id === entry.id ? entry : e)) : [...data.entries, entry];
    void persist(next);
  }

  function removeEntry(id: string) {
    if (!data) return;
    if (!window.confirm("このナレッジを削除しますか？")) return;
    void persist(data.entries.filter((e) => e.id !== id));
  }

  const editable = data?.source === "local";

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-serif text-base font-bold text-sumi-800">AIの回答情報源（社内総合マニュアル › 指定シート）</p>
            <p className="mt-1 text-sm text-sumi-600">
              現在の情報源：<span className="font-semibold">{data?.sourceLabel ?? "読込中…"}</span>
              {data?.sheetName ? `（シート名：${data.sheetName}）` : ""}
            </p>
            <p className="text-xs text-sumi-400">
              {data ? `${data.entries.length} 件 ／ 最終読込 ${formatJst(data.fetchedAt, true)}` : ""}
              {data && !data.remoteConfigured ? "　※ .env にシート連携（GAS_WEBHOOK_URL など）を設定すると、スプレッドシートが情報源になります" : ""}
            </p>
            {data?.warning ? <p className="mt-1 text-xs text-amber-700">{data.warning}</p> : null}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => load(true)} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              シートから再読み込み
            </button>
            {editable ? (
              <button
                type="button"
                className="btn-primary px-3 py-1.5 text-xs"
                onClick={() => setEditing({ id: `k${Date.now().toString(36)}`, category: "", title: "", content: "", keywords: [] })}
              >
                <Plus className="h-3.5 w-3.5" />
                追加
              </button>
            ) : null}
          </div>
        </div>
        {error ? <p className="mt-2 text-sm text-shu-600">{error}</p> : null}

        <div className="mt-4 rounded-xl border border-washi-300 bg-washi-50 p-3">
          <p className="text-xs font-semibold text-sumi-600">回答テスト（この質問にどのナレッジが使われるか）</p>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void runTest();
            }}
          >
            <input className="input" value={testQ} onChange={(e) => setTestQ(e.target.value)} placeholder="例：ペットがいる家の障子はどれがいい？" />
            <button type="submit" className="btn-primary px-4" disabled={testing || !testQ.trim()}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              検索
            </button>
          </form>
          {hits ? (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-sumi-400">検索方式：{testMode === "hybrid" ? "埋め込み＋キーワード（ハイブリッド）" : "キーワード（デモモード）"}</p>
              {hits.length === 0 ? <p className="text-sm text-sumi-500">該当なし → AIは推測せず「担当者より折り返し」を案内します</p> : null}
              {hits.map((h) => (
                <div key={h.id} className="rounded-lg bg-white px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sumi-800">
                      【{h.category}】{h.title}
                    </span>
                    <span className="font-mono text-xs text-sumi-400">{Math.round(h.score * 100)}%</span>
                  </div>
                  <div className="mt-1 h-1 rounded bg-washi-200">
                    <div className="h-1 rounded bg-ai-500" style={{ width: `${Math.round(h.score * 100)}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-sumi-500">{truncate(h.content, 120)}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-washi-200 bg-washi-100/70 px-4 py-3">
          <Database className="h-4 w-4 text-ai-600" />
          <p className="text-sm font-semibold text-sumi-800">ナレッジ一覧</p>
          <span className="text-xs text-sumi-400">{filtered.length} 件</span>
          <input className="input ml-auto w-60" placeholder="絞り込み" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>カテゴリ</th>
                <th>項目（質問）</th>
                <th>内容（回答）</th>
                <th>キーワード</th>
                {editable ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">
                    <Badge>{e.category}</Badge>
                  </td>
                  <td className="min-w-[180px] font-medium text-sumi-800">{e.title}</td>
                  <td className="min-w-[320px] max-w-[560px] text-xs leading-relaxed">{e.content}</td>
                  <td className="max-w-[200px] text-xs text-sumi-500">{e.keywords.join("、")}</td>
                  {editable ? (
                    <td className="whitespace-nowrap">
                      <button type="button" className="rounded p-1 text-sumi-400 hover:bg-washi-200 hover:text-sumi-700" onClick={() => setEditing(e)} aria-label="編集">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" className="rounded p-1 text-sumi-400 hover:bg-shu-50 hover:text-shu-600" onClick={() => removeEntry(e.id)} aria-label="削除">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-washi-200 px-4 py-2 text-xs text-sumi-400">
          スプレッドシートの列構成：A「カテゴリ」／B「項目（質問）」／C「内容（回答）」／D「キーワード」（読点・カンマ区切り）／E「備考」。1行目は見出し行。
        </p>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing && data?.entries.some((e) => e.id === editing.id) ? "ナレッジを編集" : "ナレッジを追加"}>
        {editing ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveEntry(editing);
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">カテゴリ</label>
                <input className="input" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} placeholder="例：畳" />
              </div>
              <div>
                <label className="label">キーワード（読点区切り）</label>
                <input
                  className="input"
                  value={editing.keywords.join("、")}
                  onChange={(e) => setEditing({ ...editing, keywords: e.target.value.split(/[、,，\s]+/).filter(Boolean) })}
                  placeholder="例：料金、価格、いくら"
                />
              </div>
            </div>
            <div>
              <label className="label">項目（質問）</label>
              <input className="input" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} required />
            </div>
            <div>
              <label className="label">内容（回答）</label>
              <textarea className="input min-h-[140px]" value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} required />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
                キャンセル
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                保存して反映
              </button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}

// ---------------- 接続状況 ----------------

function StatusTab({ initialStatus }: { initialStatus: IntegrationStatus }) {
  const [status, setStatus] = useState<IntegrationStatus>(initialStatus);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState("");

  async function check() {
    setChecking(true);
    try {
      const j = await api<IntegrationStatus>("/api/status?check=1");
      setStatus(j);
    } finally {
      setChecking(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      // noop
    }
  }

  const Card = ({ title, ok, children }: { title: string; ok: boolean; children: React.ReactNode }) => (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-sumi-800">{title}</p>
        <Badge tone={ok ? "green" : "amber"}>{ok ? "接続済み" : "未設定／デモ"}</Badge>
      </div>
      <div className="mt-3 space-y-1 text-sm text-sumi-600">{children}</div>
    </div>
  );

  const CopyRow = ({ value }: { value: string }) => (
    <div className="flex items-center gap-2 rounded-lg bg-washi-100 px-2 py-1 font-mono text-xs">
      <span className="truncate">{value}</span>
      <button type="button" className="ml-auto text-sumi-400 hover:text-sumi-700" onClick={() => copy(value)} aria-label="コピー">
        {copied === value ? <CheckCircle2 className="h-4 w-4 text-tatami-500" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-sumi-600">各連携の設定状況です。環境変数（.env）を設定して再起動すると反映されます。</p>
        <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={check} disabled={checking}>
          {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          OpenAI 接続テスト
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="OpenAI API（AI応答・音声・要約）" ok={status.openai.configured}>
          <p>チャットモデル：{status.openai.model}</p>
          <p>音声会話モデル：{status.openai.realtimeModel}</p>
          {status.openai.detail ? <p className={status.openai.ok ? "text-tatami-700" : "text-amber-700"}>{status.openai.detail}</p> : null}
          {!status.openai.configured ? <p className="text-xs text-amber-700">未設定のため、テンプレート応答（デモモード）で動作しています。</p> : null}
        </Card>
        <Card title="ナレッジ（回答情報源）" ok={status.knowledge.source !== "local"}>
          <p>{status.knowledge.label}</p>
          <p>
            {status.knowledge.entries} 件 ／ 最終読込 {formatJst(status.knowledge.fetchedAt, true)}
          </p>
          {status.knowledge.warning ? <p className="text-xs text-amber-700">{status.knowledge.warning}</p> : null}
        </Card>
        <Card title="受付情報の記録先（スプレッドシート）" ok={status.reception.sink !== "local"}>
          <p>{status.reception.label}</p>
          <p className="text-xs text-sumi-400">3窓口（テキスト・音声・電話）＋LINE の受付を1つのシートに一元管理します。</p>
        </Card>
        <Card title="アプリ内データの保存先（受付・会話・設定・セッション）" ok={status.storage.persistent}>
          <p>{status.storage.label}</p>
          {status.storage.detail ? <p className="text-xs text-amber-700">{status.storage.detail}</p> : null}
          <p className="text-xs text-sumi-400">
            Vercel では Storage › Upstash Redis を追加すると UPSTASH_REDIS_REST_URL / TOKEN が自動設定され、再デプロイ後に永続化されます。
          </p>
        </Card>
        <Card title="Twilio（AI電話受付）" ok={status.twilio.configured}>
          <p>Twilio 番号：{status.twilio.number || "未設定"}</p>
          <p className="text-xs text-sumi-400">着信 Webhook（A call comes in）：</p>
          <CopyRow value={status.twilio.webhookUrl} />
        </Card>
        <Card title="LINE Messaging API" ok={status.line.configured}>
          <p>友だち追加URL：{status.line.addFriendUrl || "未設定"}</p>
          <p className="text-xs text-sumi-400">Webhook URL：</p>
          <CopyRow value={status.line.webhookUrl} />
        </Card>
        <Card title="管理画面の保護" ok={status.admin.protected}>
          <p>{status.admin.protected ? "ADMIN_PASSWORD によるログインが有効です" : "ADMIN_PASSWORD が未設定のため、誰でも管理画面を開けます（デモ用）"}</p>
        </Card>
      </div>
    </div>
  );
}
