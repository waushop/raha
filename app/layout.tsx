import type { Metadata, Viewport } from "next";
import { Caveat } from "next/font/google";
import { ToastProvider } from "@/components/Toast";
import KeyboardHints from "@/components/KeyboardHints";
import ScrollToTop from "@/components/ScrollToTop";
import { Suspense } from "react";
import Sidebar from "@/components/Sidebar";
import CommandPalette from "@/components/CommandPalette";
import BottomNav from "@/components/BottomNav";
import ServiceWorker from "@/components/ServiceWorker";
import "./globals.css";

// Self-hosted by next/font: no runtime request to Google, no layout shift.
// Headings reference it through the --font-hand CSS variable.
const caveat = Caveat({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-hand",
  display: "swap",
});

// Applies the saved theme before first paint so a light-mode user doesn't
// see a dark flash. Mirrors ThemeToggle, which owns the toggle itself.
const THEME_INIT = `try{if(localStorage.getItem("theme")==="light"){document.documentElement.setAttribute("data-theme","light");var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#f5f5f9")}}catch(e){}`;

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
  themeColor: "#1a1a2e",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: THEME_INIT may add data-theme before React hydrates.
    <html lang="en" className={caveat.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="bg-dark-mesh min-h-screen antialiased">
        <ToastProvider>
          {children}
          <Suspense><Sidebar /></Suspense>
          <Suspense><BottomNav /></Suspense>
          <KeyboardHints />
          <Suspense><CommandPalette /></Suspense>
          <ScrollToTop />
          <ServiceWorker />
        </ToastProvider>
      </body>
    </html>
  );
}
