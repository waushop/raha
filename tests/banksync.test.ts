import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, verify } from "node:crypto";
import { categorize, daysLeft, mapTransaction, mapTransactions, maskIban, pickBalance, reconcile, syncWindowStart, type ExistingRow, type MappedTx } from "@/lib/banksync";
import { makeJwt, mockTransactions, normalizePem, isSessionGone, EnableBankingError, type BankTransaction } from "@/lib/enablebanking";
import { train } from "@/lib/classifier";
import type { Rule } from "@/lib/rules";

process.env.DB_PATH = ":memory:";

const btx = (o: Partial<BankTransaction> = {}): BankTransaction => ({
  entry_reference: "ref-1",
  transaction_id: null,
  transaction_amount: { currency: "EUR", amount: "12.34" },
  credit_debit_indicator: "DBIT",
  status: "BOOK",
  booking_date: "2026-10-14",
  value_date: "2026-10-14",
  transaction_date: "2026-10-13",
  creditor: { name: "RIMI EESTI FOOD AS" },
  debtor: { name: "Siim" },
  remittance_information: ["Kaardimakse 4567**1234 RIMI TALLINN"],
  ...o,
});

const mapped = (o: Partial<MappedTx> = {}): MappedTx => ({
  externalId: "x1", date: "2026-10-14", month: "2026-10", day: 14, amount: 12.34, currency: "EUR", kind: "expense",
  rawText: "RIMI — card", merchant: "Rimi", pending: false, ...o,
});

const existing = (o: Partial<ExistingRow> & { ID: string }): ExistingRow => ({ MONTH: "2026-10", DAY: 14, AMOUNT: 12.34, KIND: "expense", EXTERNAL_ID: null, ...o });

describe("mapTransaction", () => {
  test("debit → expense with creditor name, booking date, merchant cleaned", () => {
    const m = mapTransaction(btx())!;
    assert.equal(m.kind, "expense");
    assert.equal(m.amount, 12.34);
    assert.equal(m.date, "2026-10-14");
    assert.equal(m.month, "2026-10");
    assert.equal(m.day, 14);
    assert.equal(m.externalId, "ref-1");
    assert.equal(m.rawText, "RIMI EESTI FOOD AS — Kaardimakse 4567**1234 RIMI TALLINN");
    assert.match(m.merchant, /^Rimi/);
    assert.equal(m.pending, false);
  });

  test("credit → income with the debtor as counterparty; transaction_id wins over entry_reference", () => {
    const m = mapTransaction(btx({ credit_debit_indicator: "CRDT", transaction_id: "tx-9", debtor: { name: "Acme OÜ" }, remittance_information: ["Palk"] }))!;
    assert.equal(m.kind, "income");
    assert.equal(m.externalId, "tx-9");
    assert.equal(m.rawText, "Acme OÜ — Palk");
  });

  test("amount sign is ignored when the indicator is present; used when it is not", () => {
    assert.equal(mapTransaction(btx({ transaction_amount: { currency: "EUR", amount: "-5.00" } }))!.amount, 5);
    assert.equal(mapTransaction(btx({ credit_debit_indicator: null, transaction_amount: { currency: "EUR", amount: "-5.00" } }))!.kind, "expense");
    assert.equal(mapTransaction(btx({ credit_debit_indicator: null, transaction_amount: { currency: "EUR", amount: "5.00" } }))!.kind, "income");
  });

  test("falls back to value_date / transaction_date; no date or zero amount → null", () => {
    assert.equal(mapTransaction(btx({ booking_date: null }))!.date, "2026-10-14");
    assert.equal(mapTransaction(btx({ booking_date: null, value_date: null }))!.date, "2026-10-13");
    assert.equal(mapTransaction(btx({ booking_date: null, value_date: null, transaction_date: null })), null);
    assert.equal(mapTransaction(btx({ transaction_amount: { currency: "EUR", amount: "0" } })), null);
    assert.equal(mapTransaction(btx({ transaction_amount: { currency: "EUR", amount: "abc" } })), null);
  });

  test("pending: PDNG (or any non-BOOK status) is pending", () => {
    assert.equal(mapTransaction(btx({ status: "PDNG", booking_date: null }))!.pending, true);
    assert.equal(mapTransaction(btx({ status: "HOLD" }))!.pending, true);
    assert.equal(mapTransaction(btx({ status: null, booking_date: null }))!.pending, true);
    assert.equal(mapTransaction(btx({ status: null }))!.pending, false);
  });

  test("no bank id → stable content hash; identical same-day twins get #2", () => {
    const a = mapTransaction(btx({ entry_reference: null }))!;
    const b = mapTransaction(btx({ entry_reference: null }))!;
    assert.match(a.externalId, /^h:[0-9a-f]{24}$/);
    assert.equal(a.externalId, b.externalId);
    assert.notEqual(mapTransaction(btx({ entry_reference: null, transaction_amount: { currency: "EUR", amount: "12.35" } }))!.externalId, a.externalId);
    const batch = mapTransactions([btx({ entry_reference: null }), btx({ entry_reference: null }), btx({ entry_reference: "keep" })]);
    assert.deepEqual(batch.map((m) => m.externalId), [a.externalId, `${a.externalId}#2`, "keep"]);
  });

  test("missing names and remittance fall back to note or a placeholder", () => {
    const m = mapTransaction(btx({ creditor: null, remittance_information: null, note: "ATM" }))!;
    assert.equal(m.rawText, "ATM");
    assert.equal(mapTransaction(btx({ creditor: null, remittance_information: [] }))!.rawText, "Bank transaction");
  });
});

