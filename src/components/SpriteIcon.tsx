// 一畳屋サイトのアイコンスプライト（/ichijoya/sprite.svg）を使うアイコン
export type SpriteId =
  | "i-line-square"
  | "i-facebook-square"
  | "i-instagram-square"
  | "i-arrow-right-circle"
  | "i-arrow-left-circle"
  | "i-arrow-down-circle"
  | "i-angle-right-large"
  | "i-mail"
  | "i-sound"
  | "i-pin"
  | "i-calendar";

export default function SpriteIcon({ id, size = 16, className = "" }: { id: SpriteId; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} className={className} fill="currentColor" aria-hidden focusable="false">
      <use href={`/ichijoya/sprite.svg#${id}`} />
    </svg>
  );
}
