import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseAddLink, prefillQuery } from "@/lib/add-link";

const q = (s: string) => new URLSearchParams(s);

describe("/add deep link", () => {
  test("complete link with every field", () => {
    const { prefill, complete } = parseAddLink(q("amount=12,5&name=%20Coffee%20&category=dining&tags=work%20%23team&kind=expense"));
    assert.equal(complete, true);
    assert.deepEqual(prefill, { name: "Coffee", amount: 12.5, category: "dining", tags: "#work, #team", kind: "expense" });
  });

  test("invalid values are dropped, not fatal", () => {
    const { prefill, complete } = parseAddLink(q("amount=-3&name=Taxi&category=nope&kind=refund"));
    assert.equal(complete, false);
    assert.deepEqual(prefill, { name: "Taxi" });
  });

  test("missing name or amount means prefill only", () => {
    assert.equal(parseAddLink(q("amount=5")).complete, false);
    assert.equal(parseAddLink(q("name=Bread")).complete, false);
    assert.equal(parseAddLink(q("")).complete, false);
    assert.equal(parseAddLink(q("amount=abc&name=x")).complete, false);
  });

  test("prefill query round-trips", () => {
    const { prefill } = parseAddLink(q("amount=4&name=Bread&kind=income"));
    const back = q(prefillQuery(prefill));
    assert.equal(back.get("add"), "1");
    assert.deepEqual(parseAddLink(back).prefill, prefill);
  });
});