describe("reconcile", () => {
  test("known EXTERNAL_ID → skip (also when that row is deleted)", () => {
    const d = reconcile([mapped(), mapped({ externalId: "x2" })], [existing({ ID: "r1", EXTERNAL_ID: "x1" }), existing({ ID: "r2", EXTERNAL_ID: "x2", DELETED: true })]);
    assert.deepEqual(d.map((x) => x.action), ["skip", "skip"]);
  });

  test("hand-entered row with same amount, kind, month and day ±3 → link; keeps it claimed once", () => {
    const d = reconcile(
      [mapped({ externalId: "a", day: 14 }), mapped({ externalId: "b", day: 15, date: "2026-10-15" })],
      [existing({ ID: "r1", DAY: 16 })],
    );
    assert.deepEqual(d.map((x) => x.action), ["link", "insert"]);
    assert.equal(d[0].action === "link" && d[0].rowId, "r1");
  });

  test("closest day wins; a row without a day matches but ranks after dated ones", () => {
    const d = reconcile([mapped({ day: 14 })], [existing({ ID: "noday", DAY: null }), existing({ ID: "far", DAY: 17 }), existing({ ID: "near", DAY: 13 })]);
    assert.equal(d[0].action === "link" && d[0].rowId, "near");
    const d2 = reconcile([mapped({ day: 14 })], [existing({ ID: "noday", DAY: null }), existing({ ID: "toofar", DAY: 18 })]);
    assert.equal(d2[0].action === "link" && d2[0].rowId, "noday");
  });

  test("no link across months, kinds, amounts beyond ±0.005, days beyond ±3, deleted rows or rows with another bank id", () => {
    const rows = [
      existing({ ID: "m", MONTH: "2026-09" }),
      existing({ ID: "k", KIND: "income" }),
      existing({ ID: "a", AMOUNT: 12.35 }),
      existing({ ID: "d", DAY: 10 }),
      existing({ ID: "del", DELETED: true }),
      existing({ ID: "ext", EXTERNAL_ID: "other" }),
    ];
    assert.deepEqual(reconcile([mapped()], rows).map((x) => x.action), ["insert"]);
    assert.equal(reconcile([mapped({ amount: 12.344 })], [existing({ ID: "ok" })])[0].action, "link");
  });

  test("pending is never inserted or linked; duplicate ids in one batch are skipped", () => {
    const d = reconcile([mapped({ pending: true }), mapped({ externalId: "z" }), mapped({ externalId: "z" })], [existing({ ID: "r" })]);
    assert.deepEqual(d.map((x) => x.action).sort(), ["link", "pending", "skip"]);
  });

  test("processes oldest first so an earlier transaction claims the row", () => {
    const d = reconcile([mapped({ externalId: "late", day: 16, date: "2026-10-16" }), mapped({ externalId: "early", day: 12, date: "2026-10-12" })], [existing({ ID: "r", DAY: 14 })]);
    const link = d.find((x) => x.action === "link");
    assert.equal(link?.tx.externalId, "early");
  });
});

