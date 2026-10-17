"use client";

import { Home, MessageSquareText, Mic, Phone, PhoneCall, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "ホーム", icon: Home },
  { href: "/chat", label: "テキスト相談", icon: MessageSquareText },
  { href: "/voice", label: "音声相談", icon: Mic },
  { href: "/phone", label: "AI電話受付", icon: PhoneCall },
  { href: "/admin", label: "管理画面", icon: Settings2 },
];

export default function SiteHeader({ company, phone }: { company: string; phone: string }) {
  const pathname = usePathname() ?? "/";
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <header className="sticky top-0 z-40 border-b border-washi-300/70 bg-washi-50/85 backdrop-blur">
      <div className="container-x flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ai-600 font-serif text-lg text-white shadow-soft">
            畳
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate font-serif text-base font-bold text-sumi-800 sm:text-lg">{company}</span>
            <span className="block text-[11px] tracking-wider text-sumi-400">AI顧客相談・電話受付システム</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${
                isActive(href) ? "bg-ai-600 text-white shadow-soft" : "text-sumi-600 hover:bg-washi-200"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
        <a
          href={`tel:${phone.replace(/[^\d+]/g, "")}`}
          className="hidden items-center gap-2 rounded-full border border-shu-200 bg-shu-50 px-3 py-1.5 text-sm font-semibold text-shu-600 sm:flex"
        >
          <Phone className="h-4 w-4" />
          {phone}
        </a>
      </div>
      <nav className="container-x flex gap-1 overflow-x-auto pb-2 md:hidden">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs ${
              isActive(href) ? "bg-ai-600 text-white" : "bg-white/70 text-sumi-600"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
