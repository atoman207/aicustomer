"use client";

// トップのキービジュアル（ichijoya.co.jp の #kv-fader を再現）
//   duration=3000 / interval=6500 / easing=ease のクロスフェード、スタッフ・店舗ラベルはカクカク揺れる
import { useEffect, useState } from "react";
import { photo } from "@/lib/brand";

const DURATION = 3000;
const INTERVAL = 6500;
const K = "/ichijoya/kv";

function Pic({ name, className, width }: { name: string; className?: string; width?: number }) {
  const p = photo(name);
  return (
    <picture>
      <source type="image/webp" srcSet={p.webp} />
      <img src={p.png} alt="" width={width} className={className} draggable={false} />
    </picture>
  );
}

function Staff() {
  return (
    <div className="kv-center__sub">
      <Pic name="staff-shinichiro" width={167} className="kv-staff kv-staff--1" />
      <Pic name="staff-mitsuko" width={147} className="kv-staff kv-staff--2" />
      <Pic name="staff-shinjiro" width={150} className="kv-staff kv-staff--3" />
      <Pic name="staff-kisaburo" width={150} className="kv-staff kv-staff--4" />
    </div>
  );
}

function Deco({ yey, shift }: { yey: string; shift?: boolean }) {
  return (
    <div className={`kv-deco ${shift ? "kv-deco--shift" : ""}`}>
      <img src={`${K}/kv-i-a.svg`} alt="" width={53} className="kv-deco__item kv-deco__item--1" />
      <img src={`${K}/kv-i-b.svg`} alt="" width={52} className="kv-deco__item kv-deco__item--2" />
      <img src={`${K}/kv-i-c.svg`} alt="" width={29} className="kv-deco__item kv-deco__item--3" />
      <img src={`${K}/${yey}`} alt="" width={196} className="kv-deco__item kv-deco__item--4" />
      <img src={`${K}/kv-yonin.svg`} alt="" width={125} className="kv-deco__item kv-deco__item--5" />
    </div>
  );
}

const SLIDES = [
  {
    key: "tatami",

    label: "いい畳作ります。（一畳屋の四兄弟）",
    body: (
      <div className="kv__content kv__content--green">
        <div className="kv-center kv-center--shift">
          <img src={`${K}/kv-tatami-main.svg`} alt="" width={325} className="kv-center__main kv-center__main--tatami" />
          <Staff />
        </div>
        <div className="kv-copy">
          <img src={`${K}/kv-tatami-copy.svg`} alt="" width={94} className="kv-copy__label--tatami" />
        </div>
        <Deco yey="kv-tatami-yey.svg" shift />
        <div className="kv-leftbottom kv-leftbottom--tatami">
          <Pic name="kv-pic_tatami" width={325} />
        </div>
      </div>
    ),
  },
  {
    key: "fusuma",

    label: "いい襖作ります。（襖・障子・アミ戸も一畳屋）",
    body: (
      <div className="kv__content kv__content--blue">
        <div className="kv-center kv-center--shift">
          <img src={`${K}/kv-fusuma-main.svg`} alt="" width={362} className="kv-center__main kv-center__main--fusuma" />
          <Staff />
        </div>
        <div className="kv-copy">
          <img src={`${K}/kv-fusuma-copy.svg`} alt="" width={98} className="kv-copy__label--fusuma" />
        </div>
        <Deco yey="kv-fusuma-yey.svg" shift />
        <div className="kv-leftbottom kv-leftbottom--fusuma">
          <Pic name="kv-pic_fusuma" width={329} />
        </div>
      </div>
    ),
  },
  {
    key: "omakase",

    label: "近くの一畳屋におまかせ！（熊本県内の店舗）",
    body: (
      <div className="kv__content kv__content--green">
        <div className="kv-center">
          <Pic name="kv-omakase-main" width={1540} className="kv-center__main kv-center__main--omakase" />
        </div>
        <div className="kv-copy kv-copy--omakase">
          <img src={`${K}/kv-3-copy.svg`} alt="" width={179} className="kv-copy__label--omakase" />
        </div>
        {(
          [
            ["tamana", "kv-yey-tamana.svg", "kv-store-tamana"],
            ["showroom", "kv-yey-showroom.svg", "kv-store-showroom"],
            ["nishi", "kv-yey-nishi.svg", "kv-store-nishi"],
            ["koushi", "kv-yey-goshi.svg", "kv-store-koushi"],
            ["tyuou", "kv-yey-tyuou.svg", "kv-store-tyuou"],
          ] as const
        ).map(([k, text, pic]) => (
          <div key={k} className={`kv-store kv-store--${k}`}>
            <img src={`${K}/${text}`} alt="" width={179} className="text" />
            <Pic name={pic} width={800} className="pic" />
          </div>
        ))}
      </div>
    ),
  },
];

export default function KeyVisual() {
  const [{ index, prev }, setSlide] = useState<{ index: number; prev: number | null }>({ index: 0, prev: null });

  useEffect(() => {
    let timer: number | undefined;
    const start = () => {
      stop();
      timer = window.setInterval(() => {
        setSlide((s) => ({ index: (s.index + 1) % SLIDES.length, prev: s.index }));
      }, INTERVAL);
    };
    const stop = () => {
      if (timer) window.clearInterval(timer);
      timer = undefined;
    };
    const onVis = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <section className="kv relative w-full select-none" aria-roledescription="carousel" aria-label="一畳屋のご紹介">
      <div className="kv__inner">
        <div className="kv-fader">
          {SLIDES.map((s, i) => {
            const active = i === index;
            return (
              <div
                key={s.key}
                className="kv-fader__item"
                aria-hidden={!active}
                style={{
                  opacity: active ? 1 : 0,
                  zIndex: active ? 2 : i === prev ? 1 : 0,
                  transitionDuration: `${DURATION}ms`,
                  transitionTimingFunction: "ease",
                }}
              >
                <div role="img" aria-label={s.label} className="h-full">
                  {s.body}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
