/**
 * Narrowing helpers, so untyped values (JSON, protocol envelopes, form data) are checked
 * rather than asserted.
 */

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A non-empty tuple, as z.enum needs, from a list that must not be empty. */
export function nonEmpty<T>(items: readonly T[]): [T, ...T[]] {
  const [first, ...rest] = items;
  if (first === undefined) throw new Error("Expected at least one item");
  return [first, ...rest];
}

/** `value`, or throw naming what was missing: for things that must exist (a parsed page's <h1>). */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${what}`);
  return value;
}

/** The member of `options` equal to `value`, if any: narrows a string to a union. */
export const oneOf = <T extends string>(options: readonly T[], value: unknown): T | undefined => options.find((o) => o === value);
