import type { Config } from "tailwindcss";

// 一畳屋（ichijoya.co.jp）のカラーパレットに合わせた配色
//   --theme #1c4911（濃緑：ナビ・フッター） / --green-488937（KV・ボタン） / --sub #a72126（赤：電話番号・CTA）
//   #48af57（LINE） / --yellow-fdd000（強調） / --gray-fffdea（クリーム） / --blue-3b3980（襖スライド）
// 既存コンポーネントのクラス名（ai / shu / tatami / washi / sumi）はそのまま、値を一畳屋の配色に置き換えています。
const green = {
  50: "#f2f8ef",
  100: "#e2f0dc",
  200: "#c5e0ba",
  300: "#9fca8f",
  400: "#6fa95e",
  500: "#58993f",
  600: "#488937",
  700: "#3a7029",
  800: "#2a5a1d",
  900: "#1c4911",
};

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ichi: { theme: "#1c4911", green: "#488937", leaf: "#488837", line: "#48af57", red: "#a72126", yellow: "#fdd000", cream: "#fffdea", cream2: "#fffcdb", blue: "#3b3980", text: "#222222", paper: "#f7f5f2" },
        ai: green,
        tatami: green,
        shu: { 50: "#fff6f6", 100: "#fbe3e3", 200: "#f2bcbd", 300: "#e08a8c", 400: "#c4474b", 500: "#a72126", 600: "#8f1c20", 700: "#76171b", 800: "#5c1215", 900: "#430d0f" },
        washi: { 50: "#ffffff", 100: "#fffdea", 200: "#efefef", 300: "#e2e2e2", 400: "#cccccc" },
        sumi: { 50: "#f7f9f9", 100: "#eeeeee", 200: "#cccccc", 300: "#aaaaaa", 400: "#888888", 500: "#666666", 600: "#444444", 700: "#333333", 800: "#222222", 900: "#111111" },
      },
      fontFamily: {
        sans: ['"Noto Sans JP"', "Noto-Sans-JP", '"Hiragino Kaku Gothic ProN"', '"Hiragino Sans"', "Meiryo", "sans-serif"],
        hand: ['"Yusei Magic"', '"Noto Sans JP"', "sans-serif"],
        serif: ['"Yusei Magic"', '"Noto Sans JP"', "sans-serif"],
        en: ["-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "Roboto", '"Helvetica Neue"', "Arial", "sans-serif"],
      },
      boxShadow: {
        soft: "0 0 4px 0 rgba(0,0,0,0.1)",
        card: "0 0 4px 0 rgba(0,0,0,0.1)",
        lift: "0 6px 18px -8px rgba(0,0,0,0.25)",
      },
      keyframes: {
        // ichijoya.co.jp の「カクカク揺れる」アニメーション（2s steps(2) infinite）
        shake1: { "0%, 100%": { transform: "rotate(-10deg)" }, "50%": { transform: "rotate(10deg)" } },
        shake2: { "0%, 100%": { transform: "rotate(10deg)" }, "50%": { transform: "rotate(-10deg)" } },
        pulseRing: { "0%": { transform: "scale(0.9)", opacity: "0.8" }, "100%": { transform: "scale(1.6)", opacity: "0" } },
        fadeUp: { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        blink: { "0%, 80%, 100%": { opacity: "0.2" }, "40%": { opacity: "1" } },
      },
      animation: {
        shake1: "shake1 2s steps(2) infinite",
        shake2: "shake2 2s steps(2) infinite",
        pulseRing: "pulseRing 1.6s ease-out infinite",
        fadeUp: "fadeUp 0.35s ease-out both",
        blink: "blink 1.2s infinite",
      },
      transitionTimingFunction: {
        drawer: "cubic-bezier(.22,.82,.24,.96)",
        trigger: "cubic-bezier(.645,.045,.355,1)",
        bounce: "cubic-bezier(.16,.44,.48,1.21)",
      },
    },
  },
  plugins: [],
};

export default config;
