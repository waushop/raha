// Shared result shape for form-driven Server Actions. Validation problems come
// back as { ok: false, error } for the UI to toast; anything else propagates.
import { ValidationError } from "./validate";

export type ActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function attempt<T extends object>(fn: () => T | Promise<T>): Promise<ActionResult<T>> {
  try {
    const value = await fn();
    return { ok: true, ...value } as ActionResult<T>;
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    throw e;
  }
}
