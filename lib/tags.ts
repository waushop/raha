// Tags are stored twice: the free-text TAGS column keeps what the user typed
// (normalised to "#a, #b"), and LEDGER_TAG holds one row per tag so search
// and analytics can filter and group without LIKE. Both are written together
// by lib/ledger.ts.
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 30;

export function parseTags(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  for (const raw of text.split(/[,\s]+/)) {
    const tag = raw.replace(/^#+/, "").trim().toLowerCase();
    if (tag) seen.add(tag);
  }
  return [...seen];
}

export function formatTags(tags: string[]): string | null {
  return tags.length ? tags.map((t) => `#${t}`).join(", ") : null;
}
