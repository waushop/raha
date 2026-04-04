export const CATEGORIES = [
  "kodu",
  "auto",
  "mootorratas",
  "lapsed",
  "teenused",
  "siim",
  "janne",
  "muu",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_META: Record<Category, { label: string; color: string; gradient: string; emoji: string }> = {
  kodu:        { label: "Kodu",        color: "text-blue-400",   gradient: "from-blue-500 to-blue-600",     emoji: "🏠" },
  auto:        { label: "Auto",        color: "text-orange-400", gradient: "from-orange-500 to-amber-500",  emoji: "🚗" },
  mootorratas: { label: "Mootorratas", color: "text-yellow-400", gradient: "from-yellow-500 to-yellow-600", emoji: "🏍️" },
  lapsed:      { label: "Lapsed",      color: "text-green-400",  gradient: "from-green-500 to-emerald-500", emoji: "👶" },
  teenused:    { label: "Teenused",    color: "text-red-400",    gradient: "from-red-500 to-rose-500",      emoji: "📱" },
  siim:        { label: "Siim",        color: "text-purple-400", gradient: "from-purple-500 to-violet-500", emoji: "👨" },
  janne:       { label: "Janne",       color: "text-pink-400",   gradient: "from-pink-500 to-rose-500",     emoji: "👩" },
  muu:         { label: "Muu",         color: "text-gray-400",   gradient: "from-gray-500 to-gray-600",     emoji: "📦" },
};

export type Expense = {
  ID: string;
  CREATED_AT: string;
  UPDATED_AT: string;
  DELETED_AT: string | null;
  CATEGORY: Category;
  NAME: string;
  AMOUNT: number;
  PAID_BY: "siim" | "janne";
  SIIM_PCT: number;
  MONTH: string;
};
