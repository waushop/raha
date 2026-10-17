// ============================================
// STANDARD CATEGORIES (predefined; glyphs live in components/CategoryIcon.tsx).
// Used for both expenses
// and income — pick the one that fits.
// ============================================
export const CATEGORIES = {
  housing:       { label: "Housing",         },
  utilities:     { label: "Utilities",       },
  groceries:     { label: "Groceries",       },
  dining:        { label: "Dining",          },
  fuel:          { label: "Fuel",            },
  transport:     { label: "Transport",       },
  maintenance:   { label: "Maintenance",     },
  insurance:     { label: "Insurance",       },
  health:        { label: "Health",          },
  education:     { label: "Education",       },
  kids:          { label: "Kids",            },
  entertainment: { label: "Entertainment",   },
  subscriptions: { label: "Subscriptions",   },
  clothing:      { label: "Clothing",        },
  gifts:         { label: "Gifts",           },
  travel:        { label: "Travel",          },
  personal:      { label: "Personal",        },
  pets:          { label: "Pets",            },
  savings:       { label: "Savings",         },
  sports:        { label: "Sports",          },
  phone:         { label: "Phone",           },
  internet:      { label: "Internet",        },
  loan:          { label: "Loan",            },
  tax:           { label: "Tax",             },
  other:         { label: "Other",           },
} as const;

export type CategoryKey = keyof typeof CATEGORIES;
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as CategoryKey[];

// ============================================
// CUSTOM CATEGORY GROUPS (user-created, stored in DB)
// ============================================
export type ExpenseGroup = {
  ID: string;
  NAME: string;
  ICON: string | null;
  COLOR: string;
  SORT_ORDER: number;
};

// Default group colors
export const GROUP_COLORS = [
  "blue", "purple", "pink", "red", "orange",
  "amber", "yellow", "green", "teal", "cyan",
] as const;

export const GROUP_COLOR_CLASSES: Record<string, { text: string; bg: string; border: string }> = {
  blue:   { text: "text-blue-400",   bg: "bg-blue-500",   border: "border-blue-500/20" },
  purple: { text: "text-purple-400", bg: "bg-purple-500", border: "border-purple-500/20" },
  pink:   { text: "text-pink-400",   bg: "bg-pink-500",   border: "border-pink-500/20" },
  red:    { text: "text-red-400",    bg: "bg-red-500",    border: "border-red-500/20" },
  orange: { text: "text-orange-400", bg: "bg-orange-500", border: "border-orange-500/20" },
  amber:  { text: "text-amber-400",  bg: "bg-amber-500",  border: "border-amber-500/20" },
  yellow: { text: "text-yellow-400", bg: "bg-yellow-500", border: "border-yellow-500/20" },
  green:  { text: "text-green-400",  bg: "bg-green-500",  border: "border-green-500/20" },
  teal:   { text: "text-teal-400",   bg: "bg-teal-500",   border: "border-teal-500/20" },
  cyan:   { text: "text-cyan-400",   bg: "bg-cyan-500",   border: "border-cyan-500/20" },
};

// ============================================
// LEDGER TYPE — both expenses and income live here, distinguished by KIND.
// ============================================
export type Kind = "expense" | "income";

export type Expense = {
  ID: string;
  CREATED_AT: string;
  UPDATED_AT: string;
  DELETED_AT: string | null;
  KIND: Kind;
  CATEGORY: CategoryKey;
  GROUP_ID: string | null;
  NAME: string;
  AMOUNT: number;
  MONTH: string;
  DAY: number | null;
  GOAL_ID: string | null;
  NOTES: string | null;
  IS_RECURRING: number;
  TAGS: string | null;
  /** Rows created by splitting one transaction share this id (the original row's). */
  SPLIT_GROUP?: string | null;
  PAID_BY?: string | null;
  // Joined fields
  GROUP_NAME?: string;
  GROUP_ICON?: string;
  GROUP_COLOR?: string;
};
