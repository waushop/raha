"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// router.push inside a transition that remembers where it is going. Callers
// mark the destination as selected at once (`pending`), the old page stays on
// screen until the new one is ready (pages whose query string changes in
// place have no loading.tsx, so there is no skeleton flash), and while the
// navigation runs <html data-nav-pending> drives the progress line and the
// soft dim in globals.css. When only the query string changes (another
// month, a search filter) <html data-nav-same> also fast-forwards the entrance
// animations of the remounted page, so cards don't fade in all over again.
const SAME_PAGE_SETTLE_MS = 1500;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

export function useNav() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [target, setTarget] = useState<string | null>(null);

  const go = useCallback((href: string, opts?: { replace?: boolean }) => {
    setTarget(href);
    const root = document.documentElement;
    clearTimeout(settleTimer);
    if (splitHref(href).path === window.location.pathname) root.dataset.navSame = "";
    else delete root.dataset.navSame;
    startTransition(() => {
      if (opts?.replace) router.replace(href);
      else router.push(href);
    });
  }, [router]);

  useEffect(() => {
    if (!isPending) return;
    const root = document.documentElement;
    root.dataset.navPending = "";
    return () => {
      delete root.dataset.navPending;
      // Runs at commit (or when the caller unmounts with the old page); the
      // timer outlives the component. Keep the flag until the new page's
      // entrance animations would have finished anyway.
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => { delete root.dataset.navSame; }, SAME_PAGE_SETTLE_MS);
    };
  }, [isPending]);

  return { go, pending: isPending ? target : null };
}

/** Path and query of an href like "/?month=2026-08". */
export function splitHref(href: string): { path: string; params: URLSearchParams } {
  const [path, query = ""] = href.split("?");
  return { path: path || "/", params: new URLSearchParams(query) };
}
