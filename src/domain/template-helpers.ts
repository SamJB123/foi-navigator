/**
 * What every template body is given, and the small helpers they share: a slot is
 * either the value passed in `details` or a visible [[placeholder]]; dates come from
 * the case file and the deadline engine.
 */
import type { CaseFile } from "./case-file.ts";
import { type Timeline, longDate } from "./deadlines.ts";

export type Ctx = { cf?: CaseFile; tl?: Timeline; d: Record<string, string> };

export const slot = (ctx: Ctx, key: string, hint: string) => ctx.d[key] ?? `[[${hint}]]`;
export const date = (iso?: string | null) => (iso ? longDate(iso) : undefined);
export const dueOf = (ctx: Ctx) => date(ctx.tl?.processing.effective_due) ?? "[[decision due date — run foi_calculate_deadlines]]";
/** The 30th day itself, not rolled past a weekend: s 15AA agreements must be made by then ([3.247] fn 171). */
export const lastDayOf = (ctx: Ctx) => date(ctx.tl?.processing.statutory_due) ?? "[[last day of the processing period — run foi_calculate_deadlines]]";
export const ref = (ctx: Ctx) => ctx.cf?.reference ?? slot(ctx, "reference", "FOI reference");
export const received = (ctx: Ctx) => date(ctx.cf?.received_date) ?? "[[date received]]";
export const scope = (ctx: Ctx) => ctx.cf?.summary ?? slot(ctx, "scope", "scope of the request, as you understand it");
