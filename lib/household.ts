// Shared workspaces ("households"): several users, one ledger, a payer per
// row. Database access only; the split maths lives in lib/settle.ts.
import { randomUUID } from "node:crypto";
import db from "./db";
import { settleUp, type Settlement } from "./settle";

export type WorkspaceRow = { ID: string; NAME: string; KIND: "personal" | "shared"; ROLE: string; MEMBERS: number };
export type MemberRow = { ID: string; NAME: string; ROLE: string };

export async function listWorkspacesFor(userId: string): Promise<WorkspaceRow[]> {
  const [rows] = await db.execute(
    `SELECT w.ID, w.NAME, w.KIND, m.ROLE, (SELECT COUNT(*) FROM WORKSPACE_MEMBER x JOIN USER u ON u.ID = x.USER_ID AND u.DELETED_AT IS NULL WHERE x.WORKSPACE_ID = w.ID) AS MEMBERS
     FROM WORKSPACE w JOIN WORKSPACE_MEMBER m ON m.WORKSPACE_ID = w.ID
     WHERE m.USER_ID = ? ORDER BY CASE w.KIND WHEN 'personal' THEN 0 ELSE 1 END, w.CREATED_AT`,
    [userId],
  );
  return rows as WorkspaceRow[];
}

export async function isMember(userId: string, workspaceId: string): Promise<boolean> {
  const [rows] = await db.execute("SELECT 1 FROM WORKSPACE_MEMBER WHERE WORKSPACE_ID = ? AND USER_ID = ?", [workspaceId, userId]);
  return (rows as unknown[]).length > 0;
}

export async function listMembers(workspaceId: string): Promise<MemberRow[]> {
  const [rows] = await db.execute(
    `SELECT u.ID, u.NAME, m.ROLE FROM WORKSPACE_MEMBER m JOIN USER u ON u.ID = m.USER_ID AND u.DELETED_AT IS NULL
     WHERE m.WORKSPACE_ID = ? ORDER BY m.ROLE = 'owner' DESC, u.SORT_ORDER, u.NAME`,
    [workspaceId],
  );
  return rows as MemberRow[];
}

export function createShared(name: string, ownerId: string, memberIds: string[]): string {
  const id = randomUUID();
  db.transaction((tx) => {
    tx.run("INSERT INTO WORKSPACE (ID, NAME, KIND) VALUES (?, ?, 'shared')", [id, name]);
    tx.run("INSERT INTO WORKSPACE_MEMBER (WORKSPACE_ID, USER_ID, ROLE) VALUES (?, ?, 'owner')", [id, ownerId]);
    for (const uid of new Set(memberIds)) {
      if (uid === ownerId) continue;
      tx.run("INSERT OR IGNORE INTO WORKSPACE_MEMBER (WORKSPACE_ID, USER_ID, ROLE) VALUES (?, ?, 'member')", [id, uid]);
    }
  });
  return id;
}

/** Spending by payer for the month, settled equally among members. */
export async function settlement(workspaceId: string, month: string): Promise<Settlement> {
  const members = await listMembers(workspaceId);
  const [rows] = await db.execute(
    "SELECT PAID_BY, CAST(SUM(AMOUNT) AS REAL) AS AMOUNT FROM LEDGER WHERE WORKSPACE_ID = ? AND MONTH = ? AND KIND = 'expense' AND DELETED_AT IS NULL GROUP BY PAID_BY",
    [workspaceId, month],
  );
  return settleUp(members.map((m) => ({ ID: m.ID, NAME: m.NAME })), (rows as { PAID_BY: string | null; AMOUNT: number }[]).map((r) => ({ userId: r.PAID_BY, amount: r.AMOUNT })));
}
