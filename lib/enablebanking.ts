// Enable Banking (https://enablebanking.com) — PSD2 account information,
// read only. A small typed client over `fetch`; the RS256 JWT is signed with
// Node's crypto, so there is no SDK dependency.
//
// Configuration (env):
//   ENABLE_BANKING_APP_ID        application id (the JWT `kid`)
//   ENABLE_BANKING_PRIVATE_KEY   the application's private key, PEM ("\n"-escaped is fine)
//   ENABLE_BANKING_API           default https://api.enablebanking.com
//   ENABLE_BANKING_REDIRECT_URL  default ${APP_URL}/bank/callback
//   ENABLE_BANKING_MOCK=1        deterministic fake banks (also the default in
//                                development when no app id is set)
import { createHash, createPrivateKey, sign, type KeyObject } from "node:crypto";

// ---------- API shapes (the subset we use) ----------
export type AmountType = { currency: string; amount: string };
export type PartyIdentification = { name?: string | null } | null;

export type Aspsp = {
  name: string;
  country: string;
  logo?: string | null;
  psu_types?: string[];
  /** Seconds. */
  maximum_consent_validity?: number | null;
  beta?: boolean;
};

export type BankAccountResource = {
  uid: string;
  account_id?: { iban?: string | null; other?: { identification?: string | null } | null } | null;
  name?: string | null;
  details?: string | null;
  product?: string | null;
  currency?: string | null;
  cash_account_type?: string | null;
};

export type TransactionStatus = "BOOK" | "PDNG" | "CNCL" | "HOLD" | "OTHR" | "RJCT" | "SCHD";

export type BankTransaction = {
  entry_reference?: string | null;
  transaction_id?: string | null;
  transaction_amount: AmountType;
  credit_debit_indicator?: "CRDT" | "DBIT" | null;
  status?: TransactionStatus | null;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  creditor?: PartyIdentification;
  debtor?: PartyIdentification;
  remittance_information?: string[] | null;
  merchant_category_code?: string | null;
  note?: string | null;
};

export type BankBalance = {
  name?: string | null;
  balance_amount: AmountType;
  /** CLBD, ITAV, XPCD, CLAV, OPBD, OPAV, ITBD, OTHR, VALU, PRCD, FWAV, INFO. */
  balance_type: string;
  reference_date?: string | null;
};

export type AuthRequest = {
  aspsp: { name: string; country: string };
  state: string;
  redirectUrl: string;
  /** RFC3339. */
  validUntil: string;
  psuType?: "personal" | "business";
};

export type SessionResult = {
  session_id: string;
  accounts: BankAccountResource[];
  access?: { valid_until?: string | null } | null;
  aspsp?: { name: string; country: string } | null;
};

export type TransactionsPage = { transactions: BankTransaction[]; continuation_key?: string | null };

export interface BankApi {
  readonly mock: boolean;
  listAspsps(country: string): Promise<Aspsp[]>;
  /** POST /auth — the URL to send the user to. */
  startAuth(req: AuthRequest): Promise<{ url: string; authorization_id?: string }>;
  /** POST /sessions with the code from the redirect. */
  createSession(code: string): Promise<SessionResult>;
  getTransactions(accountUid: string, q: { dateFrom?: string; continuationKey?: string | null }): Promise<TransactionsPage>;
  getBalances(accountUid: string): Promise<BankBalance[]>;
  deleteSession(sessionId: string): Promise<void>;
}

/** API error with the Enable Banking `error` code when it sent one. */
export class EnableBankingError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null) {
    super(message);
    this.name = "EnableBankingError";
  }
}

const GONE_CODES = new Set(["EXPIRED_SESSION", "CLOSED_SESSION", "SESSION_DOES_NOT_EXIST", "REVOKED_SESSION"]);

/** True when the consent is over and only a new authorisation helps. */
export function isSessionGone(e: unknown): boolean {
  return e instanceof EnableBankingError && e.code !== null && GONE_CODES.has(e.code);
}

// ---------- configuration ----------
export type BankMode = "live" | "mock" | "off";

export function bankMode(): BankMode {
  if (process.env.ENABLE_BANKING_MOCK === "1" || process.env.ENABLE_BANKING_MOCK === "true") return "mock";
  if (process.env.ENABLE_BANKING_APP_ID && process.env.ENABLE_BANKING_PRIVATE_KEY) return "live";
  if (!process.env.ENABLE_BANKING_APP_ID && process.env.NODE_ENV === "development") return "mock";
  return "off";
}

