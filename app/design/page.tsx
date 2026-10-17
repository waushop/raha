import { Inter_Tight, Permanent_Marker, Rubik_Spray_Paint, Sedgwick_Ave_Display, Sora, Space_Grotesk, Syne, Unbounded } from "next/font/google";
import DesignPreview from "@/components/DesignPreview";

// Design exploration for the leather + glass look. Not linked from the
// navigation; open /design directly (phone and desktop).
const sora = Sora({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-lux-sora" });
const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-lux-grotesk" });
const unbounded = Unbounded({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-lux-unbounded" });
const syne = Syne({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-lux-syne" });
const tag = Sedgwick_Ave_Display({ subsets: ["latin"], weight: "400", variable: "--font-lux-tag" });
const spray = Rubik_Spray_Paint({ subsets: ["latin"], weight: "400", variable: "--font-lux-spray" });
const marker = Permanent_Marker({ subsets: ["latin"], weight: "400", variable: "--font-lux-marker" });
const sans = Inter_Tight({ subsets: ["latin"], weight: ["300", "400", "500", "600"], variable: "--font-lux-sans" });

export const metadata = { title: "Design preview · Empty Wallet" };

export default function DesignPage() {
  return (
    <div className={`${sora.variable} ${grotesk.variable} ${unbounded.variable} ${syne.variable} ${tag.variable} ${spray.variable} ${marker.variable} ${sans.variable}`}>
      <DesignPreview />
    </div>
  );
}
