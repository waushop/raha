// Turns bank statement descriptions into merchant names a human would type:
// "CIRCLE K TALLINN 1234 EE 17.10.2026" → "Circle K". Pure, heuristic, safe
// to run on anything (it never returns an empty string).

const NOISE = [
  /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g,           // dates
  /\b\d{2}:\d{2}(:\d{2})?\b/g,                       // times
  /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,               // IBANs
  /\*{2,}\d+|\b\d{4}\*{2,}\d{2,4}\b/g,               // masked card numbers
  /\b(EE|FI|LV|LT|SE|DE|NL|GB|US|IE|LU|FR|ES|IT|PL)\b\s*$/i, // trailing country code
  /\b(EUR|USD|GBP|SEK)\b/gi,
  /\b(kaardimakse|card payment|purchase|ostutehing|makse|payment|pos|chip|contactless|apple pay|google pay)\b/gi,
  /\b\d{3,}\b/g,                                     // long numbers (shop ids, receipts)
  /[#№]\s*\d+/g,
  /\s{2,}/g,
];

const CITIES = /\b(tallinn|tartu|p[aä]rnu|narva|viljandi|rakvere|haapsalu|kuressaare|j[oõ]hvi|maardu|keila|saue|helsinki|riga|vilnius|stockholm|london)\b/gi;

const SMALL = new Set(["and", "of", "the", "ja", "de", "la", "le"]);

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((w, i) => {
      if (!w) return w;
      if (i > 0 && SMALL.has(w)) return w;
      if (/^[a-z]&[a-z]$/.test(w)) return w.toUpperCase();          // h&m
      if (w.length <= 2 && i > 0) return w.toUpperCase();            // circle K, s24
      return w[0].toUpperCase() + w.slice(1);
    })
    .join(" ");
}

export function cleanMerchant(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  // keep only the beneficiary part when the description has " — details"
  s = s.split(" — ")[0];
  for (const re of NOISE) s = s.replace(re, " ");
  s = s.replace(CITIES, " ");
  s = s.replace(/[|/\\_,;:]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return raw.trim() || "Unknown";
  const cased = /[a-z]/.test(s) && /[A-Z]/.test(s) ? s : titleCase(s);
  return cased.length > 60 ? cased.slice(0, 60).trim() : cased;
}
