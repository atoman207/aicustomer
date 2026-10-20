"use client";

import { Check, CheckCircle2, ChevronLeft, Copy, ExternalLink, Loader2, Send, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import SpriteIcon from "./SpriteIcon";
import { CHANNEL_LABEL, type Channel, type EstimateRequest } from "@/lib/types";
import { formatJst, isLikelyPhone } from "@/lib/utils";

export interface EstimateInitial {
  name?: string;
  address?: string;
  phone?: string;
  summary?: string;
  dates?: string[];
}

interface Props {
  channel: Channel;
  sessionId?: string;
  initial?: EstimateInitial;
  summaryLoading?: boolean;
  lineUrl?: string;
  onSubmitted?: (estimate: EstimateRequest) => void;
  onCancel?: () => void;
}

const SLOTS = ["午前", "午後", "指定なし"];
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const STEPS = ["入力", "確認", "完了"];

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`;
}

function minDateIso(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

interface DateRow {
  date: string;
  slot: string;
  text: string;
}

export default function EstimateForm({ channel, sessionId, initial, summaryLoading, lineUrl, onSubmitted, onCancel }: Props) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [summaryTouched, setSummaryTouched] = useState(false);
  const [rows, setRows] = useState<DateRow[]>(() =>
    [0, 1, 2].map((i) => ({ date: "", slot: "午前", text: initial?.dates?.[i] ?? "" })),
  );
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");
  const [result, setResult] = useState<{ estimate: EstimateRequest; sinkLabel: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function copyId() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.estimate.id);
      setCopied(true);
    } catch {
      window.prompt("受付番号をコピーしてください", result.estimate.id);
    }
  }

  useEffect(() => {
    if (initial?.summary && !summaryTouched) setSummary(initial.summary);
  }, [initial?.summary, summaryTouched]);

  const dates = useMemo(() => rows.map((r) => r.text.trim()).filter(Boolean), [rows]);

  function updateRow(i: number, patch: Partial<DateRow>) {
    setRows((prev) =>
      prev.map((r, idx) => {
        if (idx !== i) return r;
        const next = { ...r, ...patch };
        if ((patch.date !== undefined || patch.slot !== undefined) && next.date) next.text = `${fmtDate(next.date)} ${next.slot}`;
        return next;
      }),
    );
  }

  function validate(): string[] {
    const e: string[] = [];
    if (!name.trim()) e.push("お名前を入力してください");
    if (!address.trim()) e.push("ご住所を入力してください");
    if (!phone.trim()) e.push("お電話番号を入力してください");
    else if (!isLikelyPhone(phone)) e.push("お電話番号は市外局番から10〜11桁で入力してください");
    if (dates.length === 0) e.push("見積希望日を1つ以上入力してください");
    if (!summary.trim()) e.push("ご相談内容を入力してください");
    return e;
  }

  function goConfirm() {
    const e = validate();
    setErrors(e);
    if (e.length === 0) {
      setAgree(false);
      setServerError("");
      setStep(1);
    }
  }

  async function submit() {
    if (!agree) {
      setServerError("内容をご確認のうえ、チェックボックスにチェックを入れてください");
      return;
    }
    setSubmitting(true);
    setServerError("");
    try {
      const res = await fetch("/api/estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, sessionId, name, address, phone, summary, preferredDates: dates, confirmed: true }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string; estimate?: EstimateRequest; sinkLabel?: string };
      if (!res.ok || !j.ok || !j.estimate) {
        setServerError(j.error ?? "送信に失敗しました");
        return;
      }
      setResult({ estimate: j.estimate, sinkLabel: j.sinkLabel ?? "" });
      setStep(2);
      onSubmitted?.(j.estimate);
    } catch {
      setServerError("通信エラーが発生しました。時間をおいて再度お試しください");
    } finally {
      setSubmitting(false);
    }
  }

  const confirmRows: [string, string][] = [
    ["お名前", name],
    ["ご住所", address],
    ["お電話番号", phone],
    ["ご希望日", dates.map((d, i) => `第${i + 1}希望：${d}`).join("\n")],
    ["ご相談内容", summary],
  ];

  return (
    <div className="space-y-5">
      <ol className="flex items-center gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span
              className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${
                i <= step ? "bg-ai-600 text-white" : "bg-washi-200 text-sumi-400"
              }`}
            >
              {i + 1}
            </span>
            <span className={i === step ? "font-semibold text-sumi-800" : "text-sumi-400"}>{s}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-washi-300" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            goConfirm();
          }}
        >
          <p className="rounded-xl bg-ichi-cream px-4 py-3 text-xs leading-relaxed text-sumi-600">
            送信後、担当者から折り返しお電話し、お見積り訪問の日程を確定します。お見積りは担当者が現地を見てから無料で提出します。
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">
                お名前 <span className="text-shu-500">*</span>
              </label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：山田 花子" autoComplete="name" />
            </div>
            <div>
              <label className="label">
                お電話番号 <span className="text-shu-500">*</span>
              </label>
              <input
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="例：090-1234-5678"
                inputMode="tel"
                autoComplete="tel"
              />
            </div>
          </div>
          <div>
            <label className="label">
              ご住所 <span className="text-shu-500">*</span>
            </label>
            <input
              className="input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="例：熊本県熊本市中央区水前寺1-2-3"
              autoComplete="street-address"
            />
          </div>
          <div>
            <label className="label">
              見積（訪問）希望日 <span className="text-shu-500">*</span>{" "}
              <span className="font-normal text-sumi-400">第1希望は必須。日付を選ぶか、右の欄に直接入力できます</span>
            </label>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[64px_1fr_104px_1.2fr] sm:items-center">
                  <span className="text-xs font-semibold text-sumi-500">第{i + 1}希望</span>
                  <input type="date" className="input" min={minDateIso()} value={r.date} onChange={(e) => updateRow(i, { date: e.target.value })} />
                  <select className="input" value={r.slot} onChange={(e) => updateRow(i, { slot: e.target.value })}>
                    {SLOTS.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <input
                    className="input"
                    value={r.text}
                    onChange={(e) => updateRow(i, { text: e.target.value })}
                    placeholder={i === 0 ? "例：10月20日（火） 午前" : "任意"}
                  />
                </div>
              ))}
            </div>
          </div>
          <div>
            <label className="label flex items-center gap-2">
              ご相談内容（AIが会話から要約） <span className="text-shu-500">*</span>
              {summaryLoading ? (
                <span className="flex items-center gap-1 text-ai-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  要約中…
                </span>
              ) : null}
            </label>
            <textarea
              className="input min-h-[110px]"
              value={summary}
              onChange={(e) => {
                setSummary(e.target.value);
                setSummaryTouched(true);
              }}
              placeholder="例：6畳和室の畳の表替え。国産い草希望。ペットあり。"
            />
            <p className="mt-1 text-xs text-sumi-400">内容はご自由に修正いただけます。次の画面で最終確認します。</p>
          </div>
          {errors.length > 0 ? (
            <ul className="rounded-xl border border-shu-200 bg-shu-50 p-3 text-sm text-shu-700">
              {errors.map((e) => (
                <li key={e}>・{e}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {onCancel ? (
              <button type="button" className="btn-ghost" onClick={onCancel}>
                閉じる
              </button>
            ) : null}
            <button type="submit" className="btn-primary">
              確認画面へ
            </button>
          </div>
        </form>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <div className="rounded-xl border border-ai-100 bg-ai-50 px-4 py-3 text-sm text-ai-800">
            <ShieldCheck className="mr-1 inline h-4 w-4" />
            送信前に内容をご確認ください。誤りがあれば「修正する」から直せます。
          </div>
          <dl className="divide-y divide-washi-200 rounded-xl border border-washi-300 bg-white text-sm">
            {confirmRows.map(([k, v]) => (
              <div key={k} className="grid gap-1 px-4 py-3 sm:grid-cols-[120px_1fr]">
                <dt className="text-sumi-400">{k}</dt>
                <dd className="whitespace-pre-wrap text-sumi-800">{v}</dd>
              </div>
            ))}
          </dl>
          <label className="flex items-start gap-2 text-sm text-sumi-700">
            <input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            上記の内容に間違いありません。担当者からの折り返し連絡に同意します。
          </label>
          {serverError ? <p className="rounded-xl border border-shu-200 bg-shu-50 p-3 text-sm text-shu-700">{serverError}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="btn-secondary" onClick={() => setStep(0)}>
              <ChevronLeft className="h-4 w-4" />
              修正する
            </button>
            <button type="button" className="btn-accent" disabled={submitting} onClick={submit}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              この内容で送信する
            </button>
          </div>
        </div>
      )}

      {step === 2 && result ? (
        <div className="space-y-4 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-tatami-500" />
          <h3 className="font-serif text-xl font-bold">見積依頼を受付しました</h3>
          <p className="text-sm text-sumi-600">
            受付番号 <span className="font-mono font-semibold text-sumi-800">{result.estimate.id}</span>
          </p>
          <p className="text-sm text-sumi-600">
            担当者より折り返しご連絡し、訪問日程を確定いたします。
            <br />
            受付経路：{CHANNEL_LABEL[result.estimate.channel]} ／ 受付日時：{formatJst(result.estimate.receivedAt)}
          </p>
          {lineUrl ? (
            <div className="rounded-xl border border-ichi-line/40 bg-ichi-line/10 p-4 text-left">
              <p className="text-sm font-bold text-ichi-theme">LINEでもご連絡を受け取れます（任意）</p>
              <p className="mt-1 text-xs leading-relaxed text-sumi-600">
                一畳屋の公式LINEを友だち追加し、トークで受付番号を送ってください。このご依頼とLINEがつながり、日程のご連絡などをLINEでも受け取れます。
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a href={lineUrl} target="_blank" rel="noreferrer" className="btn-line">
                  <SpriteIcon id="i-line-square" size={18} />
                  友だち追加
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <button type="button" className="btn-secondary" onClick={copyId}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "コピーしました" : "受付番号をコピー"}
                </button>
              </div>
            </div>
          ) : null}
          <p className="rounded-xl bg-washi-100 px-4 py-2 text-xs text-sumi-500">
            記録先：{result.sinkLabel}
            {result.estimate.syncError ? `（同期エラー：${result.estimate.syncError}）` : ""}
          </p>
          {onCancel ? (
            <button type="button" className="btn-primary" onClick={onCancel}>
              閉じる
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
