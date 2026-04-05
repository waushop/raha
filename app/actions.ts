"use server";

import { randomUUID } from "crypto";
import db from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function createExpense(formData: FormData) {
  const id = randomUUID();
  const category = formData.get("category") as string;
  const name = formData.get("name") as string;
  const amount = parseFloat(formData.get("amount") as string);
  const paid_by = formData.get("paid_by") as string;
  const siim_pct = parseInt(formData.get("siim_pct") as string);
  const month = formData.get("month") as string;

  await db.execute(
    "INSERT INTO EXPENSES (ID, CATEGORY, NAME, AMOUNT, PAID_BY, SIIM_PCT, MONTH) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, category, name, amount, paid_by, siim_pct, month]
  );
  revalidatePath("/");
}

export async function updateExpense(id: string, formData: FormData) {
  const category = formData.get("category") as string;
  const name = formData.get("name") as string;
  const amount = parseFloat(formData.get("amount") as string);
  const paid_by = formData.get("paid_by") as string;
  const siim_pct = parseInt(formData.get("siim_pct") as string);

  await db.execute(
    "UPDATE EXPENSES SET CATEGORY=?, NAME=?, AMOUNT=?, PAID_BY=?, SIIM_PCT=? WHERE ID=? AND DELETED_AT IS NULL",
    [category, name, amount, paid_by, siim_pct, id]
  );
  revalidatePath("/");
}

export async function deleteExpense(id: string) {
  await db.execute(
    "UPDATE EXPENSES SET DELETED_AT=CURRENT_TIMESTAMP WHERE ID=? AND DELETED_AT IS NULL",
    [id]
  );
  revalidatePath("/");
}

export async function undoDeleteExpense(id: string) {
  await db.execute(
    "UPDATE EXPENSES SET DELETED_AT=NULL WHERE ID=?",
    [id]
  );
  revalidatePath("/");
}

export async function copyFromPreviousMonth(targetMonth: string) {
  const [y, m] = targetMonth.split("-").map(Number);
  const prevDate = new Date(y, m - 2, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  const [rows] = await db.execute(
    "SELECT CATEGORY, NAME, AMOUNT, PAID_BY, SIIM_PCT FROM EXPENSES WHERE MONTH = ? AND DELETED_AT IS NULL ORDER BY CREATED_AT",
    [prevMonth]
  ) as [Array<{ CATEGORY: string; NAME: string; AMOUNT: number; PAID_BY: string; SIIM_PCT: number }>, unknown];

  for (const row of rows) {
    await db.execute(
      "INSERT INTO EXPENSES (ID, CATEGORY, NAME, AMOUNT, PAID_BY, SIIM_PCT, MONTH) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [randomUUID(), row.CATEGORY, row.NAME, row.AMOUNT, row.PAID_BY, row.SIIM_PCT, targetMonth]
    );
  }

  revalidatePath("/");
  return rows.length;
}

export async function getRecentNames(category: string): Promise<{ NAME: string; AMOUNT: number }[]> {
  const [rows] = await db.execute(
    `SELECT NAME, CAST(MAX(AMOUNT) AS DOUBLE) AS AMOUNT FROM EXPENSES
     WHERE CATEGORY = ? AND DELETED_AT IS NULL
     GROUP BY NAME ORDER BY MAX(CREATED_AT) DESC LIMIT 15`,
    [category]
  );
  return rows as { NAME: string; AMOUNT: number }[];
}

export async function duplicateExpense(id: string, month: string) {
  const [rows] = await db.execute(
    "SELECT CATEGORY, NAME, AMOUNT, PAID_BY, SIIM_PCT FROM EXPENSES WHERE ID = ?",
    [id]
  ) as [Array<{ CATEGORY: string; NAME: string; AMOUNT: number; PAID_BY: string; SIIM_PCT: number }>, unknown];

  if (rows.length === 0) return;
  const row = rows[0];

  await db.execute(
    "INSERT INTO EXPENSES (ID, CATEGORY, NAME, AMOUNT, PAID_BY, SIIM_PCT, MONTH) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [randomUUID(), row.CATEGORY, row.NAME, row.AMOUNT, row.PAID_BY, row.SIIM_PCT, month]
  );
  revalidatePath("/");
}
