import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseSwedbankCSV, parseGenericCSV, classifyTransactions } from "@/lib/import-parser";
import type { Rule } from "@/lib/rules";

const rule = (o: Partial<Rule> & { ID: string; PATTERN: string; CATEGORY: string }): Rule => ({
  GROUP_ID: null, PRIORITY: 0, SET_NAME: null, SET_TAGS: null, SET_RECURRING: null, AMOUNT_MIN: null, AMOUNT_MAX: null, ...o,
});

const SWEDBANK = [
  "Client account;Row type;Date;Beneficiary/Payer;Details;Amount;Currency;Debit/Credit;Reference;Type;RefNo;DocNo",
  "EE00;AS;01.03.2026;;Algsaldo;1000,00;EUR;K;;AS;;",
  "EE00;20;02.03.2026;RIMI EESTI FOOD AS;Kristiine;42,10;EUR;D;;MK;;1",
  "EE00;20;03.03.2026;Employer OÜ;Salary;2500,00;EUR;K;;MK;;2",
  "EE00;20;03.03.2026;CIRCLE K;Fuel hold;60,00;EUR;D;;K2;;3",
  "EE00;20;04.03.2026;Netflix;Monthly;12,99;EUR;D;;MK;;4",
  "EE00;LS;31.03.2026;;Lõppsaldo;3400,00;EUR;K;;LS;;",
].join("\n");

describe("parseSwedbankCSV", () => {
  test("skips balance rows and card holds, keeps direction and month", () => {
    const rows = parseSwedbankCSV(SWEDBANK);
    assert.deepEqual(rows.map((r) => [r.description, r.amount, r.isIncome, r.month, r.date]), [
      ["RIMI EESTI FOOD AS — Kristiine", 42.1, false, "2026-03", "2026-03-02"],
      ["Employer OÜ — Salary", 2500, true, "2026-03", "2026-03-03"],
      ["Netflix — Monthly", 12.99, false, "2026-03", "2026-03-04"],
    ]);
  });

  test("parseGenericCSV auto-detects the Swedbank header", () => {
    assert.equal(parseGenericCSV(SWEDBANK).length, 3);
  });
});

describe("parseGenericCSV (simple Date,Name,Amount)", () => {
  test("handles comma and semicolon separators, negative = expense", () => {
    const csv = "Date,Name,Amount\n2026-01-05,\"Coffee, large\",-3.50\n20260106,Refund,10\nbad-row";
    const rows = parseGenericCSV(csv);
    assert.deepEqual(rows.map((r) => [r.description, r.amount, r.isIncome, r.month]), [
      ["Coffee, large", 3.5, false, "2026-01"],
      ["Refund", 10, true, "2026-01"],
    ]);
    const semi = parseGenericCSV("Date;Name;Amount\n05.01.2026;Bus;-2,00");
    assert.equal(semi[0].amount, 2);
    assert.equal(semi[0].month, "2026-01");
  });
});

describe("classifyTransactions", () => {
  const tx = parseSwedbankCSV(SWEDBANK);

  test("user patterns win over built-in guesses and respect priority", () => {
    const out = classifyTransactions(tx, [
      rule({ ID: "p1", PATTERN: "rimi", CATEGORY: "dining" }),
      rule({ ID: "p2", PATTERN: "^RIMI", CATEGORY: "groceries", PRIORITY: 10 }),
    ]);
    assert.equal(out[0].category, "groceries");
    assert.equal(out[0].confidence, "pattern");
    assert.equal(out[0].patternId, "p2");
  });

  test("falls back to keyword guesses, then 'other'", () => {
    const out = classifyTransactions(tx, []);
    assert.deepEqual(out.map((r) => [r.category, r.confidence]), [
      ["groceries", "guess"],
      ["other", "none"],
      ["subscriptions", "guess"],
    ]);
  });

  test("an invalid regex pattern is treated as a plain substring", () => {
    const out = classifyTransactions(tx, [rule({ ID: "p", PATTERN: "netflix(", CATEGORY: "entertainment" })]);
    assert.equal(out[2].category, "subscriptions", "substring 'netflix(' does not occur, so guess applies");
    const out2 = classifyTransactions(tx, [rule({ ID: "p", PATTERN: "sala[ry", CATEGORY: "savings" })]);
    assert.equal(out2[1].category, "other");
  });

  test("a matching rule carries name, tags, recurring and group; amount range is honoured", () => {
    const out = classifyTransactions(tx, [
      rule({ ID: "r1", PATTERN: "netflix", CATEGORY: "subscriptions", GROUP_ID: "g1", SET_NAME: "Netflix", SET_TAGS: "#tv", SET_RECURRING: 1 }),
      rule({ ID: "r2", PATTERN: "rimi", CATEGORY: "household", AMOUNT_MIN: 100 }),
    ]);
    assert.equal(out[2].confidence, "pattern");
    assert.equal(out[2].patternId, "r1");
    assert.equal(out[2].groupId, "g1");
    assert.equal(out[2].name, "Netflix");
    assert.equal(out[2].tags, "#tv");
    assert.equal(out[2].isRecurring, true);
    // 42.10 is below the minimum, so the rule does not fire and the guess applies
    assert.equal(out[0].confidence, "guess");
    assert.equal(out[0].name, undefined);
  });

  test("every parsed transaction carries a cleaned merchant name", () => {
    assert.deepEqual(tx.map((r) => r.merchant), ["Rimi Eesti Food AS", "Employer OÜ", "Netflix"]);
    const simple = parseGenericCSV("Date,Name,Amount\n2026-01-05,CIRCLE K TALLINN 1234 EE 17.10.2026,-30");
    assert.equal(simple[0].merchant, "Circle K");
    assert.equal(simple[0].description, "CIRCLE K TALLINN 1234 EE 17.10.2026");
  });
});
