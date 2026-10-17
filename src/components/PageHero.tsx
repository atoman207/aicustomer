import Image from "next/image";
import type { SiteImage } from "@/lib/images";

export default function PageHero({
  image,
  eyebrow,
  title,
  description,
  children,
}: {
  image: SiteImage;
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="relative mb-8 overflow-hidden rounded-3xl shadow-soft">
      <div className="relative h-56 sm:h-64">
        <Image src={image.src} alt={image.alt} fill priority sizes="(max-width: 1152px) 100vw, 1152px" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-sumi-900/80 via-sumi-900/50 to-transparent" />
        <div className="absolute inset-0 flex flex-col justify-center px-6 sm:px-10">
          <p className="eyebrow text-washi-200">{eyebrow}</p>
          <h1 className="mt-2 font-serif text-2xl font-bold text-white sm:text-3xl">{title}</h1>
          <p className="mt-2 max-w-xl text-sm text-washi-100/90">{description}</p>
          {children ? <div className="mt-3 flex flex-wrap gap-2">{children}</div> : null}
        </div>
      </div>
    </section>
  );
}
