"use server";

import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import * as ledger from "@/lib/ledger";
import { attempt, type ActionResult } from "@/lib/action-result";
import { parseAmount, parseCategory, parseId, parseMonth, parseName, parseOptionalId, ValidationError } from "@/lib/validate";
import { PLAN_KINDS, type PlanKind } from "@/lib/plan";
import { addLine, addSubscriptionLines, buildFromAverages, copyPreviousPlan } from "@/lib/plan-db";

function revalidate() {
  revalidatePath("/plan");
  revalidatePath("/");
  revalidatePath("/dashboard");
}

function parseKind(v: unknown): PlanKind {
  const s = String(v ?? "expense");
  if (!(PLAN_KINDS as readonly string[]).includes(s)) throw new ValidationError("Unknown line kind");
  return s as PlanKind;
}

export async function addPlanLine(formData: FormData): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(() => {
    const month = parseMonth(formData.get("month"));
    const groupId = parseOptionalId(formData.get("group_id"), "Group");
    db.transaction((tx) => ledger.assertGroupExists(tx, ws, groupId));
    const planned = String(formData.get("planned") ?? "").trim() ? parseAmount(formData.get("planned"), "Planned") : 0;
    addLine(ws, month, {
      KIND: parseKind(formData.get("kind")),
      CATEGORY: parseCategory(formData.get("category")),
      GROUP_ID: groupId,
      LABEL: parseName(formData.get("label"), "Label", 60),
      PLANNED: planned,
      SUBSCRIPTION_ID: null,
    });
    revalidate();
    return {};
  });
}

export async function updatePlanLine(id: string, patch: { planned?: number; label?: string }): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const lid = parseId(id);
    if (patch.planned !== undefined) {
      const planned = patch.planned === 0 ? 0 : parseAmount(patch.planned, "Planned");
      await db.execute("UPDATE PLAN_LINE SET PLANNED=? WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL", [planned, lid, ws]);
    }
    if (patch.label !== undefined) {
      await db.execute("UPDATE PLAN_LINE SET LABEL=? WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL", [parseName(patch.label, "Label", 60), lid, ws]);
    }
    revalidate();
    return {};
  });
}

export async function deletePlanLine(id: string): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    await db.execute("UPDATE PLAN_LINE SET DELETED_AT=CURRENT_TIMESTAMP WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL", [parseId(id), ws]);
    revalidate();
    return {};
  });
}

export async function copyPlanFromPrevious(month: string): Promise<ActionResult<{ added: number }>> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(() => {
    const added = copyPreviousPlan(ws, parseMonth(month));
    revalidate();
    return { added };
  });
}

export async function buildPlanFromAverages(month: string): Promise<ActionResult<{ added: number }>> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(() => {
    const added = buildFromAverages(ws, parseMonth(month));
    revalidate();
    return { added };
  });
}

export async function addSubscriptionsToPlan(month: string): Promise<ActionResult<{ added: number }>> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(() => {
    const added = addSubscriptionLines(ws, parseMonth(month));
    revalidate();
    return { added };
  });
}
