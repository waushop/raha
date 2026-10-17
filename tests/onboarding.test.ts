import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  GROUP_TEMPLATES, SUBSCRIPTION_PRESETS, groupsToCreate, monthlyIncome, onboardedKey, subscriptionsToCreate,
} from "@/lib/onboarding";
import { isIconName } from "@/lib/icon-names";
import { CATEGORY_KEYS, GROUP_COLORS } from "@/types/expense";

describe("group templates", () => {
  test("every template has a known icon and colour; Home/Car/Fun/Personal are preselected", () => {
    for (const t of GROUP_TEMPLATES) {
      assert.ok(isIconName(t.icon), t.icon);
      assert.ok((GROUP_COLORS as readonly string[]).includes(t.color), t.color);
    }
    assert.deepEqual(GROUP_TEMPLATES.filter((t) => t.preselected).map((t) => t.name), ["Home", "Car", "Fun", "Personal"]);
  });

  test("picked keys become rows in template order; unknown keys and duplicates are dropped", () => {
    const rows = groupsToCreate(["fun", "home", "nope", "home"], []);
    assert.deepEqual(rows, [
      { name: "Home", icon: "house", color: "blue" },
      { name: "Fun", icon: "party-popper", color: "purple" },
    ]);
  });

  test("names that already exist (any case) are skipped, so a re-run creates nothing", () => {
    assert.deepEqual(groupsToCreate(["home", "car"], [" home ", "CAR"]), []);
    assert.deepEqual(groupsToCreate(["home", "kids"], ["Home"]).map((r) => r.name), ["Kids"]);
  });
});

describe("subscription presets", () => {
  test("presets use valid categories and charge days", () => {
    for (const s of SUBSCRIPTION_PRESETS) {
      assert.ok(CATEGORY_KEYS.includes(s.category), s.category);
      assert.ok(s.day >= 1 && s.day <= 31);
      assert.ok(s.amount > 0);
    }
    assert.equal(new Set(SUBSCRIPTION_PRESETS.map((s) => s.key)).size, SUBSCRIPTION_PRESETS.length);
  });

  test("edited price/day are kept; existing names and unknown keys skipped", () => {
    const rows = subscriptionsToCreate(
      [{ key: "netflix", amount: 15.99, day: 12 }, { key: "spotify", amount: 11.99, day: null }, { key: "x", amount: 1, day: 1 }, { key: "netflix", amount: 1, day: 1 }],
      ["spotify premium"],
    );
    assert.deepEqual(rows, [{ name: "Netflix", category: "subscriptions", amount: 15.99, day: 12 }]);
  });
});

test("monthlyIncome converts cadences and ignores one-offs", () => {
  assert.equal(monthlyIncome([{ AMOUNT: 2000, CADENCE: "monthly" }, { AMOUNT: 120, CADENCE: "weekly" }, { AMOUNT: 500, CADENCE: "once" }]), 2520);
  assert.equal(monthlyIncome([]), 0);
});

test("onboardedKey is per workspace", () => {
  assert.equal(onboardedKey("ws-1"), "onboarded:ws-1");
});
