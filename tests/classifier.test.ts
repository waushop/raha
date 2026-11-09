import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { predict, recall, tokenize, train } from "@/lib/classifier";
import { classifyTransactions, type ParsedTransaction } from "@/lib/import-parser";
import { cleanMerchant } from "@/lib/merchants";

describe("classifier", () => {
  const model = train([
    { name: "Rimi Kristiine", category: "groceries", groupId: "home" },
    { name: "Rimi Rocca al Mare", category: "groceries", groupId: "home" },
    { name: "Selver Torupilli", category: "groceries", groupId: "home" },
    { name: "Circle K Mustamäe", category: "fuel", groupId: "car" },
    { name: "Circle K Tartu mnt", category: "fuel", groupId: "car" },
    { name: "Netflix.com", category: "subscriptions", groupId: null },
    { name: "Apotheka", category: "health", groupId: null },
  ]);

  test("tokenize drops short, numeric and stop tokens", () => {
    assert.deepEqual(tokenize("Circle K 1234 Tallinn EE card"), ["circle"]);
    assert.deepEqual(tokenize("Rimi, Kristiine"), ["rimi"]);
    assert.deepEqual(tokenize("Bauhof Mustamäe"), ["bauhof"]);
  });

  test("predicts category and the usual group from seen tokens", () => {
    const p = predict(model, "RIMI EPood Tallinn");
    assert.equal(p?.category, "groceries");
    assert.equal(p?.groupId, "home");
    assert.ok(p!.confidence > 0.6);
    assert.equal(predict(model, "Circle K Pärnu")?.category, "fuel");
    assert.equal(predict(model, "NETFLIX.COM Amsterdam")?.category, "subscriptions");
  });

  test("stays silent on unknown descriptions", () => {
    assert.equal(predict(model, "Some brand new shop"), null);
    assert.equal(predict(train([]), "Rimi"), null);
  });

  test("groups come from the matched words, not from the category", () => {
    const m = train([
      { name: "Autoremont Kadaka", category: "maintenance", groupId: "car" },
      { name: "Autoremont Kadaka", category: "maintenance", groupId: "car" },
      { name: "Rehvitöökoda", category: "maintenance", groupId: "car" },
      { name: "Toruabi", category: "maintenance", groupId: null },
    ]);
    assert.equal(predict(m, "Autoremont")?.groupId, "car");
    const p = predict(m, "Toruabi Mustamäe");
    assert.equal(p?.category, "maintenance");
    assert.equal(p?.groupId, null);
  });

  test("recall returns what the same merchant had, when filed consistently", () => {
    const m = train([
      { name: "Bauhof", category: "maintenance", groupId: "home" },
      { name: "BAUHOF", category: "maintenance", groupId: "home" },
      { name: "Kiosk", category: "dining", groupId: null },
      { name: "Kiosk", category: "groceries", groupId: null },
    ]);
    assert.deepEqual(recall(m, "bauhof"), { category: "maintenance", groupId: "home", confidence: 1 });
    assert.equal(recall(m, "Kiosk"), null);
    assert.equal(recall(m, "Unknown"), null);
  });

  test("a known brand beats a fuzzy match on a shared town name", () => {
    const m = train([
      { name: "Circle K Mustamäe", category: "fuel", groupId: "car" },
      { name: "Circle K Mustamäe", category: "fuel", groupId: "car" },
    ]);
    const tx = (description: string): ParsedTransaction => ({
      date: "2026-11-01", month: "2026-11", description, amount: 40, currency: "EUR", isIncome: false,
      category: "other", confidence: "none", merchant: cleanMerchant(description),
    });
    const [bauhof, shop, circle] = classifyTransactions([tx("BAUHOF MUSTAMÄE"), tx("Pood Mustamäe"), tx("CIRCLE K PARNU")], [], m);
    assert.equal(bauhof.category, "maintenance");
    assert.equal(bauhof.groupId, undefined);
    assert.equal(shop.category, "other");
    assert.equal(circle.category, "fuel");
    assert.equal(circle.groupId, "car");
  });
});
