import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { predict, tokenize, train } from "@/lib/classifier";

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
    assert.deepEqual(tokenize("Rimi, Kristiine"), ["rimi", "kristiine"]);
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
});
