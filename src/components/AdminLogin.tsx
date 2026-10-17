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
    <form onSubmit={submit} className="card mx-auto w-full max-w-sm space-y-4 p-6">
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-ai-600 text-white">
          <LockKeyhole className="h-4 w-4" />
        </span>
        <div>
          <p className="font-serif text-lg font-bold text-sumi-800">管理画面ログイン</p>
          <p className="text-xs text-sumi-400">ADMIN_PASSWORD を入力してください</p>
        </div>
      </div>
      <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="パスワード" autoFocus />
      {error ? <p className="text-sm text-shu-600">{error}</p> : null}
      <button type="submit" className="btn-primary w-full" disabled={busy || !password}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        ログイン
      </button>
    </form>
  );
}
