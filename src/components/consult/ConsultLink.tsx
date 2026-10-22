"use client";

// AI 相談への入口のリンク（メニュー・ヘッダー・スマホの固定ボタン・よくあるご質問）。
// このページに相談の画面があれば、移動せずにその画面で始める（声はこのクリックの中で始める）。なければ href へ移動
import Link from "next/link";
import type { ReactNode } from "react";
import { sendConsultCommand, type ConsultCommand } from "@/lib/consult-events";

export default function ConsultLink({
  command,
  href,
  className,
  children,
  onDone,
  ...rest
}: {
  command: ConsultCommand;
  href: string;
  className?: string;
  children: ReactNode;
  /** 合図を送ったあと（メニューを閉じる など） */
  onDone?: () => void;
  "aria-label"?: string;
  "aria-current"?: "page";
  tabIndex?: number;
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={(e) => {
        if (sendConsultCommand(command)) {
          e.preventDefault();
          onDone?.();
        }
      }}
      {...rest}
    >
      {children}
    </Link>
  );
}
