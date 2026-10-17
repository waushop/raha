// Claude API access for the receipt scanner and the "Ask your money" chat.
// Server-only: imports the SDK and reads the API key.
//
// Modes:
//   - AI_MOCK=1          → deterministic offline answers (dev without a key, e2e)
//   - ANTHROPIC_API_KEY  → live calls to ANTHROPIC_MODEL (default claude-sonnet-5-5)
//   - neither            → features are hidden / return a friendly "not set up"
//
// Privacy: callers send only what a request needs (one downscaled photo, or
// the question plus tool results), nothing here logs prompts or ledger data,
// and errors are mapped to short messages without echoing request content.
import Anthropic from "@anthropic-ai/sdk";

export type AiMode = "live" | "mock" | "off";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const AI_TIMEOUT_MS = 30_000;

export function aiMode(): AiMode {
  if (process.env.AI_MOCK === "1") return "mock";
  if (process.env.ANTHROPIC_API_KEY) return "live";
  return "off";
}

export const aiEnabled = (): boolean => aiMode() !== "off";

export function aiModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

/** An error whose message is safe to show the user as is. */
export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiError";
  }
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (aiMode() !== "live") throw new AiError("The assistant isn't set up on this server.");
  // maxRetries 1: one retry on 429/5xx/connection errors; the abort signal
  // below still caps the whole call (retry included) at AI_TIMEOUT_MS.
  client ??= new Anthropic({ timeout: AI_TIMEOUT_MS, maxRetries: 1 });
  return client;
}

export type CreateParams = Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, "model" | "betas" | "fallbacks">;

/**
 * One Messages API call with the configured model, a 30 s wall-clock limit and
 * the server-side refusal fallback. Throws AiError with a friendly message on
 * every failure (network, auth, rate limit, timeout, refusal).
 */
export async function createMessage(params: CreateParams): Promise<Anthropic.Beta.BetaMessage> {
  const c = getClient();
  let message: Anthropic.Beta.BetaMessage;
  try {
    message = await c.beta.messages.create(
      {
        ...params,
        model: aiModel(),
        // Policy declines are retried on the model's default fallback instead
        // of failing the request; a model without fallbacks just runs alone.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { signal: AbortSignal.timeout(AI_TIMEOUT_MS) },
    );
  } catch (e) {
    throw friendlyError(e);
  }
  if (message.stop_reason === "refusal") throw new AiError("The assistant couldn't help with that request.");
  return message;
}

function friendlyError(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.APIUserAbortError || e instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiError("The assistant took too long to answer. Try again in a moment.");
  }
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    console.error("[claude] API key rejected");
    return new AiError("The assistant isn't configured correctly (API key rejected).");
  }
  if (e instanceof Anthropic.RateLimitError) return new AiError("The assistant is busy right now. Try again in a minute.");
  if (e instanceof Anthropic.BadRequestError) {
    // Status only: the message can quote request content.
    console.error("[claude] bad request", e.status);
    return new AiError("The assistant couldn't process that. Try a different photo or question.");
  }
  if (e instanceof Anthropic.APIError) {
    console.error("[claude] API error", e.status);
    return new AiError("The assistant is unavailable right now. Try again later.");
  }
  if (e instanceof Anthropic.APIConnectionError) return new AiError("Couldn't reach the assistant. Check the connection and try again.");
  console.error("[claude] unexpected error", e instanceof Error ? e.name : typeof e);
  return new AiError("Something went wrong with the assistant.");
}

/** The concatenated text blocks of a response. */
export function textOf(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// ---------- per-user hourly quota (single process, in memory) ----------

const HOUR_MS = 60 * 60_000;
const quotas = new Map<string, number[]>();

/**
 * Records one use of `key` and returns true when it is within `limit` uses in
 * the last hour; false (and nothing recorded) when the limit is reached.
 * `now` is injectable for tests.
 */
export function takeQuota(key: string, limit: number, now = Date.now()): boolean {
  const recent = (quotas.get(key) ?? []).filter((t) => now - t < HOUR_MS);
  if (recent.length >= limit) {
    quotas.set(key, recent);
    return false;
  }
  recent.push(now);
  quotas.set(key, recent);
  if (quotas.size > 5000) {
    for (const [k, v] of quotas) if (v.every((t) => now - t >= HOUR_MS)) quotas.delete(k);
  }
  return true;
}

export const ASK_LIMIT_PER_HOUR = 30;
export const SCAN_LIMIT_PER_HOUR = 30;
