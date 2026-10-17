// Storage for per-user preferences (see lib/preferences.ts for the shape).
import db from "./db";
import { PREF_NAMES, prefKey, readPreferences, type Preferences } from "./preferences";

export async function getPreferences(userId: string): Promise<Preferences> {
  const keys = PREF_NAMES.map((name) => prefKey(userId, name));
  const [rows] = await db.execute(`SELECT NAME, VALUE FROM APP_SETTING WHERE NAME IN (${keys.map(() => "?").join(", ")})`, keys);
  const prefix = `pref:${userId}:`;
  const stored: Record<string, string> = {};
  for (const r of rows as Array<{ NAME: string; VALUE: string }>) stored[r.NAME.slice(prefix.length)] = r.VALUE;
  return readPreferences(stored);
}

export function savePreferencesFor(userId: string, prefs: Preferences): void {
  db.transaction((tx) => {
    for (const name of PREF_NAMES) {
      tx.run(
        "INSERT INTO APP_SETTING (NAME, VALUE) VALUES (?, ?) ON CONFLICT(NAME) DO UPDATE SET VALUE = excluded.VALUE",
        [prefKey(userId, name), String(prefs[name])],
      );
    }
  });
}
