import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseSwedbankCSV, parseGenericCSV, classifyTransactions, detectCSVFormat, mapSourceCategory, parseMoney, parseDate,
} from "@/lib/import-parser";
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

const YNAB = [
  '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"',
  '"Checking","","10/03/2026","Rimi","Everyday Expenses: Groceries","Everyday Expenses","Groceries","weekly shop","$42.10","$0.00","Cleared"',
  '"Checking","","10/05/2026","Employer","Inflow: Ready to Assign","Inflow","Ready to Assign","","$0.00","$2,500.00","Cleared"',
  '"Checking","","10/06/2026","Transfer : Savings","","","","","$300.00","$0.00","Cleared"',
  '"Checking","Red","10/07/2026","Landlord","Bills: Rent/Mortgage","Bills","Rent/Mortgage","","$1,200.00","$0.00","Uncleared"',
].join("\n");

const EVERYDOLLAR = [
  "Date,Description,Amount,Budget Item",
  "2026-09-01,NETFLIX.COM 1234,-12.99,Streaming",
  "2026-09-02,Paycheck,2400.00,Paycheck",
  "2026-09-03,Shell Oil 5555,-55.20,Gas",
  "2026-09-04,Corner store,-3.00,Miscellaneous",
].join("\n");

const ROCKET = [
  "Date,Original Date,Account Type,Account Name,Account Number,Institution Name,Name,Custom Name,Amount,Description,Category,Note,Ignored From,Tax Deductible",
  "2026-08-02,2026-08-01,Credit Card,Visa,1234,Chase,STARBUCKS #123,,5.75,STARBUCKS #123,Dining & Drinks,,,",
  "2026-08-03,2026-08-03,Checking,Main,9876,Chase,ACME PAYROLL,Salary,-3000.00,ACME PAYROLL,Income,,,",
  "2026-08-04,2026-08-04,Checking,Main,9876,Chase,Chewy,,40.00,Chewy,Pets,food,,",
  "2026-08-05,2026-08-05,Checking,Main,9876,Chase,Transfer,,500.00,Transfer,Internal Transfers,,,",
  "2026-08-06,2026-08-06,Checking,Main,9876,Chase,Hidden,,9.00,Hidden,Shopping,,everything,",
  "2026-08-07,2026-08-07,Checking,Main,9876,Chase,Refund Co,,-15.00,Refund Co,Shopping,,,",
].join("\n");

describe("other budgeting apps", () => {
  test("header sniffing picks the right format and leaves Swedbank/generic alone", () => {
    assert.equal(detectCSVFormat(YNAB), "ynab");
    assert.equal(detectCSVFormat(EVERYDOLLAR), "everydollar");
    assert.equal(detectCSVFormat(ROCKET), "rocketmoney");
    assert.equal(detectCSVFormat(SWEDBANK), "swedbank");
    assert.equal(detectCSVFormat("Date,Name,Amount\n2026-01-05,Coffee,-3"), "generic");
    assert.equal(detectCSVFormat("\uFEFF" + EVERYDOLLAR), "everydollar");
  });

  test("YNAB: outflow = expense, inflow = income, transfers skipped, US dates", () => {
    const rows = parseGenericCSV(YNAB);
    assert.deepEqual(rows.map((r) => [r.merchant, r.amount, r.isIncome, r.date, r.category, r.confidence]), [
      ["Rimi", 42.1, false, "2026-10-03", "groceries", "source"],
      ["Employer", 2500, true, "2026-10-05", "other", "none"],
      ["Landlord", 1200, false, "2026-10-07", "housing", "source"],
    ]);
    assert.equal(rows[0].description, "Rimi — weekly shop");
  });

  test("EveryDollar: negative = expense, positive = income", () => {
    const rows = parseGenericCSV(EVERYDOLLAR);
    assert.deepEqual(rows.map((r) => [r.amount, r.isIncome, r.category, r.month]), [
      [12.99, false, "subscriptions", "2026-09"],
      [2400, true, "other", "2026-09"],
      [55.2, false, "fuel", "2026-09"],
      [3, false, "other", "2026-09"],
    ]);
    assert.equal(rows[0].merchant, "Netflix.com");
  });

  test("Rocket Money: positive = expense, negative or Income category = income; ignored and transfers skipped", () => {
    const rows = parseGenericCSV(ROCKET);
    assert.deepEqual(rows.map((r) => [r.description, r.amount, r.isIncome, r.category]), [
      ["STARBUCKS #123", 5.75, false, "dining"],
      ["Salary", 3000, true, "other"],
      ["Chewy — food", 40, false, "pets"],
      ["Refund Co", 15, true, "other"],
    ]);
  });

  test("an app's own category beats keyword guesses, but user rules still win", () => {
    const rows = parseGenericCSV(EVERYDOLLAR);
    const out = classifyTransactions(rows, []);
    assert.equal(out[0].category, "subscriptions");
    assert.equal(out[0].confidence, "source");
    const ruled = classifyTransactions(rows, [rule({ ID: "r", PATTERN: "netflix", CATEGORY: "entertainment" })]);
    assert.equal(ruled[0].category, "entertainment");
    assert.equal(ruled[0].confidence, "pattern");
  });

  test("category keyword table", () => {
    const cases: [string, string][] = [
      ["Groceries", "groceries"], ["Restaurants", "dining"], ["Gas & Fuel", "fuel"], ["Mortgage", "housing"],
      ["Utilities", "utilities"], ["Auto Insurance", "insurance"], ["Medical", "health"], ["Streaming", "subscriptions"],
      ["Cell Phone", "phone"], ["Internet", "internet"], ["Travel & Vacation", "travel"], ["Clothing", "clothing"],
      ["Entertainment", "entertainment"], ["Childcare", "kids"], ["Pet Food", "pets"], ["Gifts", "gifts"],
      ["Education", "education"], ["Auto & Transport", "transport"], ["Savings", "savings"], ["Student Loan", "loan"],
      ["Taxes", "tax"], ["Miscellaneous", "other"], ["", "other"],
    ];
    for (const [label, key] of cases) assert.equal(mapSourceCategory(label), key, label);
  });

  test("money and date parsing", () => {
    assert.equal(parseMoney("$1,234.56"), 1234.56);
    assert.equal(parseMoney("(12.00)"), -12);
    assert.equal(parseMoney("-3,50"), -3.5);
    assert.equal(parseMoney("1 234,50 €"), 1234.5);
    assert.ok(Number.isNaN(parseMoney("")));
    assert.equal(parseDate("2026-10-03"), "2026-10-03");
    assert.equal(parseDate("10/03/2026"), "2026-10-03");
    assert.equal(parseDate("1/2/26"), "2026-01-02");
    assert.equal(parseDate("03.10.2026"), "2026-10-03");
    assert.equal(parseDate("13/40/2026"), null);
  });
});

describe("slash date order", () => {
  test("detects day-first files and parses accordingly", async () => {
    const { detectSlashOrder, parseDate } = await import("@/lib/import-parser");
    assert.equal(detectSlashOrder(["05/10/2026", "25/10/2026"], "mdy"), "dmy");
    assert.equal(detectSlashOrder(["10/25/2026"], "dmy"), "mdy");
    assert.equal(detectSlashOrder(["05/10/2026"], "dmy"), "dmy");
    assert.equal(parseDate("05/10/2026", "dmy"), "2026-10-05");
    assert.equal(parseDate("05/10/2026", "mdy"), "2026-05-10");
  });
});