export function bankApiBase(): string {
  return (process.env.ENABLE_BANKING_API || "https://api.enablebanking.com").replace(/\/$/, "");
}

/** Where the bank sends the user back; null = derive from the request. */
export function configuredRedirectUrl(): string | null {
  if (process.env.ENABLE_BANKING_REDIRECT_URL) return process.env.ENABLE_BANKING_REDIRECT_URL;
  const app = process.env.APP_URL?.replace(/\/$/, "");
  return app ? `${app}/bank/callback` : null;
}

/** PEM from env; literal "\n" sequences (one-line secrets) become newlines. */
export function normalizePem(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
}

// ---------- JWT ----------
const b64url = (input: Buffer | string): string => Buffer.from(input).toString("base64url");

/** RS256 JWT: header {typ, alg, kid=appId}, claims iss/aud/iat/exp (exp − iat ≤ 86400). */
export function makeJwt(appId: string, key: KeyObject | string, nowSec = Math.floor(Date.now() / 1000), ttlSec = 3600): string {
  const header = { typ: "JWT", alg: "RS256", kid: appId };
  const claims = { iss: "enablebanking.com", aud: "api.enablebanking.com", iat: nowSec, exp: nowSec + Math.min(ttlSec, 86400) };
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = sign("RSA-SHA256", Buffer.from(body), typeof key === "string" ? createPrivateKey(normalizePem(key)) : key);
  return `${body}.${b64url(signature)}`;
}

// ---------- live client ----------
class LiveBankApi implements BankApi {
  readonly mock = false;
  private token: { value: string; exp: number } | null = null;
  private key: KeyObject;

  constructor(private appId: string, privateKey: string, private base: string) {
    this.key = createPrivateKey(normalizePem(privateKey));
  }

  private jwt(): string {
    const now = Math.floor(Date.now() / 1000);
    if (!this.token || this.token.exp - now < 300) {
      this.token = { value: makeJwt(this.appId, this.key, now, 3600), exp: now + 3600 };
    }
    return this.token.value;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.jwt()}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
    if (!res.ok) {
      const err = (json ?? {}) as { message?: string; error?: string; detail?: unknown };
      const detail = typeof err.detail === "string" ? `: ${err.detail}` : "";
      throw new EnableBankingError(`${err.message || `HTTP ${res.status}`}${detail}`.slice(0, 500), res.status, err.error ?? null);
    }
    return json as T;
  }

  async listAspsps(country: string): Promise<Aspsp[]> {
    const r = await this.call<{ aspsps: Aspsp[] }>("GET", `/aspsps?country=${encodeURIComponent(country)}&psu_type=personal`);
    return r.aspsps ?? [];
  }

  async startAuth(req: AuthRequest): Promise<{ url: string; authorization_id?: string }> {
    return this.call("POST", "/auth", {
      access: { valid_until: req.validUntil },
      aspsp: req.aspsp,
      state: req.state,
      redirect_url: req.redirectUrl,
      psu_type: req.psuType ?? "personal",
    });
  }

  createSession(code: string): Promise<SessionResult> {
    return this.call("POST", "/sessions", { code });
  }

  getTransactions(accountUid: string, q: { dateFrom?: string; continuationKey?: string | null }): Promise<TransactionsPage> {
    const params = new URLSearchParams();
    if (q.dateFrom) params.set("date_from", q.dateFrom);
    if (q.continuationKey) params.set("continuation_key", q.continuationKey);
    const qs = params.toString();
    return this.call("GET", `/accounts/${encodeURIComponent(accountUid)}/transactions${qs ? `?${qs}` : ""}`);
  }

  async getBalances(accountUid: string): Promise<BankBalance[]> {
    const r = await this.call<{ balances: BankBalance[] }>("GET", `/accounts/${encodeURIComponent(accountUid)}/balances`);
    return r.balances ?? [];
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.call("DELETE", `/sessions/${encodeURIComponent(sessionId)}`);
  }
}

// ---------- mock ----------
// Two fake Estonian banks with one current account each and ~60 days of
// transactions. Everything is a pure function of (account, date), so the
// same day always yields the same transactions and ids, across calls and
// restarts — which is what makes "sync twice, nothing new" testable.

