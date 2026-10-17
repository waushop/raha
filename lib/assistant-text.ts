// Turns the assistant's answer into plain-text and link segments for safe
// rendering (no HTML is ever injected). Only markdown links to relative
// in-app URLs ("/search?…", "/?month=…#e-…") become links; any other link is
// shown as its label in plain text. Client-safe and pure.

export type AnswerSegment = { type: "text"; text: string } | { type: "link"; text: string; href: string };

const LINK_RE = /\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/g;

/** A same-origin path: starts with one "/", no scheme, no backslashes, no whitespace or control characters. */
export function isRelativeHref(href: string): boolean {
  return /^\/(?![/\\])[^\s\\\u0000-\u001f]*$/.test(href);
}

const clean = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/`([^`]+)`/g, "$1");

export function parseAnswer(text: string): AnswerSegment[] {
  const out: AnswerSegment[] = [];
  const push = (s: string) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (last?.type === "text") last.text += s;
    else out.push({ type: "text", text: s });
  };
  let at = 0;
  for (const m of text.matchAll(LINK_RE)) {
    push(clean(text.slice(at, m.index)));
    const label = clean(m[1]);
    if (isRelativeHref(m[2])) out.push({ type: "link", text: label, href: m[2] });
    else push(label);
    at = m.index + m[0].length;
  }
  push(clean(text.slice(at)));
  return out;
}
