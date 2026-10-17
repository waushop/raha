// Page maths shared by server-rendered lists (search, activity, inbox) and the
// client-side import preview. Pure.
export type PageInfo = {
  page: number;      // 1-based, clamped to [1, pages]
  pages: number;     // at least 1
  size: number;
  offset: number;
  from: number;      // 1-based index of the first item shown (0 when empty)
  to: number;        // index of the last item shown
  total: number;
};

export function parsePage(v: string | string[] | null | undefined): number {
  const s = Array.isArray(v) ? v[0] : v;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 100000 ? n : 1;
}

export function pageInfo(total: number, requested: number, size: number): PageInfo {
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, requested), pages);
  const offset = (page - 1) * size;
  return { page, pages, size, offset, total, from: total === 0 ? 0 : offset + 1, to: Math.min(total, offset + size) };
}

/** Page numbers to show: first, last, current ±1, with null for gaps ("…"). */
export function pageWindow(page: number, pages: number): Array<number | null> {
  const want = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const sorted = [...want].sort((a, b) => a - b);
  const out: Array<number | null> = [];
  for (const p of sorted) {
    if (out.length && typeof out[out.length - 1] === "number" && p - (out[out.length - 1] as number) > 1) out.push(null);
    out.push(p);
  }
  return out;
}
