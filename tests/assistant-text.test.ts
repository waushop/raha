import { test, describe } from "node:test";
process.env.DB_PATH = ":memory:";
import assert from "node:assert/strict";
import { isRelativeHref, parseAnswer } from "@/lib/assistant-text";
import { takeQuota } from "@/lib/claude";
import { cleanHistory } from "@/lib/assistant";

describe("assistant answer rendering", () => {
  test("relative markdown links become links; everything else stays text", () => {
    assert.deepEqual(parseAnswer("You spent **12.00 €**. [See rows](/search?category=groceries&from=2026-01) or [Google](https://evil.example)."), [
      { type: "text", text: "You spent 12.00 €. " },
      { type: "link", text: "See rows", href: "/search?category=groceries&from=2026-01" },
      { type: "text", text: " or Google." },
    ]);
  });

  test("only same-origin paths count as relative", () => {
    assert.equal(isRelativeHref("/?month=2026-10#e-abc"), true);
    assert.equal(isRelativeHref("//evil.example/x"), false);
    assert.equal(isRelativeHref("/\\evil.example"), false);
    assert.equal(isRelativeHref("javascript:alert(1)"), false);
    assert.equal(isRelativeHref("https://x.y"), false);
    assert.equal(isRelativeHref("/a b"), false);
  });

  test("HTML in an answer is just text", () => {
    assert.deepEqual(parseAnswer("<img src=x onerror=alert(1)>"), [{ type: "text", text: "<img src=x onerror=alert(1)>" }]);
  });
});

describe("assistant limits", () => {
  test("takeQuota allows N per hour per key", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) assert.equal(takeQuota("t:user", 3, t0 + i), true);
    assert.equal(takeQuota("t:user", 3, t0 + 10), false);
    assert.equal(takeQuota("t:other", 3, t0 + 10), true, "per key");
    assert.equal(takeQuota("t:user", 3, t0 + 60 * 60_000 + 1), true, "window slides");
  });

  test("cleanHistory keeps recent alternating turns ending in a question", () => {
    const h = cleanHistory([{ role: "user", text: " a " }, { role: "user", text: "b" }, { role: "assistant", text: "c" }, { role: "user", text: "d" }]);
    assert.deepEqual(h, [{ role: "user", text: "a\n\nb" }, { role: "assistant", text: "c" }, { role: "user", text: "d" }]);
    assert.throws(() => cleanHistory([]));
    assert.throws(() => cleanHistory([{ role: "assistant", text: "hi" }]));
    assert.throws(() => cleanHistory([{ role: "system", text: "x" }]));
    assert.throws(() => cleanHistory([{ role: "user", text: "x".repeat(1001) }]));
    const long = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `t${i}` }));
    long.push({ role: "user", text: "last" });
    const kept = cleanHistory(long);
    assert.equal(kept[0].role, "user");
    assert.ok(kept.length <= 12);
    assert.equal(kept[kept.length - 1].text, "last");
  });
});
