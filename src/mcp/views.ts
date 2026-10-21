/**
 * Builders for the FOI view (the second MCP App). Tools put a `view` in
 * structuredContent; the widget validates it against view-schema.ts and renders it by
 * kind. Each view carries what must reach the user regardless of how the model relays
 * the result: the warnings, tables and drafts themselves, the case file as it stands,
 * and fixed caveats.
 *
 * The full markdown stays in the text result, for the model and for tools-only clients.
 */
import type { Corpus } from "../corpus.ts";
import { type CaseFile, EVENT_LABELS } from "../domain/case-file.ts";
import type { ChargesResult } from "../domain/charges.ts";
import { type Timeline, computeTimeline, longDate } from "../domain/deadlines.ts";
import { STAGES, STEP_BY_ID, type Role, stepsIn } from "../domain/workflow.ts";
import type { CaseStrip, StepDetail, View } from "./view-schema.ts";

export type { StepDetail, View } from "./view-schema.ts";

export const CAVEAT_ADVICE = "Guidance only, not legal advice. Decisions are made by an authorised officer (s 23) on the documents and evidence.";
export const CAVEAT_DATES =
  "Dates count calendar days and move weekend due dates to the next business day ([3.247]). Public holidays are not checked: if a date falls on one, it moves to the next business day.";

export const fileSlug = (...parts: (string | undefined)[]) =>
  parts
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "foi-document";

export function caseStrip(cf: CaseFile, tl: Timeline = computeTimeline(cf)): CaseStrip {
  return {
    reference: cf.reference,
    summary: cf.summary,
    received: cf.received_date,
    status: tl.status_label,
    decision_due: tl.processing.effective_due,
    days_remaining: tl.processing.days_remaining,
    paused_since: tl.processing.paused_since ?? null,
    stage: cf.stage,
    stage_title: cf.stage ? STEP_BY_ID.get(cf.stage)?.title : undefined,
    events: [...(cf.events ?? [])]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => ({ date: e.date, label: `${EVENT_LABELS[e.type]}${e.days ? ` (${e.days} days)` : ""}${e.outcome ? ` — ${e.outcome.replace(/_/g, " ")}` : ""}` })),
  };
}

/** The dates a template took from the case file, so the view can mark them as calculated. */
export function calculatedDates(cf: CaseFile | undefined, tl: Timeline | undefined): { text: string; label: string }[] {
  if (!cf || !tl) return [];
  const out = new Map<string, string>();
  out.set(longDate(cf.received_date), "Date received, from the case file");
  if (tl.processing.effective_due) out.set(longDate(tl.processing.effective_due), "Decision due, calculated by the deadline engine (s 15(5)(b))");
  for (const k of tl.key_dates) if (!out.has(longDate(k.date))) out.set(longDate(k.date), `${k.label}, calculated (${k.provision})`);
  return [...out].map(([text, label]) => ({ text, label }));
}

/** Resolve every "[n.nn]" Guidelines reference in the texts to its paragraph URL. */
export async function guidelineLinks(corpus: Corpus, texts: string[]): Promise<Record<string, string>> {
  const refs = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(/\[(\d{1,2}\.\d{1,3})\]/g)) refs.add(m[1]);
  if (!refs.size) return {};
  const rows = await corpus.many([...refs].slice(0, 150).map((r) => `gl:${r}`));
  return Object.fromEntries(rows.map((r) => [r.ref, r.url]));
}

export function processView(role: Role, cf: CaseFile | undefined, step: StepDetail | undefined, body: string, links: Record<string, string>): View {
  return {
    kind: "process",
    title: step ? step.title : "Handling an incoming FOI request",
    subtitle: step ? `Step ${step.id}${role === "line_area" ? " · for the line area" : ""}` : role === "line_area" ? "The process, for line-area staff" : "The five stages, from receipt to review",
    role,
    stages: STAGES.map((s) => ({
      id: s.id,
      title: s.title,
      summary: s.summary,
      steps: stepsIn(s.id)
        .filter((st) => st.roles.includes(role))
        .map((st) => ({ id: st.id, title: st.title, purpose: st.purpose })),
    })),
    current: step?.id ?? cf?.stage,
    completed: cf?.completed_steps ?? [],
    step,
    case: cf ? caseStrip(cf) : undefined,
    links,
    caveats: cf ? [CAVEAT_ADVICE, CAVEAT_DATES] : [CAVEAT_ADVICE],
    body,
    filename: fileSlug(cf?.reference, step?.id ?? "foi-process"),
  };
}

export function chargesView(res: ChargesResult, decisionHours: number, cf: CaseFile | undefined, body: string, links: Record<string, string>): View {
  // Show the five free decision hours as a deduction rather than folded into the line.
  const lines = res.lines.flatMap((l) =>
    l.provision === "Sch 1 Pt 1 item 4"
      ? [
          { item: "Decision-making", provision: l.provision, quantity: `${decisionHours} h`, rate: "$20.00/h", amount: Math.round(decisionHours * 2000) / 100 },
          { item: "Less: first 5 hours free", provision: l.provision, quantity: `${res.free_decision_hours} h`, rate: "$20.00/h", amount: -res.free_decision_hours * 20 },
        ]
      : [l],
  );
  return {
    kind: "charges",
    title: `Charges — preliminary assessment${cf?.reference ? ` for ${cf.reference}` : ""}`,
    subtitle: "FOI (Charges) Regulations 2019, Schedule 1 · for a s 29(1) notice",
    lines,
    total: res.total,
    deposit_maximum: res.deposit_maximum,
    deposit_rule: res.deposit_rule,
    barred_by: res.barred_by,
    notes: res.notes,
    waiver: res.waiver_considerations,
    case: cf ? caseStrip(cf) : undefined,
    links,
    caveats: ["A preliminary assessment only: charges are discretionary, and the applicant may contest them (s 29(1)(f)).", CAVEAT_ADVICE],
    body,
    filename: fileSlug(cf?.reference, "charges-assessment"),
  };
}
