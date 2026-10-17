import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { pageInfo, pageWindow, parsePage } from "@/lib/pagination";
import { pageHref } from "@/components/Pagination";

describe("pagination", () => {
  test("parsePage accepts positive integers only", () => {
    assert.equal(parsePage("3"), 3);
    assert.equal(parsePage(undefined), 1);
    assert.equal(parsePage("0"), 1);
    assert.equal(parsePage("-2"), 1);
    assert.equal(parsePage("2.5"), 1);
    assert.equal(parsePage(["4", "5"]), 4);
  });
  test("pageInfo clamps and computes the visible range", () => {
    assert.deepEqual(pageInfo(120, 2, 50), { page: 2, pages: 3, size: 50, offset: 50, total: 120, from: 51, to: 100 });
    assert.deepEqual(pageInfo(120, 9, 50), { page: 3, pages: 3, size: 50, offset: 100, total: 120, from: 101, to: 120 });
    assert.deepEqual(pageInfo(0, 4, 50), { page: 1, pages: 1, size: 50, offset: 0, total: 0, from: 0, to: 0 });
  });
  test("pageWindow shows first, last and neighbours with gaps", () => {
    assert.deepEqual(pageWindow(1, 1), [1]);
    assert.deepEqual(pageWindow(5, 10), [1, null, 4, 5, 6, null, 10]);
    assert.deepEqual(pageWindow(2, 4), [1, 2, 3, 4]);
  });
  test("pageHref keeps other params and drops page 1", () => {
    const h = pageHref("/search", { q: "rimi", page: "3", kind: "expense", empty: "" });
    assert.equal(h(1), "/search?q=rimi&kind=expense");
    assert.equal(h(4), "/search?q=rimi&kind=expense&page=4");
  });
});
