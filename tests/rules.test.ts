import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { applyRules, literalPattern, type Rule } from "@/lib/rules";
import { cleanMerchant } from "@/lib/merchants";
import { parseQuickAdd } from "@/lib/quickadd";

const rule = (o: Partial<Rule> & { ID: string; PATTERN: string }): Rule => ({
  CATEGORY: "groceries", GROUP_ID: null, PRIORITY: 0, SET_NAME: null, SET_TAGS: null, SET_RECURRING: null, AMOUNT_MIN: null, AMOUNT_MAX: null, ...o,
});

describe("rules", () => {
  test("highest priority wins; amount range filters; patch carries name/tags/recurring", () => {
    const rules = [
      rule({ ID: "a", PATTERN: "rimi", PRIORITY: 1, SET_NAME: "Rimi", SET_TAGS: "#food" }),
      rule({ ID: "b", PATTERN: "rimi", PRIORITY: 5, CATEGORY: "household", AMOUNT_MIN: 100 }),
      rule({ ID: "c", PATTERN: "^netflix", CATEGORY: "subscriptions", SET_RECURRING: 1, PRIORITY: 0 }),
    ];
    assert.deepEqual(applyRules(rules, { text: "RIMI TALLINN 123", amount: 20 }), { ruleId: "a", category: "groceries", groupId: null, name: "Rimi", tags: "#food" });
    assert.deepEqual(applyRules(rules, { text: "RIMI TALLINN 123", amount: 150 }), { ruleId: "b", category: "household", groupId: null });
    assert.deepEqual(applyRules(rules, { text: "Netflix.com", amount: 13 }), { ruleId: "c", category: "subscriptions", groupId: null, isRecurring: true });
    assert.equal(applyRules(rules, { text: "Selver", amount: 10 }), null);
  });
  test("an invalid regex falls back to a substring match and literalPattern escapes", () => {
    assert.ok(applyRules([rule({ ID: "x", PATTERN: "h&m (" })], { text: "H&M (Tallinn)", amount: 1 }));
    assert.equal(literalPattern("Circle K (24h)"), "Circle K \\(24h\\)");
  });
});

describe("merchant cleaning", () => {
  test("strips ids, dates, cities, country codes and title-cases", () => {
    assert.equal(cleanMerchant("CIRCLE K TALLINN 1234 EE 17.10.2026"), "Circle K");
    assert.equal(cleanMerchant("RIMI EESTI FOOD AS — kaardimakse 4123****1234"), "Rimi Eesti Food AS");
    assert.equal(cleanMerchant("Netflix.com"), "Netflix.com");
    assert.equal(cleanMerchant("H&M 0231 TARTU"), "H&M");
    assert.equal(cleanMerchant("   "), "Unknown");
  });
});

describe("quick add parser", () => {
  test("name, amount, tags and income sign", () => {
    assert.deepEqual(parseQuickAdd("coffee 3.5 #work"), { name: "coffee", amount: 3.5, kind: "expense", tags: "#work" });
    assert.deepEqual(parseQuickAdd("3,50 flat white"), { name: "flat white", amount: 3.5, kind: "expense", tags: null });
    assert.deepEqual(parseQuickAdd("+2850 salary"), { name: "salary", amount: 2850, kind: "income", tags: null });
    assert.deepEqual(parseQuickAdd("lunch 12€ #work #client"), { name: "lunch", amount: 12, kind: "expense", tags: "#work, #client" });
    assert.equal(parseQuickAdd("coffee"), null);
    assert.equal(parseQuickAdd("12"), null);
  });
});
