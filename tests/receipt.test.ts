import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { canSplit, cleanDate, itemNotes, mockReceipt, sniffImageType, splitParts, validateReceipt, ReceiptError, MAX_RECEIPT_ITEMS } from "@/lib/receipt";

const TODAY = "2026-10-17";

describe("receipt validator", () => {
  const good = {
    merchant: "  RIMI   HAABERSTI ", total: 10.5, currency: "eur", date: "2026-10-16",
    items: [{ name: "Milk", amount: 4.5, category: "groceries" }, { name: "Soap", amount: 6, category: "personal" }],
    suggestedCategory: "groceries", confidence: 0.9,
  };

  test("accepts a consistent receipt", () => {
    const r = validateReceipt(good, TODAY);
    assert.equal(r.merchant, "RIMI HAABERSTI");
    assert.equal(r.currency, "EUR");
    assert.equal(r.date, "2026-10-16");
    assert.equal(r.itemsTotal, 10.5);
    assert.equal(r.check, false);
  });

  test("flags a total that is more than 1 % off the item sum", () => {
    assert.equal(validateReceipt({ ...good, total: 10.6 }, TODAY).check, false, "within 1 %");
    assert.equal(validateReceipt({ ...good, total: 12 }, TODAY).check, true);
    assert.equal(validateReceipt({ ...good, items: [] }, TODAY).check, true, "no items to compare");
    assert.equal(validateReceipt({ ...good, confidence: 0.3 }, TODAY).check, true, "low confidence");
  });

  test("drops non-finite items, unknown categories become other, caps items", () => {
    const r = validateReceipt({
      ...good,
      items: [{ name: "A", amount: Number.NaN, category: "groceries" }, { name: "B", amount: "3", category: "groceries" }, { name: "C", amount: 10.5, category: "beer" }],
    }, TODAY);
    assert.deepEqual(r.items, [{ name: "C", amount: 10.5, category: "other" }]);
    const many = validateReceipt({ ...good, items: Array.from({ length: 50 }, (_, i) => ({ name: `i${i}`, amount: 1, category: "groceries" })) }, TODAY);
    assert.equal(many.items.length, MAX_RECEIPT_ITEMS);
  });

  test("rejects a missing or non-positive total", () => {
    assert.throws(() => validateReceipt({ ...good, total: 0 }, TODAY), ReceiptError);
    assert.throws(() => validateReceipt({ ...good, total: Infinity }, TODAY), ReceiptError);
    assert.throws(() => validateReceipt("not json", TODAY), ReceiptError);
  });

  test("clamps confidence and falls back on bad fields", () => {
    const r = validateReceipt({ ...good, confidence: 7, currency: "euros", suggestedCategory: "?", merchant: "" }, TODAY);
    assert.equal(r.confidence, 1);
    assert.equal(r.currency, "EUR");
    assert.equal(r.suggestedCategory, "other");
    assert.equal(r.merchant, "Receipt");
  });

  test("dates must exist and be recent", () => {
    assert.equal(cleanDate("2026-02-30", TODAY), null);
    assert.equal(cleanDate("2026-10-19", TODAY), null, "future");
    assert.equal(cleanDate("2026-10-18", TODAY), "2026-10-18", "a day ahead is timezone slack");
    assert.equal(cleanDate("2020-01-01", TODAY), null, "too old");
    assert.equal(cleanDate("16.10.2026", TODAY), null);
    assert.equal(cleanDate(null, TODAY), null);
  });
});

describe("receipt split and notes", () => {
  const items = [
    { name: "Milk", amount: 1.29, category: "groceries" as const },
    { name: "Bread", amount: 2.18, category: "groceries" as const },
    { name: "Shampoo", amount: 5.3, category: "personal" as const },
  ];

  test("splitParts sums per category and adds up to the saved amount exactly", () => {
    assert.deepEqual(splitParts(items, 8.77), [{ category: "personal", amount: 5.3 }, { category: "groceries", amount: 3.47 }]);
    const corrected = splitParts(items, 9);
    assert.deepEqual(corrected, [{ category: "personal", amount: 5.53 }, { category: "groceries", amount: 3.47 }]);
    assert.equal(splitParts(items.slice(0, 2), 3.47), null, "one category is not a split");
    assert.equal(splitParts(items, 1), null, "a correction that wipes a part out");
  });

  test("splitParts folds categories beyond the part limit into the largest", () => {
    const parts = splitParts([...items, { name: "Gift", amount: 1, category: "gifts" }], 9.77, 2);
    assert.deepEqual(parts, [{ category: "personal", amount: 6.3 }, { category: "groceries", amount: 3.47 }]);
  });

  test("canSplit needs two categories and a consistent scan", () => {
    assert.equal(canSplit({ items, check: false }), true);
    assert.equal(canSplit({ items, check: true }), false);
    assert.equal(canSplit({ items: items.slice(0, 2), check: false }), false);
  });

  test("itemNotes lists items and truncates", () => {
    assert.equal(itemNotes(items), "Milk 1.29, Bread 2.18, Shampoo 5.30");
    assert.equal(itemNotes(items, 30), "Milk 1.29, Bread 2.18, …");
    assert.equal(itemNotes([]), null);
  });

  test("mock receipt is consistent and splittable", () => {
    const r = mockReceipt(TODAY);
    assert.equal(r.total, 23.47);
    assert.equal(r.check, false);
    assert.equal(canSplit(r), true);
    assert.equal(r.date, TODAY);
  });

  test("sniffImageType recognises real image headers only", () => {
    assert.equal(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
    assert.equal(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
    assert.equal(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
    assert.equal(sniffImageType(new TextEncoder().encode("<svg>")), null);
  });
});
