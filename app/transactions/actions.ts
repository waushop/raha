"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { attempt, type ActionResult } from "@/lib/action-result";
import { parseId, ValidationError } from "@/lib/validate";
import * as ledger from "@/lib/ledger";

/** "Add to month": a bank line joins the month view next to the bills. */
export async function addToMonth(id: string): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(() => {
    if (!ledger.addToMonth(ws, parseId(id))) throw new ValidationError("That line is already in the month or gone");
    revalidatePath("/"); revalidatePath("/transactions"); revalidatePath("/activity");
    return {};
  });
}

/** Marks a feed line as a transfer (own accounts, a loan payout: not income or spending) or counts it again. */
export async function setTransfer(id: string, on: boolean): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(() => {
    if (!ledger.setTransfer(ws, parseId(id), !!on)) throw new ValidationError("Nothing to change on that line");
    revalidatePath("/"); revalidatePath("/transactions"); revalidatePath("/dashboard"); revalidatePath("/activity");
    return {};
  });
}