describe("categorize", () => {
  const rule = (o: Partial<Rule>): Rule => ({ ID: "r", PATTERN: "x", CATEGORY: "other", GROUP_ID: null, PRIORITY: 0, SET_NAME: null, SET_TAGS: null, SET_RECURRING: null, AMOUNT_MIN: null, AMOUNT_MAX: null, ...o });

  test("rules first, with name/tags/recurring", () => {
    const c = categorize(mapped({ merchant: "Netflix", rawText: "NETFLIX.COM" }), [rule({ PATTERN: "netflix", CATEGORY: "entertainment", SET_NAME: "Netflix", SET_TAGS: "#tv", SET_RECURRING: 1, GROUP_ID: "g" })], null);
    assert.deepEqual(c, { category: "entertainment", groupId: "g", name: "Netflix", tags: "#tv", isRecurring: true });
  });

  test("then the classifier, then the keyword guess, else other", () => {
    const model = train([{ name: "Kohvik Rost", category: "dining", groupId: "fun" }, { name: "Kohvik Rost", category: "dining", groupId: "fun" }, { name: "Rimi", category: "groceries", groupId: null }]);
    assert.equal(categorize(mapped({ merchant: "Kohvik Rost", rawText: "KOHVIK ROST" }), [], model).category, "dining");
    assert.equal(categorize(mapped({ merchant: "Circle K", rawText: "CIRCLE K TALLINN" }), [], null).category, "fuel");
    assert.equal(categorize(mapped({ merchant: "Zzz", rawText: "ZZZ" }), [], null).category, "other");
    assert.equal(categorize(mapped({ merchant: "Zzz", rawText: "ZZZ" }), [], null).name, "Zzz");
  });

  test("income takes rules only, else other", () => {
    assert.equal(categorize(mapped({ kind: "income", merchant: "Circle K", rawText: "refund" }), [], null).category, "other");
    assert.equal(categorize(mapped({ kind: "income", merchant: "Acme", rawText: "Palk" }), [rule({ PATTERN: "palk", CATEGORY: "savings", SET_NAME: "Salary" })], null).name, "Salary");
  });
});

