import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.DB_PATH = ":memory:";

describe("households", () => {
  let db: typeof import("@/lib/db").default;
  let household: typeof import("@/lib/household");
  let ledger: typeof import("@/lib/ledger");
  const a = randomUUID(), b = randomUUID(), outsider = randomUUID();

  before(async () => {
    db = (await import("@/lib/db")).default;
    household = await import("@/lib/household");
    ledger = await import("@/lib/ledger");
    for (const [id, name] of [[a, "Siim"], [b, "Mari"], [outsider, "Guest"]]) {
      await db.execute("INSERT INTO USER (ID, NAME, PIN_HASH, IS_ADMIN) VALUES (?, ?, 'x', 0)", [id, name]);
    }
  });

  test("createShared adds the owner and members once; listWorkspacesFor sees it", async () => {
    const ws = household.createShared("Home", a, [b, b, a]);
    const members = await household.listMembers(ws);
    assert.deepEqual(members.map((m) => [m.NAME, m.ROLE]), [["Siim", "owner"], ["Mari", "member"]]);
    assert.ok(await household.isMember(b, ws));
    assert.equal(await household.isMember(outsider, ws), false);
    const list = await household.listWorkspacesFor(b);
    assert.equal(list.find((w) => w.ID === ws)?.MEMBERS, 2);
  });

  test("payers must be members, and settlement splits expenses by PAID_BY", async () => {
    const ws = household.createShared("Flat", a, [b]);
    db.transaction((tx) => {
      assert.throws(() => ledger.assertMember(tx, ws, outsider), /not in this household/);
      const base = { KIND: "expense" as const, CATEGORY: "groceries", GROUP_ID: null, NOTES: null, IS_RECURRING: 0, TAGS: null, DAY: null };
      ledger.insertRow(tx, ws, { ...base, NAME: "Rimi", AMOUNT: 120, PAID_BY: a }, "2026-10");
      ledger.insertRow(tx, ws, { ...base, NAME: "Selver", AMOUNT: 40, PAID_BY: b }, "2026-10");
      ledger.insertRow(tx, ws, { ...base, NAME: "Cash", AMOUNT: 10, PAID_BY: null }, "2026-10");
    });
    const s = await household.settlement(ws, "2026-10");
    assert.equal(s.total, 160);
    assert.equal(s.unassigned, 10);
    assert.deepEqual(s.transfers, [{ from: b, to: a, amount: 40 }]);
  });
});
