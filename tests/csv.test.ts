import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { csvCell, toCsv, ledgerToCsv, LEDGER_CSV_HEADER } from "@/lib/csv";

describe("csv", () => {
  test("quotes only when needed and doubles embedded quotes", () => {
    assert.equal(csvCell("plain"), "plain");
    assert.equal(csvCell(12.5), "12.5");
    assert.equal(csvCell(null), "");
    assert.equal(csvCell("a,b"), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  });

  test("toCsv joins header and rows", () => {
    assert.equal(toCsv(["a", "b"], [[1, "x,y"], [null, "z"]]), 'a,b\n1,"x,y"\n,z');
  });

  test("ledger export keeps column order and appends Kind and Day", () => {
    const csv = ledgerToCsv([
      { MONTH: "2026-03", KIND: "expense", CATEGORY: "groceries", NAME: "Rimi, Kristiine", AMOUNT: 42.1, NOTES: null, IS_RECURRING: 0, CREATED_AT: "2026-03-02 10:00:00", GROUP_NAME: "Home", DAY: 2 },
      { MONTH: "2026-03", KIND: "income", CATEGORY: "other", NAME: "Salary", AMOUNT: 2500, NOTES: 'bonus "Q1"', IS_RECURRING: 1, CREATED_AT: "2026-03-01 09:00:00", GROUP_NAME: null, DAY: null },
    ]);
    const [header, r1, r2] = csv.split("\n");
    assert.equal(header, LEDGER_CSV_HEADER.join(","));
    assert.equal(header.split(",")[0], "Month");
    assert.equal(r1, '2026-03,Home,groceries,"Rimi, Kristiine",42.1,,No,2026-03-02 10:00:00,Expense,2');
    assert.equal(r2, '2026-03,,other,Salary,2500,"bonus ""Q1""",Yes,2026-03-01 09:00:00,Income,');
  });
});
