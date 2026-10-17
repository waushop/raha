"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { WORKSPACE_COOKIE, listUsers, requireAuth } from "@/lib/auth";
import { attempt, type ActionResult } from "@/lib/action-result";
import { parseId, parseName, ValidationError } from "@/lib/validate";
import { createShared, isMember, listMembers, listWorkspacesFor, type MemberRow, type WorkspaceRow } from "@/lib/household";

function revalidateAll() {
  for (const p of ["/", "/dashboard", "/settings", "/plan", "/subscriptions", "/cashflow", "/goals", "/groups", "/analytics", "/year", "/search", "/activity", "/review", "/networth", "/inbox"]) revalidatePath(p);
}

export async function myWorkspaces(): Promise<WorkspaceRow[]> {
  const { userId } = await requireAuth();
  return listWorkspacesFor(userId);
}

export async function householdMembers(): Promise<MemberRow[]> {
  const { workspaceId } = await requireAuth();
  return listMembers(workspaceId);
}

/** Everyone who could be invited (all live users except me). */
export async function invitableUsers(): Promise<Array<{ ID: string; NAME: string }>> {
  const { userId } = await requireAuth();
  return (await listUsers()).filter((u) => u.ID !== userId).map((u) => ({ ID: u.ID, NAME: u.NAME }));
}

export async function switchWorkspace(id: string): Promise<ActionResult> {
  const { userId } = await requireAuth();
  return attempt(async () => {
    const wsId = parseId(id);
    if (!(await isMember(userId, wsId))) throw new ValidationError("You are not a member of that ledger");
    const store = await cookies();
    store.set(WORKSPACE_COOKIE, wsId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
    revalidateAll();
    return {};
  });
}

export async function createHousehold(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const { userId } = await requireAuth();
  return attempt(async () => {
    const name = parseName(formData.get("name"), "Name", 40);
    const members = formData.getAll("members").map((m) => parseId(m, "Member"));
    const users = new Set((await listUsers()).map((u) => u.ID));
    for (const m of members) if (!users.has(m)) throw new ValidationError("Unknown member");
    const id = createShared(name, userId, members);
    const store = await cookies();
    store.set(WORKSPACE_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
    revalidateAll();
    return { id };
  });
}

async function requireOwner(workspaceId: string, userId: string): Promise<void> {
  const [rows] = await db.execute("SELECT ROLE FROM WORKSPACE_MEMBER WHERE WORKSPACE_ID = ? AND USER_ID = ?", [workspaceId, userId]);
  const [ws] = await db.execute("SELECT KIND FROM WORKSPACE WHERE ID = ?", [workspaceId]);
  if ((ws as { KIND: string }[])[0]?.KIND !== "shared") throw new ValidationError("Not a household");
  if ((rows as { ROLE: string }[])[0]?.ROLE !== "owner") throw new ValidationError("Only the household owner can do that");
}

export async function addMember(userId: string): Promise<ActionResult> {
  const { workspaceId, userId: me } = await requireAuth();
  return attempt(async () => {
    await requireOwner(workspaceId, me);
    const uid = parseId(userId, "Member");
    if (!(await listUsers()).some((u) => u.ID === uid)) throw new ValidationError("Unknown user");
    await db.execute("INSERT OR IGNORE INTO WORKSPACE_MEMBER (WORKSPACE_ID, USER_ID, ROLE) VALUES (?, ?, 'member')", [workspaceId, uid]);
    revalidateAll();
    return {};
  });
}

export async function removeMember(userId: string): Promise<ActionResult> {
  const { workspaceId, userId: me } = await requireAuth();
  return attempt(async () => {
    await requireOwner(workspaceId, me);
    const uid = parseId(userId, "Member");
    if (uid === me) throw new ValidationError("The owner cannot leave; delete the household instead");
    await db.execute("DELETE FROM WORKSPACE_MEMBER WHERE WORKSPACE_ID = ? AND USER_ID = ? AND ROLE <> 'owner'", [workspaceId, uid]);
    await db.execute("UPDATE PUSH_SUBSCRIPTION SET DELETED_AT = CURRENT_TIMESTAMP WHERE WORKSPACE_ID = ? AND USER_ID = ? AND DELETED_AT IS NULL", [workspaceId, uid]);
    revalidateAll();
    return {};
  });
}

export async function renameHousehold(name: string): Promise<ActionResult> {
  const { workspaceId, userId: me } = await requireAuth();
  return attempt(async () => {
    await requireOwner(workspaceId, me);
    await db.execute("UPDATE WORKSPACE SET NAME = ? WHERE ID = ? AND KIND = 'shared'", [parseName(name, "Name", 40), workspaceId]);
    revalidateAll();
    return {};
  });
}

/** Leaves a household you are a member (not owner) of and returns to your personal ledger. */
export async function leaveHousehold(): Promise<ActionResult> {
  const { workspaceId, userId: me, workspaceKind } = await requireAuth();
  return attempt(async () => {
    if (workspaceKind !== "shared") throw new ValidationError("Not a household");
    const [rows] = await db.execute("SELECT ROLE FROM WORKSPACE_MEMBER WHERE WORKSPACE_ID = ? AND USER_ID = ?", [workspaceId, me]);
    if ((rows as { ROLE: string }[])[0]?.ROLE === "owner") throw new ValidationError("The owner cannot leave; delete the household instead");
    await db.execute("DELETE FROM WORKSPACE_MEMBER WHERE WORKSPACE_ID = ? AND USER_ID = ?", [workspaceId, me]);
    await db.execute("UPDATE PUSH_SUBSCRIPTION SET DELETED_AT = CURRENT_TIMESTAMP WHERE WORKSPACE_ID = ? AND USER_ID = ? AND DELETED_AT IS NULL", [workspaceId, me]);
    (await cookies()).delete(WORKSPACE_COOKIE);
    revalidateAll();
    return {};
  });
}

/** Deletes an empty-ish household: its rows are soft-deleted, members detached. Owner only. */
export async function deleteHousehold(): Promise<ActionResult> {
  const { workspaceId, userId: me } = await requireAuth();
  return attempt(async () => {
    await requireOwner(workspaceId, me);
    db.transaction((tx) => {
      for (const t of ["LEDGER", "CATEGORY_GROUP", "SAVINGS_GOAL", "SUBSCRIPTION", "PLAN_LINE", "PAYDAY", "ACCOUNT", "PUSH_SUBSCRIPTION"]) {
        tx.run(`UPDATE ${t} SET DELETED_AT = CURRENT_TIMESTAMP WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL`, [workspaceId]);
      }
      // Configuration and derived rows have no soft delete; remove them with the household.
      for (const t of ["BUDGET", "BUDGET_HISTORY", "IMPORT_PATTERN", "NOTIFICATION", "BALANCE_CHECKPOINT", "ACCOUNT_SNAPSHOT"]) {
        tx.run(`DELETE FROM ${t} WHERE WORKSPACE_ID = ?`, [workspaceId]);
      }
      tx.run("DELETE FROM WORKSPACE_MEMBER WHERE WORKSPACE_ID = ?", [workspaceId]);
      tx.run("DELETE FROM WORKSPACE WHERE ID = ? AND KIND = 'shared'", [workspaceId]);
    });
    (await cookies()).delete(WORKSPACE_COOKIE);
    revalidateAll();
    return {};
  });
}