describe("helpers", () => {
  test("pickBalance prefers booked, then expected/available", () => {
    const b = (type: string, amount: string) => ({ balance_type: type, balance_amount: { currency: "EUR", amount } });
    assert.deepEqual(pickBalance([b("ITAV", "90"), b("CLBD", "100")]), { amount: 100, type: "CLBD" });
    assert.deepEqual(pickBalance([b("ITAV", "90"), b("WHAT", "1")]), { amount: 90, type: "ITAV" });
    assert.equal(pickBalance([b("CLBD", "x")]), null);
    assert.equal(pickBalance([]), null);
  });

  test("syncWindowStart = max(SYNC_FROM, LAST_BOOKING_DATE − 5 days), else 90 days back", () => {
    assert.equal(syncWindowStart("2026-09-01", "2026-10-10", "2026-10-17"), "2026-10-05");
    assert.equal(syncWindowStart("2026-10-08", "2026-10-10", "2026-10-17"), "2026-10-08");
    assert.equal(syncWindowStart("2026-09-01", null, "2026-10-17"), "2026-09-01");
    assert.equal(syncWindowStart(null, "2026-03-03", "2026-10-17"), "2026-02-26");
    assert.equal(syncWindowStart(null, null, "2026-10-17"), "2026-07-19");
  });

  test("maskIban and daysLeft", () => {
    assert.equal(maskIban("EE38 2200 2210 2014 5685"), "EE38 •••• 5685");
    assert.equal(maskIban(null), "");
    const now = new Date("2026-10-17T12:00:00Z");
    assert.equal(daysLeft("2026-10-24T12:00:00Z", now), 7);
    assert.equal(daysLeft("2026-10-16T12:00:00Z", now), -1);
    assert.equal(daysLeft(null, now), null);
  });

  test("JWT: RS256, kid = app id, Enable Banking iss/aud, exp ≤ 24 h, verifiable signature", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const jwt = makeJwt("app-123", pem.replace(/\n/g, "\\n"), 1_000_000, 999_999);
    const [h, c, sig] = jwt.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { typ: "JWT", alg: "RS256", kid: "app-123" });
    assert.deepEqual(JSON.parse(Buffer.from(c, "base64url").toString()), { iss: "enablebanking.com", aud: "api.enablebanking.com", iat: 1_000_000, exp: 1_000_000 + 86400 });
    assert.ok(verify("RSA-SHA256", Buffer.from(`${h}.${c}`), publicKey, Buffer.from(sig, "base64url")));
    assert.equal(normalizePem('"a\\nb"'), "a\nb");
  });

  test("isSessionGone recognises expired/closed sessions only", () => {
    assert.ok(isSessionGone(new EnableBankingError("x", 401, "EXPIRED_SESSION")));
    assert.ok(!isSessionGone(new EnableBankingError("x", 500, null)));
    assert.ok(!isSessionGone(new Error("x")));
  });

  test("mock transactions are deterministic, ~60 days, with one pending", () => {
    const day = new Date("2026-10-17T10:00:00Z");
    const a = mockTransactions("pohja", day);
    const b = mockTransactions("pohja", new Date("2026-10-17T22:00:00Z"));
    assert.deepEqual(a, b);
    assert.ok(a.length > 30);
    assert.equal(a.filter((t) => t.status === "PDNG").length, 1);
    const dates = a.map((t) => t.value_date!).sort();
    assert.ok(dates[0] >= "2026-08-18" && dates[0] <= "2026-08-25", dates[0]);
    assert.equal(dates.at(-1), "2026-10-17");
    // The overlapping days of tomorrow's statement carry the same ids.
    const tomorrow = new Set(mockTransactions("pohja", new Date("2026-10-18T10:00:00Z")).map((t) => t.entry_reference));
    assert.ok(a.filter((t) => t.entry_reference && t.value_date! > "2026-08-19" && t.value_date! < "2026-10-17").every((t) => tomorrow.has(t.entry_reference)));
    assert.ok(a.some((t) => t.credit_debit_indicator === "CRDT" && t.debtor?.name === "Acme Software OÜ"));
  });
});

