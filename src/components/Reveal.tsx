"use client";

// スクロールで表示（ichijoya.co.jp の ScrollTrigger モジュールと同じ挙動）
//   - 画面に入ったら .is-observed を付与（初期状態は globals.css の [data-st-effect]）
//   - 既定 500ms / ease-in-out / rootMargin -15%
//   - ページ最下部まで来たら残りもすべて表示（最下部の要素が出ないままになるのを防ぐ）
import { createElement, useEffect, useRef, type CSSProperties, type ReactNode } from "react";

type Effect = "fade" | "fade-up" | "fade-down" | "fade-left" | "fade-right" | "zoom-in" | "blur";

const pending = new Set<HTMLElement>();
let bottomListener = false;

function revealAllAtBottom() {
  if (typeof window === "undefined") return;
  const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
  if (!atBottom) return;
  pending.forEach((el) => el.classList.add("is-observed"));
  pending.clear();
}

export default function Reveal({
  as = "div",
  effect = "fade-up",
  duration = 500,
  delay = 0,
  className,
  style,
  children,
}: {
  as?: "div" | "section" | "li" | "span" | "article" | "figure" | "p";
  effect?: Effect;
  duration?: number;
  delay?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-observed");
      return;
    }
    pending.add(el);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.classList.add("is-observed");
            pending.delete(el);
            io.unobserve(el);
          }
        }
      },
      { root: null, rootMargin: "-15% 0px", threshold: [0, 1] },
    );
    io.observe(el);
    if (!bottomListener) {
      bottomListener = true;
      window.addEventListener("scroll", revealAllAtBottom, { passive: true });
      window.addEventListener("resize", revealAllAtBottom, { passive: true });
    }
    // ページが短く最初から最下部にいる場合
    const t = window.setTimeout(revealAllAtBottom, 400);
    return () => {
      window.clearTimeout(t);
      pending.delete(el);
      io.disconnect();
    };
  }, []);

  return createElement(
    as,
    {
      ref,
      "data-st-effect": effect,
      className,
      style: { transitionDuration: `${duration}ms`, transitionDelay: `${delay}ms`, transitionTimingFunction: "ease-in-out", ...style },
    },
    children,
  );
}
