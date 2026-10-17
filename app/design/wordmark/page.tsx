import Link from "next/link";
import {
  Caveat_Brush, Covered_By_Your_Grace, Gloria_Hallelujah, Gochi_Hand, Kalam, Knewave, Mansalva,
  Nanum_Brush_Script, Permanent_Marker, Rock_Salt, Rubik_Wet_Paint, Sedgwick_Ave,
} from "next/font/google";

// Wordmark try-out: "Empty Wallet" in a dozen marker / graffiti hands, big,
// in the same chrome treatment the app uses. Open /design/wordmark.
const f1 = Mansalva({ subsets: ["latin"], weight: "400" });
const f2 = Caveat_Brush({ subsets: ["latin"], weight: "400" });
const f3 = Knewave({ subsets: ["latin"], weight: "400" });
const f4 = Rock_Salt({ subsets: ["latin"], weight: "400" });
const f5 = Nanum_Brush_Script({ subsets: ["latin"], weight: "400" });
const f6 = Gochi_Hand({ subsets: ["latin"], weight: "400" });
const f7 = Kalam({ subsets: ["latin"], weight: "700" });
const f8 = Covered_By_Your_Grace({ subsets: ["latin"], weight: "400" });
const f9 = Sedgwick_Ave({ subsets: ["latin"], weight: "400" });
const f10 = Permanent_Marker({ subsets: ["latin"], weight: "400" });
const f11 = Gloria_Hallelujah({ subsets: ["latin"], weight: "400" });
const f12 = Rubik_Wet_Paint({ subsets: ["latin"], weight: "400" });

const OPTIONS: Array<[string, string, string]> = [
  ["Mansalva", f1.className, "marker handwriting, casual"],
  ["Caveat Brush", f2.className, "brush marker, flowing"],
  ["Knewave", f3.className, "bold brush, street"],
  ["Rock Salt", f4.className, "scratchy marker"],
  ["Nanum Brush Script", f5.className, "fast brush strokes"],
  ["Gochi Hand", f6.className, "felt-tip, rounded"],
  ["Kalam Bold", f7.className, "clean marker print"],
  ["Covered By Your Grace", f8.className, "thin marker scrawl"],
  ["Sedgwick Ave", f9.className, "graffiti tag, readable"],
  ["Permanent Marker", f10.className, "current one, all-caps marker"],
  ["Gloria Hallelujah", f11.className, "comic marker"],
  ["Rubik Wet Paint", f12.className, "dripping paint"],
];

export const metadata = { title: "Wordmark options · Empty Wallet" };

export default function WordmarkPage() {
  return (
    <div className="lux fixed inset-0 z-[70] overflow-y-auto" data-glass="smoke">
      <div className="max-w-5xl mx-auto px-4 pb-16" style={{ paddingTop: "calc(var(--sat, 0px) + 1rem)" }}>
        <div className="flex items-center justify-between mb-6">
          <p className="text-xs uppercase tracking-[0.2em] lux-mute">Wordmark options · pick a number</p>
          <Link href="/design" className="text-xs lux-sub hover:text-white">← Design preview</Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {OPTIONS.map(([name, cls, note], i) => (
            <section key={name} className="glass glass-glint rounded-[24px] px-6 py-6">
              <div className="flex items-baseline justify-between mb-3">
                <span className="text-[11px] lux-mute tabular-nums">{String(i + 1).padStart(2, "0")} · {name}</span>
                <span className="text-[11px] lux-mute">{note}</span>
              </div>
              <p className={`${cls} text-5xl sm:text-6xl leading-tight bg-gradient-to-b from-white to-[#9c9ca5] bg-clip-text text-transparent`} style={{ filter: "drop-shadow(0 1px 0 rgba(0,0,0,.6)) drop-shadow(0 0 16px rgba(255,255,255,.10))", paddingBottom: "0.1em" }}>
                Empty Wallet
              </p>
              <p className={`${cls} text-2xl mt-2 text-white/80`}>Empty Wallet</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