export const MOCK_BANKS = [
  { key: "pohja", name: "Põhja Pank (mock)", country: "EE", iban: "EE382200221020145685", account: "Everyday account", balance: 1843.27 },
  { key: "louna", name: "Lõuna Pank (mock)", country: "EE", iban: "EE471000001020145611", account: "Family card", balance: 412.6 },
] as const;

const MOCK_DAYS = 60;

function seeded(s: string): number {
  return createHash("sha256").update(s).digest().readUInt32BE(0) / 0x100000000;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);

function mockDays(today = new Date()): string[] {
  const out: string[] = [];
  const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (let i = MOCK_DAYS; i >= 0; i--) out.push(iso(new Date(base - i * 86_400_000)));
  return out;
}

type MockLine = { party: string; text: string; amount: number; kind: "DBIT" | "CRDT"; pending?: boolean };

function mockLinesFor(bank: (typeof MOCK_BANKS)[number]["key"], date: string, isToday: boolean): MockLine[] {
  const day = Number(date.slice(8, 10));
  const r = (salt: string) => seeded(`${bank}:${date}:${salt}`);
  const money = (lo: number, hi: number, salt: string) => Math.round((lo + r(salt) * (hi - lo)) * 100) / 100;
  const out: MockLine[] = [];
  if (bank === "pohja") {
    if (day === 25) out.push({ party: "Acme Software OÜ", text: "Palk / salary", amount: 2850, kind: "CRDT" });
    if (day === 1) out.push({ party: "Kodu Kinnisvara OÜ", text: "Üür / rent", amount: 650, kind: "DBIT" });
    if (day === 12) out.push({ party: "NETFLIX.COM", text: "Kaardimakse 4567**1234 NETFLIX.COM", amount: 12.99, kind: "DBIT" });
    if (r("rimi") < 0.35) out.push({ party: "RIMI", text: "Kaardimakse 4567**1234 RIMI TALLINN", amount: money(6, 58, "rimi$"), kind: "DBIT" });
    if (r("selver") < 0.15) out.push({ party: "SELVER", text: "Kaardimakse 4567**1234 SELVER KRISTIINE", amount: money(12, 95, "selver$"), kind: "DBIT" });
    if (day % 9 === 3) out.push({ party: "CIRCLE K", text: "Kaardimakse 4567**1234 CIRCLE K TALLINN", amount: money(45, 75, "ck$"), kind: "DBIT" });
    if (r("bolt") < 0.2 || isToday) out.push({ party: "BOLT", text: "Kaardimakse 4567**1234 BOLT.EU/O/2610", amount: money(4, 17, "bolt$"), kind: "DBIT" });
    if (isToday) out.push({ party: "RIMI", text: "Kaardimakse 4567**1234 RIMI TALLINN (pending)", amount: money(5, 30, "pend$"), kind: "DBIT", pending: true });
  } else {
    if (day === 5) out.push({ party: "SPOTIFY", text: "Kaardimakse 5512**9876 SPOTIFY", amount: 11.99, kind: "DBIT" });
    if (day === 26) out.push({ party: "Põhja Pank konto", text: "Ülekanne / transfer", amount: 300, kind: "CRDT" });
    if (r("selver") < 0.12) out.push({ party: "SELVER", text: "Kaardimakse 5512**9876 SELVER ÜLEMISTE", amount: money(8, 70, "selver$"), kind: "DBIT" });
    if (r("apotheka") < 0.04) out.push({ party: "APOTHEKA", text: "Kaardimakse 5512**9876 APOTHEKA", amount: money(4, 30, "apo$"), kind: "DBIT" });
  }
  return out;
}

export function mockTransactions(bankKey: string, today = new Date()): BankTransaction[] {
  const bank = MOCK_BANKS.find((b) => b.key === bankKey);
  if (!bank) return [];
  const days = mockDays(today);
  const last = days[days.length - 1];
  const out: BankTransaction[] = [];
  for (const date of days) {
    mockLinesFor(bank.key, date, date === last).forEach((l, i) => {
      const id = createHash("sha256").update(`${bank.key}:${date}:${i}:${l.party}`).digest("hex").slice(0, 20);
      out.push({
        entry_reference: l.pending ? null : `mock-${id}`,
        transaction_id: null,
        transaction_amount: { currency: "EUR", amount: l.amount.toFixed(2) },
        credit_debit_indicator: l.kind,
        status: l.pending ? "PDNG" : "BOOK",
        booking_date: l.pending ? null : date,
        value_date: date,
        transaction_date: date,
        creditor: l.kind === "DBIT" ? { name: l.party } : null,
        debtor: l.kind === "CRDT" ? { name: l.party } : null,
        remittance_information: [l.text],
      });
    });
  }
  // Newest first, like most banks.
  return out.reverse();
}

