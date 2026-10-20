"use client";

import { Loader2, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AdminLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setError(j.error ?? "ログインに失敗しました");
        return;
      }
      router.push("/admin");
      router.refresh();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-black/[0.08] bg-white p-6 shadow-[0_2px_14px_rgba(0,0,0,0.05)]">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-[#0d0d0d] text-white">
          <LockKeyhole className="h-4 w-4" />
        </span>
        <div>
          <p className="text-base font-semibold text-[#0d0d0d]">管理画面にログイン</p>
          <p className="text-xs text-[#8f8f8f]">スタッフ用のパスワードを入力してください</p>
        </div>
      </div>
      <input
        type="password"
        className="w-full rounded-xl border border-black/10 px-3 py-2.5 text-sm outline-none transition focus:border-black/30 focus:ring-2 focus:ring-black/5"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="パスワード"
        autoFocus
        aria-label="パスワード"
      />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        className="flex w-full items-center justify-center gap-1.5 rounded-full bg-[#0d0d0d] py-2.5 text-sm font-medium text-white transition hover:bg-black/80 disabled:bg-black/20"
        disabled={busy || !password}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        ログイン
      </button>
    </form>
  );
}
