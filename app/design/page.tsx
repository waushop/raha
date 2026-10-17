import { Instrument_Serif, Inter_Tight } from "next/font/google";
import DesignPreview from "@/components/DesignPreview";

// Design exploration for the leather + glass makeover. Not linked from the
// navigation; open /design directly (phone and desktop).
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-lux-serif" });
const sans = Inter_Tight({ subsets: ["latin"], weight: ["300", "400", "500", "600"], variable: "--font-lux-sans" });

export const metadata = { title: "Design preview · Empty Wallet" };

export default function DesignPage() {
  return (
    <div className={`${serif.variable} ${sans.variable}`}>
      <DesignPreview />
    </div>
  );
}
