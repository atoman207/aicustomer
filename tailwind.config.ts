import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        washi: { 50: "#fdfbf7", 100: "#f8f3ea", 200: "#efe6d6", 300: "#e2d4bc", 400: "#cdb892" },
        sumi: { 50: "#f4f4f3", 100: "#e2e2df", 200: "#c4c4bf", 300: "#9a9a93", 400: "#6f6f68", 500: "#4f4f49", 600: "#3a3a35", 700: "#2a2a26", 800: "#1c1c19", 900: "#121210" },
        ai: { 50: "#eef3f8", 100: "#d6e2ee", 200: "#adc4dc", 300: "#7fa1c5", 400: "#527eab", 500: "#2f5f8f", 600: "#234b73", 700: "#1b3a5a", 800: "#142b43", 900: "#0e1e2f" },
        tatami: { 50: "#f1f6ee", 100: "#dfe9d6", 200: "#c0d3ae", 300: "#9ab882", 400: "#789c5f", 500: "#5c7f46", 600: "#486537", 700: "#394f2d", 800: "#2d3e25", 900: "#23301e" },
        shu: { 50: "#fdf1ed", 100: "#f9dcd3", 200: "#f2b8a6", 300: "#e98d73", 400: "#dc6446", 500: "#c8432a", 600: "#a83520", 700: "#872b1c", 800: "#6b241a", 900: "#561f18" },
      },
      fontFamily: {
        sans: ['"Noto Sans JP"', '"Hiragino Sans"', '"Yu Gothic"', "Meiryo", "system-ui", "sans-serif"],
        serif: ['"Shippori Mincho"', '"Hiragino Mincho ProN"', '"Yu Mincho"', "serif"],
      },
      boxShadow: {
        soft: "0 10px 30px -12px rgba(28, 28, 25, 0.25)",
        card: "0 1px 2px rgba(28,28,25,0.06), 0 8px 24px -12px rgba(28,28,25,0.18)",
      },
      keyframes: {
        pulseRing: { "0%": { transform: "scale(0.9)", opacity: "0.8" }, "100%": { transform: "scale(1.6)", opacity: "0" } },
        fadeUp: { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        blink: { "0%, 80%, 100%": { opacity: "0.2" }, "40%": { opacity: "1" } },
      },
      animation: {
        pulseRing: "pulseRing 1.6s ease-out infinite",
        fadeUp: "fadeUp 0.35s ease-out both",
        blink: "blink 1.2s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
