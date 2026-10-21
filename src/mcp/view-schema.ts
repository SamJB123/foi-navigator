/**
 * The shape of structuredContent.view, as a schema: the server builds views against
 * it and the FOI view widget validates what it receives with it, so neither side
 * trusts an unchecked object. Kept free of server imports so the widget can bundle it.
 */
import { z } from "zod";

const text = z.string();
const strings = z.array(z.string());

export const caseStripSchema = z.object({
  reference: text.optional(),
  summary: text.optional(),
  received: text,
  status: text,
  decision_due: text.nullable(),
  days_remaining: z.number().nullable(),
  paused_since: text.nullable(),
  stage: text.optional(),
  stage_title: text.optional(),
  events: z.array(z.object({ date: text, label: text })),
});

const base = {
  title: text,
  subtitle: text.optional(),
  case: caseStripSchema.optional(),
  /** Citation → authoritative URL, for "[6.236]"-style references in the view's text. */
  links: z.record(z.string(), z.string()),
  /** Shown at the foot of every view, whatever the model says. */
  caveats: strings,
  /** The whole result as markdown, for copy and download. */
  body: text,
  filename: text,
};

const chargeLine = z.object({ item: text, provision: text, quantity: text, rate: text, amount: z.number() });
const factor = z.object({ factor: text, side: z.enum(["for", "against"]) });
const idText = z.object({ id: text, text });

export const exemptionSchema = z.object({
  provision: text,
  name: text,
  kind: z.enum(["exempt", "conditional"]),
  summary: text,
  elements: strings,
  carve_outs: strings.optional(),
  harm_test: text.optional(),
  ncnd: z.boolean().optional(),
  consultation: text.optional(),
  guidelines: z.object({ from: text, to: text, part: z.number() }),
  key_paragraphs: strings,
  pitfalls: strings,
  line_area_questions: strings,
  information_types: strings,
});

export const stepDetailSchema = z.object({
  id: text,
  title: text,
  purpose: text,
  when: text.optional(),
  tailored: strings,
  line_area: strings,
  checklist: strings,
  pitfalls: strings,
  templates: strings,
  next: strings,
  excerpts: z.array(z.object({ ref: text, label: text, url: text, text })),
});

export const viewSchema = z.discriminatedUnion("kind", [
  z.object({
    ...base,
    kind: z.literal("draft"),
    template: text,
    audience: text,
    must_include: strings,
    unfilled: strings,
    calculated: z.array(z.object({ text, label: text })),
  }),
  z.object({
    ...base,
    kind: z.literal("charges"),
    lines: z.array(chargeLine),
    total: z.number(),
    deposit_maximum: z.number(),
    deposit_rule: text,
    barred_by: text.optional(),
    notes: strings,
    waiver: strings,
  }),
  z.object({
    ...base,
    kind: z.literal("workload"),
    total_hours: z.number(),
    total_days: z.number(),
    fte_weeks: z.number().optional(),
    sample: text,
    lines: z.array(z.object({ activity: text, provision: text, hours: z.number(), basis: text })),
    evidence_statement: text,
    cautions: strings,
    must_consider: strings,
    must_not_consider: strings,
    may_consider: strings,
    revision_suggestions: strings,
  }),
  z.object({
    ...base,
    kind: z.literal("public_interest"),
    provision: text,
    name: text,
    factors: z.array(factor),
    statutory_for: z.array(idText),
    irrelevant: z.array(idText),
    guidelines_for: strings,
    guidelines_against: strings,
    frankness: text.optional(),
    weighing_steps: strings,
  }),
  z.object({
    ...base,
    kind: z.literal("exemption_list"),
    information: text.optional(),
    matched: z.boolean(),
    candidates: z.array(z.object({ provision: text, name: text, kind: z.enum(["exempt", "conditional"]), summary: text })),
  }),
  z.object({
    ...base,
    kind: z.literal("exemption"),
    exemption: exemptionSchema,
    section_text: text.nullable(),
    key_paragraphs: z.array(z.object({ ref: text, title: text, url: text, text })),
  }),
  z.object({
    ...base,
    kind: z.literal("process"),
    role: z.enum(["officer", "line_area"]),
    stages: z.array(z.object({ id: text, title: text, summary: text, steps: z.array(z.object({ id: text, title: text, purpose: text })) })),
    current: text.optional(),
    completed: strings,
    step: stepDetailSchema.optional(),
  }),
  z.object({
    ...base,
    kind: z.literal("search"),
    query: text,
    mode: text,
    results: z.array(z.object({ id: text, ref: text, source: text, title: text, heading: text, snippet: text, url: text })),
  }),
]);

export type View = z.infer<typeof viewSchema>;
export type CaseStrip = z.infer<typeof caseStripSchema>;
export type StepDetail = z.infer<typeof stepDetailSchema>;
