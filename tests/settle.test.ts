import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { settleUp } from "@/lib/settle";

describe("settle up", () => {
  const members = [{ ID: "a", NAME: "Siim" }, { ID: "b", NAME: "Mari" }];
  test("equal share and a single transfer", () => {
    const s = settleUp(members, [{ userId: "a", amount: 300 }, { userId: "b", amount: 100 }, { userId: null, amount: 50 }]);
    assert.equal(s.total, 400);
    assert.equal(s.unassigned, 50);
    assert.deepEqual(s.members.map((m) => [m.name, m.paid, m.share, m.net]), [["Siim", 300, 200, 100], ["Mari", 100, 200, -100]]);
    assert.deepEqual(s.transfers, [{ from: "b", to: "a", amount: 100 }]);
  });
  test("three members, two transfers, cents handled", () => {
    const three = [...members, { ID: "c", NAME: "Kid" }];
    const s = settleUp(three, [{ userId: "a", amount: 100 }, { userId: "b", amount: 0.01 }, { userId: "c", amount: 0 }]);
    assert.equal(s.members[0].share, 33.34);
    assert.deepEqual(s.transfers, [{ from: "c", to: "a", amount: 33.34 }, { from: "b", to: "a", amount: 33.32 }]);
  });
  test("nobody owes anything when it is even", () => {
    assert.deepEqual(settleUp(members, [{ userId: "a", amount: 50 }, { userId: "b", amount: 50 }]).transfers, []);
    assert.deepEqual(settleUp([], []).members, []);
  });
});
