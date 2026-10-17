import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { pageWindow, type PageInfo } from "@/lib/pagination";

type Props = {
  info: PageInfo;
  /** Builds the href for a page, keeping the other query parameters. */
  href: (page: number) => string;
  /** Noun for the summary line, e.g. "results". */
  label?: string;
};

// Server-rendered pager: plain links, so it works without JS and the page
// number lives in the URL (shareable, back button works).
export default function Pagination({ info, href, label = "items" }: Props) {
  if (info.total === 0) return null;
  const btn = "min-w-9 h-9 px-2 rounded-xl flex items-center justify-center text-xs font-semibold tabular-nums transition-colors";
  return (
    <nav aria-label="Pagination" className="flex flex-col sm:flex-row items-center justify-between gap-3 py-2">
      <p className="text-[11px] text-[#5a6380] tabular-nums">
        {info.from}–{info.to} of {info.total} {label}
      </p>
      {info.pages > 1 && (
        <div className="flex items-center gap-1">
          {info.page > 1 ? (
            <Link href={href(info.page - 1)} aria-label="Previous page" className={`${btn} text-[#9ca3c0] hover:text-white hover:bg-white/5`}><ChevronLeft size={14} /></Link>
          ) : (
            <span className={`${btn} text-[#5a6380]/40`} aria-hidden><ChevronLeft size={14} /></span>
          )}
          {pageWindow(info.page, info.pages).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} className="px-1 text-[#5a6380] text-xs" aria-hidden>…</span>
            ) : p === info.page ? (
              <span key={p} aria-current="page" className={`${btn} card text-white`}>{p}</span>
            ) : (
              <Link key={p} href={href(p)} className={`${btn} text-[#9ca3c0] hover:text-white hover:bg-white/5`}>{p}</Link>
            ),
          )}
          {info.page < info.pages ? (
            <Link href={href(info.page + 1)} aria-label="Next page" className={`${btn} text-[#9ca3c0] hover:text-white hover:bg-white/5`}><ChevronRight size={14} /></Link>
          ) : (
            <span className={`${btn} text-[#5a6380]/40`} aria-hidden><ChevronRight size={14} /></span>
          )}
        </div>
      )}
    </nav>
  );
}

/** href builder that keeps every current query parameter and sets `page`. */
export function pageHref(path: string, params: Record<string, string | string[] | undefined>) {
  return (page: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === "page" || v === undefined) continue;
      for (const one of Array.isArray(v) ? v : [v]) if (one !== "") q.append(k, one);
    }
    if (page > 1) q.set("page", String(page));
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
}
