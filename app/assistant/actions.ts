"use server";

import { requireAuth } from "@/lib/auth";
import db from "@/lib/db";
import * as ledger from "@/lib/ledger";
import { applyRules, type Rule } from "@/lib/rules";
import { CATEGORY_KEYS, type CategoryKey } from "@/types/expense";
import { cleanMerchant } from "@/lib/merchants";
import { isoDate } from "@/lib/subscriptions";
import { ValidationError } from "@/lib/validate";
import { attempt, type ActionResult } from "@/lib/action-result";
import { AiError, ASK_LIMIT_PER_HOUR, SCAN_LIMIT_PER_HOUR, aiMode, createMessage, takeQuota, textOf } from "@/lib/claude";
import { ask, cleanHistory, type AskResult, type ChatTurn } from "@/lib/assistant";
import {
  MAX_RECEIPT_BYTES, RECEIPT_SCHEMA, RECEIPT_TYPES, ReceiptError, itemNotes, mockReceipt, sniffImageType, validateReceipt,
  type Receipt, type ReceiptScan,
} from "@/lib/receipt";

// AI failures and quota hits are user-facing messages, like validation errors.
async function guarded<T extends object>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  return attempt(async () => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AiError || e instanceof ReceiptError) throw new ValidationError(e.message);
      throw e;
    }
  });
}

const RECEIPT_SYSTEM = [
  "You read photos of shopping receipts and invoices and extract them as JSON matching the given schema. Output nothing else.",
  "- merchant: the shop or business name as printed (not the address).",
  "- total: the grand total actually paid, after discounts, as a number.",
  "- date: the purchase date as YYYY-MM-DD, or null when it isn't legible.",
  "- items: each purchased line with its final line amount (fold discounts into the line they apply to; skip subtotals, VAT lines, payment and change lines). At most 30; if there are more, keep the largest.",
  "- category for each item and suggestedCategory for the whole receipt: the best-fitting key from the enum (food from a shop is groceries, restaurant or cafe food is dining, toiletries and cosmetics are personal, cleaning and household goods are other).",
  "- confidence: 0 to 1, how sure you are of the total and the date.",
  "If the image is not a receipt, return total 0 and confidence 0.",
].join("\n");

/**
 * Reads a receipt photo (already downscaled in the browser) with Claude and
 * returns values for the add form. The image is only held in memory for the
 * request; nothing is stored or logged.
 */
export async function scanReceipt(formData: FormData): Promise<ActionResult<{ scan: ReceiptScan }>> {
  const { workspaceId: ws, userId } = await requireAuth();
  return guarded(async () => {
    if (aiMode() === "off") throw new AiError("Receipt scanning isn't set up on this server.");
    const file = formData.get("image");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Pick a photo of the receipt");
    if (file.size > MAX_RECEIPT_BYTES) throw new ValidationError("That photo is too large (max 5 MB)");
    if (!(RECEIPT_TYPES as readonly string[]).includes(file.type)) throw new ValidationError("Use a JPEG, PNG or WebP photo");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mediaType = sniffImageType(bytes);
    if (!mediaType) throw new ValidationError("That file isn't a readable image");
    if (!takeQuota(`scan:${userId}`, SCAN_LIMIT_PER_HOUR)) throw new AiError("That's a lot of receipts for one hour. Try again a bit later.");

    const today = isoDate(new Date());
    let receipt: Receipt;
    if (aiMode() === "mock") {
      receipt = mockReceipt(today);
    } else {
      const res = await createMessage({
        max_tokens: 4096,
        system: RECEIPT_SYSTEM,
        output_config: { effort: "medium", format: { type: "json_schema", schema: RECEIPT_SCHEMA } },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: Buffer.from(bytes).toString("base64") } },
            { type: "text", text: `Extract this receipt. Today is ${today}.` },
          ],
        }],
      });
      if (res.stop_reason === "max_tokens") throw new AiError("That receipt was too long to read. Try a closer photo.");
      let raw: unknown;
      try {
        raw = JSON.parse(textOf(res));
      } catch {
        throw new AiError("Couldn't read that receipt. Try a sharper photo.");
      }
      receipt = validateReceipt(raw, today);
    }
    return { scan: await applyWorkspaceRules(ws, receipt) };
  });
}

/** Merchant → name via cleanMerchant, then the workspace's rules for name/category/group/tags. */
async function applyWorkspaceRules(ws: string, r: Receipt): Promise<ReceiptScan> {
  const cleaned = cleanMerchant(r.merchant).slice(0, 120);
  const [rows] = await db.execute(`SELECT ${ledger.RULE_COLUMNS} FROM IMPORT_PATTERN WHERE WORKSPACE_ID = ? ORDER BY PRIORITY DESC, PATTERN`, [ws]);
  const rules = rows as Rule[];
  const hit = applyRules(rules, { text: r.merchant, amount: r.total }) ?? applyRules(rules, { text: cleaned, amount: r.total });
  // A rule is the user's own decision, so its category beats the model's guess.
  const category = hit && (CATEGORY_KEYS as string[]).includes(hit.category) ? (hit.category as CategoryKey) : r.suggestedCategory;
  let groupId: string | null = null;
  if (hit?.groupId) {
    const [g] = await db.execute("SELECT ID FROM CATEGORY_GROUP WHERE ID = ? AND WORKSPACE_ID = ? AND DELETED_AT IS NULL", [hit.groupId, ws]);
    groupId = (g as Array<{ ID: string }>)[0]?.ID ?? null;
  }
  return {
    ...r,
    name: (hit?.name ?? cleaned).slice(0, 120),
    category,
    groupId,
    tags: hit?.tags ? ledger.mergeTags(null, hit.tags) : null,
    notes: itemNotes(r.items),
  };
}

/** One answer from the "Ask your money" assistant. The conversation lives in the browser only. */
export async function askMoney(history: ChatTurn[]): Promise<ActionResult<AskResult>> {
  const { workspaceId, userId } = await requireAuth();
  return guarded(async () => {
    if (aiMode() === "off") throw new AiError("The assistant isn't set up on this server.");
    const turns = cleanHistory(history);
    if (!takeQuota(`ask:${userId}`, ASK_LIMIT_PER_HOUR)) throw new AiError(`You've asked ${ASK_LIMIT_PER_HOUR} questions in the last hour. Try again a bit later.`);
    return ask({ workspaceId, userId }, turns);
  });
}
