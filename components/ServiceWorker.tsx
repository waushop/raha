"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function ServiceWorker() {
  const pathname = usePathname();

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // On the login page nobody is signed in on this browser any more: drop the
  // pages the service worker cached for offline use (they hold the previous
  // user's data). Static assets stay cached.
  useEffect(() => {
    if (pathname !== "/login" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.active?.postMessage({ type: "clear-pages" }))
      .catch(() => {});
  }, [pathname]);

  return null;
}