const MOCK_PAGE = 25;

class MockBankApi implements BankApi {
  readonly mock = true;

  async listAspsps(country: string): Promise<Aspsp[]> {
    return MOCK_BANKS.filter((b) => b.country === country.toUpperCase()).map((b) => ({ name: b.name, country: b.country, logo: null, psu_types: ["personal"], maximum_consent_validity: 180 * 86400 }));
  }

  async startAuth(req: AuthRequest): Promise<{ url: string; authorization_id?: string }> {
    const bank = MOCK_BANKS.find((b) => b.name === req.aspsp.name && b.country === req.aspsp.country);
    if (!bank) throw new EnableBankingError("ASPSP not found", 422, "ASPSP_NOT_FOUND");
    // Straight back to our own callback, as if the user approved at the bank.
    const code = `mock.${bank.key}.${createHash("sha256").update(req.state).digest("hex").slice(0, 12)}`;
    return { url: `/bank/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(req.state)}`, authorization_id: `mock-auth-${code}` };
  }

  async createSession(code: string): Promise<SessionResult> {
    const [, key] = code.split(".");
    const bank = MOCK_BANKS.find((b) => b.key === key);
    if (!bank) throw new EnableBankingError("Authorization code expired", 422, "EXPIRED_AUTHORIZATION_CODE");
    return {
      session_id: `mock-session-${code}`,
      accounts: [{ uid: `mock-${bank.key}-1`, account_id: { iban: bank.iban }, name: bank.account, currency: "EUR", cash_account_type: "CACC" }],
      access: { valid_until: new Date(Date.now() + 180 * 86_400_000).toISOString() },
      aspsp: { name: bank.name, country: bank.country },
    };
  }

  async getTransactions(accountUid: string, q: { dateFrom?: string; continuationKey?: string | null }): Promise<TransactionsPage> {
    const key = accountUid.replace(/^mock-|-1$/g, "");
    const all = mockTransactions(key).filter((t) => (t.booking_date ?? t.value_date ?? "") >= (q.dateFrom ?? ""));
    const start = q.continuationKey ? Number(q.continuationKey) : 0;
    const page = all.slice(start, start + MOCK_PAGE);
    return { transactions: page, continuation_key: start + MOCK_PAGE < all.length ? String(start + MOCK_PAGE) : null };
  }

  async getBalances(accountUid: string): Promise<BankBalance[]> {
    const bank = MOCK_BANKS.find((b) => accountUid === `mock-${b.key}-1`);
    if (!bank) throw new EnableBankingError("Account does not exist", 404, "ACCOUNT_DOES_NOT_EXIST");
    const pending = mockTransactions(bank.key).filter((t) => t.status === "PDNG").reduce((s, t) => s + Number(t.transaction_amount.amount), 0);
    const today = iso(new Date());
    return [
      { name: "Booked", balance_amount: { currency: "EUR", amount: bank.balance.toFixed(2) }, balance_type: "CLBD", reference_date: today },
      { name: "Available", balance_amount: { currency: "EUR", amount: (bank.balance - pending).toFixed(2) }, balance_type: "ITAV", reference_date: today },
    ];
  }

  async deleteSession(): Promise<void> {}
}

let live: { client: LiveBankApi; fingerprint: string } | null = null;

/** The client for the current mode, or null when bank sync is not configured. */
export function getBankApi(): BankApi | null {
  const mode = bankMode();
  if (mode === "mock") return new MockBankApi();
  if (mode === "off") return null;
  const appId = process.env.ENABLE_BANKING_APP_ID!;
  const key = process.env.ENABLE_BANKING_PRIVATE_KEY!;
  const fingerprint = `${appId}:${bankApiBase()}:${createHash("sha256").update(key).digest("hex")}`;
  if (!live || live.fingerprint !== fingerprint) live = { client: new LiveBankApi(appId, key, bankApiBase()), fingerprint };
  return live.client;
}