describe("sync against the database (mock bank)", () => {
  type Db = typeof import("@/lib/db").default;
  let db: Db;
  let sync: typeof import("@/lib/banksync-db");
  let connect: typeof import("@/lib/bank-connect");
  let eb: typeof import("@/lib/enablebanking");
  const WS = randomUUID();
  const USER = randomUUID();

  before(async () => {
    process.env.ENABLE_BANKING_MOCK = "1";
    db = (await import("@/lib/db")).default;
    sync = await import("@/lib/banksync-db");
    connect = await import("@/lib/bank-connect");
    eb = await import("@/lib/enablebanking");
  });

  beforeEach(async () => {
    for (const t of ["LEDGER", "LEDGER_TAG", "LEDGER_AUDIT", "BANK_CONNECTION", "BANK_ACCOUNT", "BALANCE_CHECKPOINT", "ACCOUNT", "ACCOUNT_SNAPSHOT", "WORKSPACE_MEMBER", "IMPORT_PATTERN"]) await db.execute(`DELETE FROM ${t}`);
    await db.execute("INSERT INTO WORKSPACE_MEMBER (WORKSPACE_ID, USER_ID, ROLE) VALUES (?, ?, 'owner')", [WS, USER]);
  });

  async function connectMock(): Promise<string> {
    const { url, connectionId } = await connect.beginAuth({ workspaceId: WS, userId: USER }, { name: eb.MOCK_BANKS[0].name, country: "EE" }, "http://test/bank/callback");
    const params = new URL(url, "http://test").searchParams;
    const pending = await connect.findPending(USER, params.get("state")!);
    assert.ok(pending, "state resolves to the pending connection");
    assert.equal(await connect.findPending(randomUUID(), params.get("state")!), null, "another user cannot finish it");
    await connect.completeAuth(pending!, params.get("code")!);
    return connectionId;
  }

  const ledgerRows = async () => (await db.execute("SELECT ID, NAME, KIND, EXTERNAL_ID, NOTES, CATEGORY, DAY, MONTH, DELETED_AT FROM LEDGER WHERE WORKSPACE_ID = ?", [WS]))[0] as Array<{ ID: string; NAME: string; KIND: string; EXTERNAL_ID: string | null; NOTES: string | null; CATEGORY: string; DAY: number; MONTH: string; DELETED_AT: string | null }>;

  test("connect, sync, sync again adds nothing; hand-entered row is linked; deleted bank row stays deleted", async () => {
    const id = await connectMock();
    const [conn] = (await db.execute("SELECT STATUS, STATE, SESSION_ID, VALID_UNTIL FROM BANK_CONNECTION WHERE ID = ?", [id]))[0] as Array<{ STATUS: string; STATE: string | null; SESSION_ID: string; VALID_UNTIL: string }>;
    assert.equal(conn.STATUS, "active");
    assert.equal(conn.STATE, null);
    assert.ok(conn.SESSION_ID && conn.VALID_UNTIL);
    const accounts = await sync.listBankAccounts(WS);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].IBAN, eb.MOCK_BANKS[0].iban);

    // A hand-entered Netflix row for the 12th of a month inside the window.
    const netflix = mockTransactions("pohja").find((t) => t.creditor?.name === "NETFLIX.COM" && t.booking_date! >= accounts[0].SYNC_FROM!)!;
    const handId = randomUUID();
    await db.execute("INSERT INTO LEDGER (ID, WORKSPACE_ID, KIND, CATEGORY, NAME, AMOUNT, MONTH, DAY) VALUES (?, ?, 'expense', 'subscriptions', 'My Netflix', 12.99, ?, NULL)", [handId, WS, netflix.booking_date!.slice(0, 7)]);

    const first = await sync.syncConnection(WS, id);
    assert.equal(first.error, null);
    assert.ok(first.inserted > 10, `inserted ${first.inserted}`);
    assert.equal(first.linked, 1);
    assert.equal(first.pending, 1);
    const rows = await ledgerRows();
    const hand = rows.find((r) => r.ID === handId)!;
    assert.equal(hand.NAME, "My Netflix", "the user's name is kept");
    assert.equal(hand.EXTERNAL_ID, netflix.entry_reference);
    assert.equal(hand.DAY, 12, "missing day filled from the bank");
    const inserted = rows.filter((r) => r.ID !== handId);
    assert.ok(inserted.every((r) => r.EXTERNAL_ID && r.NOTES?.startsWith("Bank: ")));
    assert.ok(inserted.some((r) => r.KIND === "income"));
    assert.ok(inserted.filter((r) => r.NAME.startsWith("Circle K")).every((r) => r.CATEGORY === "fuel"));
    assert.ok(inserted.every((r) => r.MONTH >= accounts[0].SYNC_FROM!.slice(0, 7)), "nothing before SYNC_FROM");

    await db.execute("UPDATE LEDGER SET DELETED_AT = CURRENT_TIMESTAMP WHERE ID = ?", [inserted[0].ID]);
    const second = await sync.syncConnection(WS, id);
    assert.equal(second.inserted, 0);
    assert.equal(second.linked, 0);
    assert.equal((await ledgerRows()).length, rows.length);

    const [cp] = (await db.execute("SELECT AMOUNT, NOTE FROM BALANCE_CHECKPOINT WHERE WORKSPACE_ID = ?", [WS]))[0] as Array<{ AMOUNT: number; NOTE: string }>;
    assert.equal(cp.AMOUNT, eb.MOCK_BANKS[0].balance);
    assert.equal(((await db.execute("SELECT COUNT(*) AS N FROM BALANCE_CHECKPOINT WHERE WORKSPACE_ID = ?", [WS]))[0] as Array<{ N: number }>)[0].N, 1, "one checkpoint per day");
  });

  test("net worth link writes this month's snapshot; reconnect keeps the account and its settings", async () => {
    const id = await connectMock();
    const acc = randomUUID();
    await db.execute("INSERT INTO ACCOUNT (ID, WORKSPACE_ID, NAME, TYPE) VALUES (?, ?, 'Everyday', 'cash')", [acc, WS]);
    const [bank] = await sync.listBankAccounts(WS);
    await db.execute("UPDATE BANK_ACCOUNT SET NETWORTH_ACCOUNT_ID = ? WHERE ID = ?", [acc, bank.ID]);
    await sync.syncConnection(WS, id);
    const [snap] = (await db.execute("SELECT BALANCE FROM ACCOUNT_SNAPSHOT WHERE ACCOUNT_ID = ?", [acc]))[0] as Array<{ BALANCE: number }>;
    assert.equal(snap.BALANCE, eb.MOCK_BANKS[0].balance);

    const again = await connectMock();
    assert.equal(again, id, "connecting the same bank again reconnects the existing connection");
    const after = await sync.listBankAccounts(WS);
    assert.equal(after.length, 1);
    assert.equal(after[0].ID, bank.ID);
    assert.equal(after[0].NETWORTH_ACCOUNT_ID, acc);
  });

  test("expired consent is marked expired; API failure is stored, not thrown", async () => {
    const id = await connectMock();
    await db.execute("UPDATE BANK_CONNECTION SET VALID_UNTIL = '2020-01-01T00:00:00Z' WHERE ID = ?", [id]);
    const r = await sync.syncConnection(WS, id);
    assert.match(r.error ?? "", /expired/i);
    assert.equal(((await db.execute("SELECT STATUS FROM BANK_CONNECTION WHERE ID = ?", [id]))[0] as Array<{ STATUS: string }>)[0].STATUS, "expired");

    await db.execute("UPDATE BANK_CONNECTION SET VALID_UNTIL = NULL, STATUS = 'active' WHERE ID = ?", [id]);
    const failing: import("@/lib/enablebanking").BankApi = {
      mock: true,
      listAspsps: async () => [],
      startAuth: async () => ({ url: "" }),
      createSession: async () => { throw new Error("no"); },
      getTransactions: async () => { throw new eb.EnableBankingError("Bank is down", 503, null); },
      getBalances: async () => [],
      deleteSession: async () => undefined,
    };
    const f = await sync.syncConnection(WS, id, failing);
    assert.equal(f.error, "Bank is down");
    const [c] = (await db.execute("SELECT STATUS, LAST_ERROR FROM BANK_CONNECTION WHERE ID = ?", [id]))[0] as Array<{ STATUS: string; LAST_ERROR: string }>;
    assert.deepEqual({ ...c }, { STATUS: "error", LAST_ERROR: "Bank is down" });

    const gone = { ...failing, getTransactions: async () => { throw new eb.EnableBankingError("Session expired", 401, "EXPIRED_SESSION"); } };
    await sync.syncConnection(WS, id, gone);
    assert.equal(((await db.execute("SELECT STATUS FROM BANK_CONNECTION WHERE ID = ?", [id]))[0] as Array<{ STATUS: string }>)[0].STATUS, "expired");
  });

  test("stale state (over an hour) is rejected", async () => {
    const { url } = await connect.beginAuth({ workspaceId: WS, userId: USER }, { name: eb.MOCK_BANKS[1].name, country: "EE" }, "http://test/bank/callback");
    const state = new URL(url, "http://test").searchParams.get("state")!;
    await db.execute("UPDATE BANK_CONNECTION SET UPDATED_AT = datetime('now', '-2 hours') WHERE STATE = ?", [state]);
    assert.equal(await connect.findPending(USER, state), null);
  });
});
