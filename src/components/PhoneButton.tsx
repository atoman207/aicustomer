// ふつうの電話ボタン（フリーダイヤル）。「営業時間外・土日はAIが受付」を添える
//   電話の受付そのもの（営業時間内はスタッフ、時間外・土日は AI）は裏側の AI 電話受付がそのまま担う
import { PhoneCall } from "lucide-react";
import { ASSETS, BRAND } from "@/lib/brand";
import { BUSINESS } from "@/lib/company";

const TEL = `tel:${BRAND.freeDialTel}`;

/** トップの「AIに相談する」の下に置く、横長の電話案内 */
export function PhoneCallout() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border-2 border-dashed border-ichi-green/40 bg-white px-5 py-5 text-center sm:flex-row sm:px-7 sm:text-left">
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-ichi-cream text-ichi-red" aria-hidden>
        <PhoneCall className="h-7 w-7" strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-sumi-800">お電話でもご相談いただけます（通話無料）</p>
        <a href={TEL} className="mt-1 inline-flex min-h-11 items-center transition-opacity hover:opacity-80" aria-label={`${BRAND.freeDial} に電話をかける`}>
          <img src={ASSETS.freeDial} alt={BRAND.freeDial} width={250} className="w-[230px] sm:w-[250px]" />
        </a>
        <p className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-sumi-600 sm:justify-start">
          <span>
            営業時間 {BUSINESS.hours}（{BUSINESS.closed}定休）
          </span>
          <span className="inline-flex items-center rounded-full bg-ichi-green px-2.5 py-0.5 text-[11px] font-bold text-white" data-phone-note>
            {BRAND.phoneAiNote}
          </span>
        </p>
      </div>
      <a href={TEL} className="btn-accent w-full shrink-0 py-3 text-base sm:w-auto">
        <PhoneCall className="h-5 w-5" />
        電話をかける
      </a>
    </div>
  );
}

/** 相談画面の横・メニューの中に置く、小さな電話案内 */
export function PhoneCompact({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-xl border border-washi-300 bg-white px-4 py-3 text-center ${className}`}>
      <p className="text-xs font-bold text-sumi-700">お電話でのご相談（通話無料）</p>
      <a href={TEL} className="mt-1 inline-flex min-h-11 items-center transition-opacity hover:opacity-80" aria-label={`${BRAND.freeDial} に電話をかける`}>
        <img src={ASSETS.freeDial} alt={BRAND.freeDial} width={210} className="mx-auto" />
      </a>
      <p className="mt-1 text-[11px] text-sumi-500">営業時間 {BUSINESS.hours}（{BUSINESS.closed}定休）</p>
      <p className="mt-1 inline-flex rounded-full bg-ichi-green px-2.5 py-0.5 text-[11px] font-bold text-white" data-phone-note>
        {BRAND.phoneAiNote}
      </p>
    </div>
  );
}
