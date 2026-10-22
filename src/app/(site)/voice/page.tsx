import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// 声の相談は、文字と同じ相談の画面（/chat）で行う（入口を分けない）。以前のリンク・埋め込み（?embed=1）はそのまま /chat?voice=1 へ
export default async function VoicePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  q.set("voice", "1");
  redirect(`/chat?${q.toString()}`);
}
