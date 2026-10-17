"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { attempt, type ActionResult } from "@/lib/action-result";
import { parsePreferences, type Preferences } from "@/lib/preferences";
import { getPreferences, savePreferencesFor } from "@/lib/preferences-db";

export async function savePreferences(formData: FormData): Promise<ActionResult> {
  const { userId } = await requireAuth();
  return attempt(() => {
    savePreferencesFor(userId, parsePreferences(formData));
    // Sidebar, cash flow, dashboard and analytics all read these.
    revalidatePath("/", "layout");
    return {};
  });
}

/** The caller's preferences, for client components (the sidebar). */
export async function myPreferences(): Promise<Preferences> {
  const { userId } = await requireAuth();
  return getPreferences(userId);
}
