import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseSwedbankCSV, parseGenericCSV, classifyTransactions } from "@/lib/import-parser";

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
      { ID: "p1", PATTERN: "rimi", CATEGORY: "dining", GROUP_ID: null, PRIORITY: 0 },
      { ID: "p2", PATTERN: "^RIMI", CATEGORY: "groceries", GROUP_ID: null, PRIORITY: 10 },
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
    const out = classifyTransactions(tx, [{ ID: "p", PATTERN: "netflix(", CATEGORY: "entertainment", GROUP_ID: null, PRIORITY: 0 }]);
    assert.equal(out[2].category, "subscriptions", "substring 'netflix(' does not occur, so guess applies");
    const out2 = classifyTransactions(tx, [{ ID: "p", PATTERN: "sala[ry", CATEGORY: "savings", GROUP_ID: null, PRIORITY: 0 }]);
    assert.equal(out2[1].category, "other");
  });
});
