import type { Metadata, Viewport } from "next";
import { Inter_Tight, Sedgwick_Ave_Display, Sora } from "next/font/google";
import { ToastProvider } from "@/components/Toast";
import KeyboardHints from "@/components/KeyboardHints";
import ScrollToTop from "@/components/ScrollToTop";
import { Suspense } from "react";
import Sidebar from "@/components/Sidebar";
import CommandPalette from "@/components/CommandPalette";
import BottomNav from "@/components/BottomNav";
import ServiceWorker from "@/components/ServiceWorker";
import OfflineSync from "@/components/OfflineSync";
import "./globals.css";

// Self-hosted by next/font: no runtime request to Google, no layout shift.
// Headlines use Sora (geometric, futuristic) through --font-hand (the variable
// name predates the leather + glass makeover); body text uses Inter Tight
// through --font-ui.
const headline = Sora({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-hand",
  display: "swap",
});
// The "Empty Wallet" wordmark is a graffiti tag (--font-brand).
const brand = Sedgwick_Ave_Display({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-brand",
  display: "swap",
});
const ui = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ui",
  display: "swap",
});

// Applies the saved theme before first paint so a light-mode user doesn't
// see a dark flash. Mirrors ThemeToggle, which owns the toggle itself.
const THEME_INIT = `try{if(localStorage.getItem("theme")==="light"){document.documentElement.setAttribute("data-theme","light");var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#e7e5e1")}}catch(e){}`;

export const metadata: Metadata = {
  title: "Empty Wallet",
  description: "Personal expense tracker",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Empty Wallet",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#111112",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: THEME_INIT may add data-theme before React hydrates.
    <html lang="en" className={`${headline.variable} ${brand.variable} ${ui.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-screen antialiased">
        <ToastProvider>
          {children}
          <Suspense><Sidebar /></Suspense>
          <Suspense><BottomNav /></Suspense>
          <KeyboardHints />
          <Suspense><CommandPalette /></Suspense>
          <ScrollToTop />
          <ServiceWorker />
          <OfflineSync />
        </ToastProvider>
      </body>
    </html>
  );
}
