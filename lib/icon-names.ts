// Curated Lucide icon names users can pick for groups and goals. Kept free
// of React imports so lib/schema.ts and tests can use the legacy map.
export const ICON_NAMES = [
  "house", "car", "bus", "bike", "fuel", "baby", "users", "user-round", "briefcase", "graduation-cap",
  "book-open", "hospital", "heart", "dumbbell", "volleyball", "paw-print", "dog", "cat", "plane", "tree-palm",
  "map", "globe", "camera", "drama", "music", "guitar", "gamepad-2", "tv", "laptop", "smartphone",
  "shopping-cart", "utensils", "coffee", "shirt", "gem", "gift", "party-popper", "sparkles", "star", "sun",
  "flower-2", "tree-pine", "wrench", "zap", "shield", "target", "piggy-bank", "wallet", "landmark", "receipt",
  "clipboard-list", "package",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export const DEFAULT_GROUP_ICON: IconName = "package";
export const DEFAULT_GOAL_ICON: IconName = "target";

export function isIconName(v: unknown): v is IconName {
  return typeof v === "string" && (ICON_NAMES as readonly string[]).includes(v);
}

// Emoji that older databases and backups stored in the EMOJI column, mapped
// to the nearest icon. Anything else becomes NULL (= default icon).
const EMOJI_TO_ICON: Record<string, IconName> = {
  "🏠": "house", "🏡": "house", "🚗": "car", "🚙": "car", "🚌": "bus", "🚲": "bike", "⛽": "fuel",
  "👶": "baby", "🧒": "baby", "👨‍👩‍👧": "users", "🙋": "user-round", "💼": "briefcase", "🎓": "graduation-cap",
  "📚": "book-open", "🏥": "hospital", "❤️": "heart", "💪": "dumbbell", "⚽": "volleyball", "🐕": "dog",
  "🐶": "dog", "🐈": "cat", "🐱": "cat", "✈️": "plane", "🏖️": "tree-palm", "🗺️": "map", "🌐": "globe",
  "📷": "camera", "🎭": "drama", "🎵": "music", "🎸": "guitar", "🎮": "gamepad-2", "📺": "tv", "💻": "laptop",
  "📱": "smartphone", "🛒": "shopping-cart", "🍽️": "utensils", "☕": "coffee", "👕": "shirt", "💍": "gem",
  "🎁": "gift", "🎉": "party-popper", "✨": "sparkles", "⭐": "star", "☀️": "sun", "🌸": "flower-2",
  "🌲": "tree-pine", "🔧": "wrench", "⚡": "zap", "🛡️": "shield", "🎯": "target", "💰": "piggy-bank",
  "👛": "wallet", "🏦": "landmark", "🧾": "receipt", "📋": "clipboard-list", "📦": "package",
};

export function iconFromLegacy(v: unknown): IconName | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (isIconName(s)) return s;
  return EMOJI_TO_ICON[s] ?? EMOJI_TO_ICON[s.replace(/️/g, "")] ?? null;
}
