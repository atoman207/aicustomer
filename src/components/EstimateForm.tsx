"use client";

// 見積依頼の確認画面（文字・声の相談で共通）
//   ・AI が会話で伺った内容（お名前・ご住所・お電話番号・ご希望日時・ご相談内容の要約）が入った状態で開く
//   ・お客様は内容を確認して送信するだけ。伺えなかった項目だけ入力欄を表示し、入っている項目も「修正」から直せる
//   ・日程は確定ではない（担当者がお電話でご相談して確定）
import { Check, CheckCircle2, Copy, ExternalLink, Loader2, LockKeyhole, PencilLine, Send, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import SpriteIcon from "./SpriteIcon";
import { FIELD_LABEL, type DraftField } from "@/lib/intake";
import type { Channel, EstimateRequest, IntakeDraft } from "@/lib/types";
import { formatJst, isLikelyPhone } from "@/lib/utils";

export interface EstimateInitial {
  name?: string;
  address?: string;
  phone?: string;
  summary?: string;
  dates?: string[];
}

/** 確認画面での入力・修正（閉じて開き直しても残すため、親が会話と一緒に保存する） */
export interface EstimateFormEdits {
  draft: IntakeDraft;
  /** お客様が入力・修正した項目 */
  touched: DraftField[];
  /** AI が会話から入れた項目 */
  aiFilled: DraftField[];
}

interface Props {
  channel: Channel;
  sessionId?: string;
  initial?: EstimateInitial;
  /** 前に開いたときの入力・修正 */
  touched?: DraftField[];
  aiFilled?: DraftField[];
  /** 会話から読み取っている途中（AI の要約を含む） */
  loading?: boolean;
  lineUrl?: string;
  onSubmitted?: (estimate: EstimateRequest) => void;
  onCancel?: () => void;
  onChange?: (edits: EstimateFormEdits) => void;
}

const SLOTS = ["午前", "午後", "指定なし"];
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const STEPS = ["内容の確認", "受付完了"];
const FIELDS: DraftField[] = ["name", "phone", "address", "dates", "summary"];

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

const rowsFrom = (dates?: string[]): DateRow[] => [0, 1, 2].map((i) => ({ date: "", slot: "午前", text: dates?.[i] ?? "" }));

export default function EstimateForm({
  channel,
  sessionId,
  initial,
  touched: touchedIn,
  aiFilled: aiFilledIn,
  loading = false,
  lineUrl,
  onSubmitted,
  onCancel,
  onChange,
}: Props) {
  const [step, setStep] = useState<0 | 1>(0);
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [rows, setRows] = useState<DateRow[]>(() => rowsFrom(initial?.dates));
  const [touched, setTouched] = useState<Set<DraftField>>(() => new Set(touchedIn ?? []));
  const [aiFilled, setAiFilled] = useState<Set<DraftField>>(() => {
    const s = new Set<DraftField>(aiFilledIn ?? []);
    const init = initial ?? {};
    for (const f of FIELDS) if (!touchedIn?.includes(f) && (f === "dates" ? init.dates?.length : init[f]?.trim())) s.add(f);
    return s;
  });
  // 入力欄で表示する項目（伺えなかった項目・「修正」を押した項目）。一度開いた入力欄は閉じない（入力の途中で切り替わらないように）
  const [editing, setEditing] = useState<Set<DraftField>>(() => new Set());
  const [errors, setErrors] = useState<Partial<Record<DraftField, string>>>({});
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");
  const [result, setResult] = useState<{ estimate: EstimateRequest; sinkLabel: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const firstInputRef = useRef<HTMLDivElement>(null);

  const dates = useMemo(() => rows.map((r) => r.text.trim()).filter(Boolean), [rows]);
  const value: Record<DraftField, string> = { name, address, phone, summary, dates: dates.join("\n") };
  const isEmpty = (f: DraftField) => !value[f].trim();

  // 会話からの読み取りが届いたら、お客様がまだ触っていない項目に入れる
  useEffect(() => {
    const init = initial ?? {};
    const filled: DraftField[] = [];
    const take = (f: Exclude<DraftField, "dates">, v: string | undefined, set: (x: string) => void) => {
      if (touched.has(f) || !v?.trim()) return;
      set(v.trim());
      filled.push(f);
    };
    take("name", init.name, setName);
    take("address", init.address, setAddress);
    take("phone", init.phone, setPhone);
    take("summary", init.summary, setSummary);
    if (!touched.has("dates") && init.dates?.length) {
      setRows(rowsFrom(init.dates));
      filled.push("dates");
    }
    if (filled.length) {
      setAiFilled((prev) => new Set([...prev, ...filled]));
      // 入力欄で待っていた項目に内容が届いたら、確認の表示にする（お客様が入力を始めた項目はそのまま）
      setEditing((prev) => new Set([...prev].filter((f) => !filled.includes(f))));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.name, initial?.address, initial?.phone, initial?.summary, (initial?.dates ?? []).join("|")]);

  // 読み取りが終わっても空の項目は入力欄で表示する（同じタイミングで届いた読み取りの内容も見る）
  useEffect(() => {
    if (loading) return;
    const init = initial ?? {};
    const arriving = (f: DraftField) => !touched.has(f) && Boolean(f === "dates" ? init.dates?.length : init[f]?.trim());
    setEditing((prev) => {
      const next = new Set(prev);
      for (const f of FIELDS) if (isEmpty(f) && !arriving(f)) next.add(f);
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const report = (patch: Partial<{ name: string; address: string; phone: string; summary: string; rows: DateRow[] }>, field: DraftField) => {
    const nextTouched = new Set(touched).add(field);
    setTouched(nextTouched);
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    const r = patch.rows ?? rows;
    onChange?.({
      draft: {
        name: (patch.name ?? name).trim() || undefined,
        address: (patch.address ?? address).trim() || undefined,
        phone: (patch.phone ?? phone).trim() || undefined,
        summary: (patch.summary ?? summary).trim() || undefined,
        dates: r.map((x) => x.text.trim()).filter(Boolean),
      },
      touched: [...nextTouched],
      aiFilled: [...aiFilled],
    });
  };

  function updateRow(i: number, patch: Partial<DateRow>) {
    const next = rows.map((r, idx) => {
      if (idx !== i) return r;
      const n = { ...r, ...patch };
      if ((patch.date !== undefined || patch.slot !== undefined) && n.date) n.text = `${fmtDate(n.date)} ${n.slot}`;
      return n;
    });
    setRows(next);
    report({ rows: next }, "dates");
  }

  function validate(): Partial<Record<DraftField, string>> {
    const e: Partial<Record<DraftField, string>> = {};
    if (!name.trim()) e.name = "お名前を入力してください";
    if (!address.trim()) e.address = "ご住所を入力してください";
    if (!phone.trim()) e.phone = "お電話番号を入力してください";
    else if (!isLikelyPhone(phone)) e.phone = "お電話番号は市外局番から10〜11桁で入力してください";
    if (dates.length === 0) e.dates = "ご希望日時を1つ以上入力してください（「指定なし」でもかまいません）";
    if (!summary.trim()) e.summary = "ご相談内容を入力してください";
    return e;
  }

  async function submit() {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      setEditing((prev) => new Set([...prev, ...(Object.keys(e) as DraftField[])]));
      setServerError("入力が必要な項目があります。赤い字の項目をご確認ください。");
      window.setTimeout(() => firstInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      return;
    }
    if (!agree) {
      setServerError("内容をご確認のうえ、チェックボックスにチェックを入れてください");
      return;
    }
    setSubmitting(true);
    setServerError("");
    const filled = FIELDS.filter((f) => aiFilled.has(f) && !isEmpty(f));
    try {
      const res = await fetch("/api/estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          sessionId,
          name,
          address,
          phone,
          summary,
          preferredDates: dates,
          confirmed: true,
          autofill: { filled, edited: filled.filter((f) => touched.has(f)) },
        }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string; estimate?: EstimateRequest; sinkLabel?: string };
      if (!res.ok || !j.ok || !j.estimate) {
        setServerError(j.error ?? "送信に失敗しました");
        return;
      }
      setResult({ estimate: j.estimate, sinkLabel: j.sinkLabel ?? "" });
      setStep(1);
      onSubmitted?.(j.estimate);
    } catch {
      setServerError("通信エラーが発生しました。時間をおいて再度お試しください");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyId() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.estimate.id);
      setCopied(true);
    } catch {
      window.prompt("受付番号をコピーしてください", result.estimate.id);
    }
  }

  const missing = FIELDS.filter((f) => isEmpty(f));
  const filledCount = FIELDS.filter((f) => aiFilled.has(f) && !isEmpty(f)).length;
  const firstError = FIELDS.find((f) => errors[f]);

  const banner = loading ? (
    <p className="flex items-center gap-2 rounded-xl bg-ai-50 px-4 py-3 text-sm text-ai-700" data-intake-banner="loading">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      AIとの会話から、お名前・ご連絡先・ご希望日時・ご相談内容を読み取っています…
    </p>
  ) : filledCount > 0 && missing.length === 0 ? (
    <p className="flex items-start gap-2 rounded-xl border border-ichi-green/25 bg-ichi-cream px-4 py-3 text-sm leading-relaxed text-ichi-theme" data-intake-banner="complete">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        AIとの会話から、すべての項目を入力しました。内容をご確認のうえ、下の「この内容で送信する」を押してください。
        <span className="block text-xs text-sumi-500">直したい項目は「修正」から変更できます。</span>
      </span>
    </p>
  ) : filledCount > 0 ? (
    <p className="flex items-start gap-2 rounded-xl border border-ichi-green/25 bg-ichi-cream px-4 py-3 text-sm leading-relaxed text-ichi-theme" data-intake-banner="partial">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        会話でお伺いした内容は入力済みです。<b>{missing.map((f) => FIELD_LABEL[f]).join("・")}</b>だけご入力ください。
      </span>
    </p>
  ) : (
    <p className="rounded-xl bg-ichi-cream px-4 py-3 text-sm leading-relaxed text-sumi-600" data-intake-banner="empty">
      お見積りに必要な内容をご入力ください。担当者が現地を確認してから、お見積りを無料で提出します。
    </p>
  );

  const pending = (f: DraftField) => loading && isEmpty(f) && !touched.has(f);
  const showInput = (f: DraftField) => !pending(f) && (editing.has(f) || Boolean(errors[f]));

  const field = (f: DraftField, input: ReactNode, display?: ReactNode) => {
    const fromAi = aiFilled.has(f) && !touched.has(f) && !isEmpty(f);
    return (
      <div key={f} className="px-4 py-3" data-field={f} data-mode={pending(f) ? "pending" : showInput(f) ? "input" : "view"} ref={firstError === f ? firstInputRef : undefined}>
        <div className="flex items-center justify-between gap-2">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-sumi-500">
            {FIELD_LABEL[f]}
            {f === "dates" ? <span className="font-normal text-sumi-400">（第3希望まで）</span> : null}
            {fromAi ? (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-ichi-cream px-2 py-0.5 text-[10px] font-bold text-ichi-green" data-ai-filled>
                <Sparkles className="h-3 w-3" />
                AIが会話から入力
              </span>
            ) : null}
          </p>
          {!showInput(f) && !pending(f) ? (
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-sumi-200 px-2.5 py-1 text-xs font-bold text-sumi-600 transition hover:border-ichi-green hover:text-ichi-green"
              onClick={() => setEditing((prev) => new Set(prev).add(f))}
              aria-label={`${FIELD_LABEL[f]}を修正する`}
            >
              <PencilLine className="h-3 w-3" />
              修正
            </button>
          ) : null}
        </div>
        {pending(f) ? (
          <div className="mt-2 h-5 w-2/3 animate-pulse rounded bg-sumi-100" aria-label="読み取り中" />
        ) : showInput(f) ? (
          <div className="mt-1.5">{input}</div>
        ) : (
          <div className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-sumi-800">{display ?? value[f]}</div>
        )}
        {errors[f] ? <p className="mt-1 text-xs font-bold text-shu-600">{errors[f]}</p> : null}
      </div>
    );
  };

  return (
    <div className="space-y-5" data-estimate-form>
      <ol className="flex items-center text-xs" aria-label="お手続きの流れ">
        {STEPS.map((s, i) => (
          <li key={s} className={`flex items-center ${i < STEPS.length - 1 ? "flex-1" : ""}`} aria-current={i === step ? "step" : undefined}>
            <span className="flex items-center gap-1.5">
              <span
                className={`grid h-7 w-7 place-items-center rounded-full text-[12px] font-bold transition ${
                  i < step ? "bg-ichi-green text-white" : i === step ? "bg-ichi-theme text-white ring-4 ring-ichi-green/15" : "bg-sumi-100 text-sumi-400"
                }`}
              >
                {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={i === step ? "font-bold text-ichi-theme" : "text-sumi-400"}>{s}</span>
            </span>
            {i < STEPS.length - 1 ? <span className={`mx-2 h-0.5 flex-1 rounded ${i < step ? "bg-ichi-green" : "bg-sumi-100"}`} /> : null}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {banner}
          <div className="divide-y divide-sumi-100 rounded-xl border border-sumi-200 bg-white">
            {field(
              "name",
              <input
                className="input"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  report({ name: e.target.value }, "name");
                }}
                placeholder="例：山田 花子"
                autoComplete="name"
                aria-label="お名前"
              />,
              `${name} 様`,
            )}
            {field(
              "phone",
              <input
                className="input"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  report({ phone: e.target.value }, "phone");
                }}
                placeholder="例：090-1234-5678"
                inputMode="tel"
                autoComplete="tel"
                aria-label="お電話番号"
              />,
            )}
            {field(
              "address",
              <input
                className="input"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  report({ address: e.target.value }, "address");
                }}
                placeholder="例：熊本県熊本市中央区水前寺1-2-3"
                autoComplete="street-address"
                aria-label="ご住所"
              />,
            )}
            {field(
              "dates",
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <div key={i} className="grid grid-cols-[1fr_112px] gap-2 rounded-xl border border-sumi-100 p-2.5 sm:grid-cols-[64px_1fr_104px_1.2fr] sm:items-center sm:border-0 sm:p-0">
                    <span className="col-span-2 text-xs font-bold text-sumi-500 sm:col-span-1">
                      第{i + 1}希望{i === 0 ? null : <span className="ml-1 font-normal text-sumi-400">（任意）</span>}
                    </span>
                    <input type="date" className="input" min={minDateIso()} value={r.date} onChange={(e) => updateRow(i, { date: e.target.value })} aria-label={`第${i + 1}希望の日付`} />
                    <select className="input" value={r.slot} onChange={(e) => updateRow(i, { slot: e.target.value })} aria-label={`第${i + 1}希望の時間帯`}>
                      {SLOTS.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                    <input
                      className="input col-span-2 sm:col-span-1"
                      value={r.text}
                      onChange={(e) => updateRow(i, { text: e.target.value })}
                      placeholder={i === 0 ? "例：10月28日（水） 午前／指定なし" : "任意（例：来週の平日 午後）"}
                      aria-label={`第${i + 1}希望（自由入力）`}
                    />
                  </div>
                ))}
                <p className="text-[11px] text-sumi-400">日付を選ぶか、右の欄に直接入力してください。</p>
              </div>,
              <ul className="space-y-0.5">
                {dates.map((d, i) => (
                  <li key={i}>
                    <span className="mr-2 text-xs font-bold text-sumi-500">第{i + 1}希望</span>
                    {d === "指定なし" ? "指定なし（担当者とご相談）" : d}
                  </li>
                ))}
              </ul>,
            )}
            <p className="bg-washi-50/60 px-4 py-2 text-[11px] leading-relaxed text-sumi-500">
              ※ご希望日時は確定ではありません。担当者よりお電話でご相談のうえ、お伺いする日時を決定いたします。
            </p>
            {field(
              "summary",
              <textarea
                className="input min-h-[110px]"
                value={summary}
                onChange={(e) => {
                  setSummary(e.target.value);
                  report({ summary: e.target.value }, "summary");
                }}
                placeholder="例：6畳和室の畳の表替え。国産い草希望。ペットあり。"
                aria-label="ご相談内容"
              />,
            )}
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-sumi-200 px-4 py-3 text-sm text-sumi-700 has-[:checked]:border-ichi-green has-[:checked]:bg-ichi-cream/60">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-[#488937]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            上記の内容に間違いありません。担当者からの折り返し連絡に同意します。
          </label>
          {serverError ? <p className="rounded-xl border border-shu-200 bg-shu-50 p-3 text-sm text-shu-700">{serverError}</p> : null}
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-sumi-400">
            <LockKeyhole className="mt-0.5 h-3 w-3 shrink-0" />
            ご入力いただいた情報は、お見積りのご連絡以外には使用しません。
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            {onCancel ? (
              <button type="button" className="btn-ghost" onClick={onCancel}>
                あとで送る（閉じる）
              </button>
            ) : (
              <span />
            )}
            <button type="submit" className="btn-accent py-3 sm:py-2.5" disabled={submitting || loading || !agree}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              この内容で送信する
            </button>
          </div>
        </form>
      )}

      {step === 1 && result ? (
        <div className="space-y-4 text-center">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-ichi-cream">
            <CheckCircle2 className="h-9 w-9 text-ichi-green" />
          </span>
          <h3 className="font-hand text-2xl text-ichi-theme">お見積りのご依頼を受付しました</h3>
          <div className="mx-auto w-fit rounded-xl border border-sumi-200 px-5 py-2.5">
            <p className="text-[11px] text-sumi-400">受付番号</p>
            <p className="font-mono text-lg font-bold tracking-wide text-sumi-800">{result.estimate.id}</p>
          </div>
          <p className="text-sm leading-relaxed text-sumi-600">
            担当者より折り返しお電話し、お見積りに伺う日程を決めさせていただきます。
            <br />
            <span className="text-xs text-sumi-400">受付日時：{formatJst(result.estimate.receivedAt)}</span>
          </p>
          {lineUrl ? (
            <div className="rounded-xl border border-ichi-line/40 bg-ichi-line/10 p-4 text-left">
              <p className="text-sm font-bold text-ichi-theme">一畳屋の公式LINEもご利用いただけます（任意）</p>
              <p className="mt-1 text-xs leading-relaxed text-sumi-600">
                公式LINEのページを開いて友だち追加すると、LINEでもご相談・ご連絡いただけます。トークで受付番号をお知らせいただくと、担当者がこのご依頼をすぐに確認できます。
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a href={lineUrl} target="_blank" rel="noreferrer" className="btn-line" data-line-link>
                  <SpriteIcon id="i-line-square" size={18} />
                  LINEのページを開く
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <button type="button" className="btn-secondary" onClick={copyId}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "コピーしました" : "受付番号をコピー"}
                </button>
              </div>
            </div>
          ) : null}
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
