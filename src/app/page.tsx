import {
  ArrowRight,
  BookOpenCheck,
  ClipboardCheck,
  FileSpreadsheet,
  Headphones,
  MessageSquareText,
  Mic,
  PhoneCall,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { IMAGES } from "@/lib/images";
import { serverBaseUrl } from "@/lib/server-url";
import { getIntegrationStatus } from "@/lib/status";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

const CHANNELS = [
  {
    href: "/chat",
    icon: MessageSquareText,
    num: "①",
    title: "テキストAI相談",
    desc: "ホームページ上で文字で質問。社内ナレッジだけを根拠に回答し、見積依頼は会話を要約してフォームへ自動入力します。",
    image: IMAGES.engawaGarden,
    cta: "文字で相談する",
  },
  {
    href: "/voice",
    icon: Mic,
    num: "②",
    title: "音声AI相談",
    desc: "ブラウザでAIと自然に音声会話。途中の割り込みや言い直しにも対応し、見積情報は画面で確認してから送信します。",
    image: IMAGES.washitsuLight,
    cta: "声で相談する",
  },
  {
    href: "/phone",
    icon: PhoneCall,
    num: "③",
    title: "AI電話受付",
    desc: "既存の0120番号への着信を、休日・営業時間外はAIが受付。復唱確認のうえスプレッドシートに登録し、担当者が折り返します。",
    image: IMAGES.shojiDoors,
    cta: "電話受付を試す",
  },
];

const SERVICES = [
  { title: "畳", sub: "表替え・裏返し・新調", image: IMAGES.tatami, text: "熊本・八代産の国産い草を中心に、和紙表・樹脂表のカラー畳まで。即日仕上げにも対応。" },
  { title: "襖", sub: "張替え・新調", image: IMAGES.fusuma, text: "約200種類の襖紙サンプルからお選びいただけます。強化襖紙でペット対策も。" },
  { title: "障子", sub: "張替え・新調", image: IMAGES.shoji, text: "破れにくい強化障子紙やワーロンなど、暮らしに合わせた紙をご提案します。" },
  { title: "網戸", sub: "張替え・新調", image: IMAGES.amido, text: "その場で15〜20分。ブラックネットや細かい目のネット、ペット対応ネットも。" },
  { title: "リフォーム", sub: "和室の洋室化・内装・水回り", image: IMAGES.reform, text: "押入れのクローゼット化、クロス、内窓、バリアフリーまで住まいの困りごとに対応。" },
];

const GALLERY = [IMAGES.fujiSakura, IMAGES.kyotoPagoda, IMAGES.hakoneTorii, IMAGES.meguroSakura, IMAGES.chureitoFuji, IMAGES.fushimiInari, IMAGES.kimonoShrine, IMAGES.kyotoDusk, IMAGES.tokyoAlley, IMAGES.kyotoStreet];

const FLOW = [
  { icon: Headphones, title: "ご相談", text: "テキスト・音声・電話のどこからでも、同じAI相談員が対応します。" },
  { icon: BookOpenCheck, title: "ナレッジで回答", text: "Googleスプレッドシート「社内総合マニュアル」の指定1シートだけを根拠に回答。推測や一般知識での誤案内を防ぎます。" },
  { icon: ClipboardCheck, title: "確認してから登録", text: "氏名・住所・電話・希望日（第1〜第3）とAI要約をお客様に提示し、確認・修正いただいてから登録します。" },
  { icon: FileSpreadsheet, title: "一元管理・折り返し", text: "受付日時・経路・内容をスプレッドシートに記録。担当者が折り返して日程を確定します。" },
];

const PHASES = [
  { phase: "Phase 1", title: "テキストAI相談から開始", text: "HPにチャット窓口を設置。ナレッジシートの整備と回答品質の確認を行います。", done: true },
  { phase: "Phase 2", title: "音声AI相談へ拡張", text: "同じナレッジ・同じ受付フローのまま、ブラウザ音声会話を追加します。", done: true },
  { phase: "Phase 3", title: "AI電話受付へ拡張", text: "0120番号をTwilioへ転送し、休日・営業時間外の電話をAIが受付。管理画面で人間対応と切替。", done: true },
];

export default async function HomePage() {
  const [status, settings] = await Promise.all([getIntegrationStatus(await serverBaseUrl()), getSettings()]);
  return (
    <div>
      {/* Hero */}
      <section className="relative h-[78vh] max-h-[820px] min-h-[560px] w-full overflow-hidden">
        <Image src={IMAGES.hero.src} alt={IMAGES.hero.alt} fill priority sizes="100vw" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-sumi-900/85 via-sumi-900/55 to-sumi-900/20" />
        <div className="container-x relative flex h-full flex-col justify-center">
          <p className="eyebrow text-washi-200">熊本県｜畳・襖・障子・網戸・住宅リフォーム</p>
          <h1 className="mt-4 max-w-4xl font-serif text-3xl font-bold leading-tight text-white sm:text-5xl">
            AIが24時間、
            <br />
            住まいのご相談と
            <wbr />
            見積受付を承ります。
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-washi-100/90 sm:text-base">
            テキスト・音声・電話の3つの窓口を、ひとつの社内ナレッジでつなぐ顧客相談システム。
            回答の根拠を社内マニュアルに限定し、見積依頼はお客様の確認を経てスプレッドシートへ。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/chat" className="btn-primary">
              <MessageSquareText className="h-4 w-4" />
              文字で相談する
            </Link>
            <Link href="/voice" className="btn-secondary">
              <Mic className="h-4 w-4" />
              声で相談する
            </Link>
            <Link href="/phone" className="btn-accent">
              <PhoneCall className="h-4 w-4" />
              電話受付を試す
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap gap-2">
            <Badge tone={status.openai.configured ? "green" : "amber"}>{status.openai.configured ? `OpenAI API 接続中（${status.openai.model}）` : "デモモード：OpenAIキー未設定（テンプレート応答）"}</Badge>
            <Badge tone={status.knowledge.source === "local" ? "amber" : "green"}>ナレッジ：{status.knowledge.label}（{status.knowledge.entries}件）</Badge>
            <Badge tone={status.reception.sink === "local" ? "amber" : "green"}>記録先：{status.reception.sink === "local" ? "ローカル（シート未接続）" : "Googleスプレッドシート"}</Badge>
          </div>
        </div>
      </section>

      {/* 3 channels */}
      <section className="container-x py-16">
        <p className="eyebrow">3つの相談窓口</p>
        <h2 className="section-title mt-2">どこから相談しても、同じ答え・同じ受付フロー</h2>
        <p className="mt-3 max-w-2xl text-sm text-sumi-600">
          3窓口はすべて共通の社内ナレッジと受付ロジックを使います。ナレッジシートを更新すれば、全窓口の回答が同時に変わります。
        </p>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {CHANNELS.map((c) => (
            <Link key={c.href} href={c.href} className="card group overflow-hidden transition hover:-translate-y-0.5 hover:shadow-soft">
              <div className="relative h-44">
                <Image src={c.image.src} alt={c.image.alt} fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover transition duration-500 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-sumi-900/70 to-transparent" />
                <div className="absolute bottom-3 left-4 flex items-center gap-2 text-white">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-white/20 backdrop-blur">
                    <c.icon className="h-4 w-4" />
                  </span>
                  <span className="font-serif text-lg font-bold">
                    {c.num} {c.title}
                  </span>
                </div>
              </div>
              <div className="p-5">
                <p className="text-sm leading-relaxed text-sumi-600">{c.desc}</p>
                <p className="mt-4 flex items-center gap-1 text-sm font-semibold text-ai-600">
                  {c.cta}
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Flow */}
      <section className="border-y border-washi-300/70 bg-white/60 py-16">
        <div className="container-x">
          <p className="eyebrow">仕組み</p>
          <h2 className="section-title mt-2">ナレッジに忠実に答え、確認してから記録する</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-4">
            {FLOW.map((f, i) => (
              <div key={f.title} className="card relative p-5">
                <span className="absolute right-4 top-4 font-serif text-3xl text-washi-300">{String(i + 1).padStart(2, "0")}</span>
                <span className="grid h-10 w-10 place-items-center rounded-full bg-ai-50 text-ai-600">
                  <f.icon className="h-5 w-5" />
                </span>
                <p className="mt-3 font-semibold text-sumi-800">{f.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-sumi-600">{f.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-3 rounded-2xl border border-ai-100 bg-ai-50/60 p-5 text-sm text-ai-900 md:grid-cols-3">
            <p className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              ナレッジにない質問は推測せず「担当者より折り返し」へ誘導
            </p>
            <p className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
              シートの更新は約1分で3窓口すべてに反映
            </p>
            <p className="flex items-start gap-2">
              <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0" />
              AIは日程を確定せず、確認済みの内容を担当者へ引き継ぎ
            </p>
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="container-x py-16">
        <p className="eyebrow">取扱工事</p>
        <h2 className="section-title mt-2">畳・襖・障子・網戸・リフォーム</h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {SERVICES.map((s) => (
            <div key={s.title} className="card overflow-hidden">
              <div className="relative h-40">
                <Image src={s.image.src} alt={s.image.alt} fill sizes="(max-width: 640px) 100vw, 20vw" className="object-cover" />
              </div>
              <div className="p-4">
                <p className="font-serif text-xl font-bold text-sumi-800">{s.title}</p>
                <p className="text-xs text-ai-600">{s.sub}</p>
                <p className="mt-2 text-xs leading-relaxed text-sumi-600">{s.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Kumamoto */}
      <section className="container-x pb-16">
        <div className="card grid overflow-hidden md:grid-cols-2">
          <div className="relative min-h-[280px]">
            <Image src={IMAGES.kumamoto.src} alt={IMAGES.kumamoto.alt} fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />
          </div>
          <div className="flex flex-col justify-center p-8">
            <p className="eyebrow">熊本・地域密着</p>
            <h2 className="section-title mt-2">い草の産地・熊本から、暮らしに寄り添う</h2>
            <p className="mt-4 text-sm leading-relaxed text-sumi-600">
              熊本は国産い草の生産量日本一の産地です。{settings.companyName}
              は熊本市を拠点に、合志・菊陽・益城・八代など県内各地へお伺いします。AI受付が休日や営業時間外のご相談も取りこぼさず、翌営業日に担当者からご連絡します。
            </p>
            <p className="mt-4 text-sm font-semibold text-shu-600">フリーダイヤル {settings.companyPhone}（24時間AI受付）</p>
          </div>
        </div>
      </section>

      {/* Phases */}
      <section className="border-y border-washi-300/70 bg-white/60 py-16">
        <div className="container-x">
          <p className="eyebrow">段階的な導入</p>
          <h2 className="section-title mt-2">まずテキストから。音声・電話へ同じ土台で拡張</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {PHASES.map((p) => (
              <div key={p.phase} className="card p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-widest text-ai-500">{p.phase}</span>
                  <Badge tone="green">このデモで実装済み</Badge>
                </div>
                <p className="mt-2 font-semibold text-sumi-800">{p.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-sumi-600">{p.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Gallery */}
      <section className="container-x py-16">
        <p className="eyebrow">日本の住まいと風景</p>
        <h2 className="section-title mt-2">受け継がれてきた和の暮らしを、次の世代へ</h2>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {GALLERY.map((g, i) => (
            <div key={g.src} className={`relative overflow-hidden rounded-2xl ${i % 5 === 0 ? "row-span-2 h-full min-h-[260px]" : "h-32 sm:h-36"}`}>
              <Image src={g.src} alt={g.alt} fill sizes="(max-width: 640px) 50vw, 20vw" className="object-cover transition duration-700 hover:scale-105" />
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="container-x pb-8">
        <div className="relative overflow-hidden rounded-3xl bg-ai-700 px-8 py-12 text-white shadow-soft">
          <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10" />
          <div className="absolute -bottom-16 right-24 h-56 w-56 rounded-full bg-white/5" />
          <p className="eyebrow text-ai-100">まずは試してみてください</p>
          <h2 className="mt-2 font-serif text-2xl font-bold sm:text-3xl">「6畳の畳の表替えはいくら？」と聞いてみる</h2>
          <p className="mt-3 max-w-xl text-sm text-ai-100">
            3つの窓口はすべて同じ答えを返し、同じ手順で見積を受付します。管理画面では受付一覧・会話履歴・ナレッジ・AI／人間の切替を確認できます。
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/chat" className="btn-secondary">
              テキスト相談へ
            </Link>
            <Link href="/voice" className="btn-secondary">
              音声相談へ
            </Link>
            <Link href="/phone" className="btn-secondary">
              電話受付へ
            </Link>
            <Link href="/admin" className="btn-accent">
              管理画面を見る
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
