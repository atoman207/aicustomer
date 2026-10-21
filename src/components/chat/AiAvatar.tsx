// AI 相談員の顔（一畳屋のロゴマーク）
export default function AiAvatar({ size = "h-9 w-9", ring = true }: { size?: string; ring?: boolean }) {
  return (
    <span className={`grid ${size} shrink-0 place-items-center rounded-full bg-white ${ring ? "border-2 border-ichi-green" : ""}`}>
      <img src="/ichijoya/logo-symbol.svg" alt="" className="w-[62%]" />
    </span>
  );
}
