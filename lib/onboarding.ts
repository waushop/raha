// First-run wizard (/welcome): templates and the pure helpers that turn the
// user's picks into rows. Database writes live in app/welcome/actions.ts.
import type { CategoryKey } from "@/types/expense";
import type { IconName } from "./icon-names";
import type { PaydayCadence } from "./cashflow";

export type GroupTemplate = { key: string; name: string; icon: IconName; color: string; preselected: boolean };

export const GROUP_TEMPLATES: readonly GroupTemplate[] = [
  { key: "home", name: "Home", icon: "house", color: "blue", preselected: true },
  { key: "car", name: "Car", icon: "car", color: "orange", preselected: true },
  { key: "kids", name: "Kids", icon: "baby", color: "pink", preselected: false },
  { key: "fun", name: "Fun", icon: "party-popper", color: "purple", preselected: true },
  { key: "personal", name: "Personal", icon: "user-round", color: "teal", preselected: true },
  { key: "pets", name: "Pets", icon: "paw-print", color: "amber", preselected: false },
  { key: "health", name: "Health", icon: "heart", color: "red", preselected: false },
  { key: "travel", name: "Travel", icon: "plane", color: "cyan", preselected: false },
];

export type SubscriptionPreset = { key: string; name: string; amount: number; category: CategoryKey; day: number };

export const SUBSCRIPTION_PRESETS: readonly SubscriptionPreset[] = [
  { key: "telia-internet", name: "Telia internet", amount: 29.9, category: "internet", day: 5 },
  { key: "elisa-mobile", name: "Elisa mobile", amount: 15.99, category: "phone", day: 5 },
  { key: "tele2-mobile", name: "Tele2 mobile", amount: 12.99, category: "phone", day: 5 },
  { key: "netflix", name: "Netflix", amount: 12.99, category: "subscriptions", day: 1 },
  { key: "spotify", name: "Spotify Premium", amount: 11.99, category: "subscriptions", day: 1 },
  { key: "spotify-family", name: "Spotify Family", amount: 17.99, category: "subscriptions", day: 1 },
  { key: "youtube", name: "YouTube Premium", amount: 13.99, category: "subscriptions", day: 1 },
  { key: "disney", name: "Disney+", amount: 9.99, category: "subscriptions", day: 1 },
  { key: "hbo", name: "HBO Max", amount: 9.99, category: "subscriptions", day: 1 },
  { key: "icloud", name: "iCloud+", amount: 2.99, category: "subscriptions", day: 1 },
  { key: "google-one", name: "Google One", amount: 1.99, category: "subscriptions", day: 1 },
  { key: "bolt-plus", name: "Bolt Plus", amount: 4.99, category: "subscriptions", day: 1 },
  { key: "wolt-plus", name: "Wolt+", amount: 9.99, category: "subscriptions", day: 1 },
  { key: "chatgpt", name: "ChatGPT Plus", amount: 20, category: "subscriptions", day: 1 },
  { key: "apple-one", name: "Apple One", amount: 19.95, category: "subscriptions", day: 1 },
  { key: "gym", name: "Gym", amount: 39, category: "sports", day: 1 },
  { key: "kindergarten", name: "Kindergarten", amount: 85, category: "education", day: 10 },
];

/** APP_SETTING name holding the ISO date the workspace finished (or skipped) the wizard. */
export function onboardedKey(workspaceId: string): string {
  return `onboarded:${workspaceId}`;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Picked template keys → CATEGORY_GROUP rows to insert. Unknown keys are
 * ignored, and names already present (case-insensitive) are skipped, so
 * running the step twice creates nothing new.
 */
export function groupsToCreate(pickedKeys: readonly string[], existingNames: readonly string[]): Array<{ name: string; icon: IconName; color: string }> {
  const seen = new Set(existingNames.map(norm));
  const picked = new Set(pickedKeys);
  const out: Array<{ name: string; icon: IconName; color: string }> = [];
  for (const t of GROUP_TEMPLATES) {
    if (!picked.has(t.key) || seen.has(norm(t.name))) continue;
    seen.add(norm(t.name));
    out.push({ name: t.name, icon: t.icon, color: t.color });
  }
  return out;
}

export type SubscriptionPick = { key: string; amount: number; day: number | null };

/**
 * Picked presets (with the user's edited price and day) → SUBSCRIPTION rows
 * to insert, skipping unknown keys and names that already exist.
 */
export function subscriptionsToCreate(
  picks: readonly SubscriptionPick[], existingNames: readonly string[],
): Array<{ name: string; category: CategoryKey; amount: number; day: number | null }> {
  const seen = new Set(existingNames.map(norm));
  const out: Array<{ name: string; category: CategoryKey; amount: number; day: number | null }> = [];
  for (const p of picks) {
    const preset = SUBSCRIPTION_PRESETS.find((s) => s.key === p.key);
    if (!preset || seen.has(norm(preset.name))) continue;
    seen.add(norm(preset.name));
    out.push({ name: preset.name, category: preset.category, amount: p.amount, day: p.day });
  }
  return out;
}

/** Typical monthly income from the paydays (weekly 52/12, biweekly 26/12; one-offs ignored). */
export function monthlyIncome(paydays: ReadonlyArray<{ AMOUNT: number; CADENCE: PaydayCadence }>): number {
  const factor: Record<PaydayCadence, number> = { monthly: 1, biweekly: 26 / 12, weekly: 52 / 12, once: 0 };
  return Math.round(paydays.reduce((sum, p) => sum + p.AMOUNT * factor[p.CADENCE], 0) * 100) / 100;
}
