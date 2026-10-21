/**
 * The case file: the client-held record of where a request is up to.
 *
 * Tools return it and take it back, so the server keeps nothing (decision: no
 * server-side case store). It holds dates and procedural facts only — agency
 * reference, never the applicant's name or the documents' content.
 */
import { z } from "zod";

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .describe("A date as YYYY-MM-DD");

export const EVENT_TYPES = [
  "acknowledged",
  "transferred_in",
  "extension_s15_6",
  "extension_s15_8",
  "extension_s15AA",
  "extension_s15AB",
  "s24AB_notice",
  "s24AB_period_extended",
  "s24AB_outcome",
  "charge_notice",
  "charge_contention_received",
  "charge_resolved",
  "decision_notified",
  "third_party_decision_notice",
  "access_given",
  "internal_review_received",
  "internal_review_decided",
  "withdrawn",
] as const;

export const EVENT_LABELS: Record<(typeof EVENT_TYPES)[number], string> = {
  acknowledged: "Acknowledgement sent (s 15(5)(a))",
  transferred_in: "Request transferred in from another agency (s 16)",
  extension_s15_6: "Third-party consultation extension notified, +30 days (s 15(6))",
  extension_s15_8: "Foreign government consultation extension notified, +30 days (s 15(8))",
  extension_s15AA: "Extension agreed in writing with the applicant (s 15AA)",
  extension_s15AB: "Extension granted by the Information Commissioner (s 15AB)",
  s24AB_notice: "Request consultation notice given (s 24AB(2)) — clock stops",
  s24AB_period_extended: "Consultation period extended by written notice (s 24AB(5))",
  s24AB_outcome: "Applicant responded to request consultation (s 24AB(6))",
  charge_notice: "Charge notice given (s 29(1)) — clock stops",
  charge_contention_received: "Applicant contested the charge or sought reduction/waiver (s 29(1)(f)(ii))",
  charge_resolved: "Charge or deposit paid, or charge not imposed (s 31(2))",
  decision_notified: "Decision notified to the applicant (s 26)",
  third_party_decision_notice: "Objecting third party notified of decision to release (ss 26A(3), 27(6), 27A(5))",
  access_given: "Access given to documents",
  internal_review_received: "Internal review application received (s 54B)",
  internal_review_decided: "Internal review decision notified (s 54C)",
  withdrawn: "Request withdrawn",
};

export const caseEvent = z.object({
  type: z.enum(EVENT_TYPES).describe(
    "What happened. Pair clock-stoppers: s24AB_notice with s24AB_outcome; charge_notice with charge_resolved.",
  ),
  date: isoDate.describe("The day it happened (YYYY-MM-DD)"),
  days: z
    .number()
    .int()
    .min(1)
    .max(365)
    .optional()
    .describe("Length in days, for extension_s15AA (≤30 in total), extension_s15AB and s24AB_period_extended"),
  outcome: z
    .enum(["revised", "declined_to_revise", "withdrawn", "paid", "deposit_paid", "not_imposed"])
    .optional()
    .describe("For s24AB_outcome: revised | declined_to_revise | withdrawn. For charge_resolved: paid | deposit_paid | not_imposed"),
  note: z.string().max(300).optional().describe("Short procedural note — no personal information"),
});
export type CaseEvent = z.infer<typeof caseEvent>;

export const caseFile = z
  .object({
    reference: z.string().max(80).optional().describe("The agency's FOI reference, e.g. FOI-2026-0412"),
    received_date: isoDate.describe(
      "The day a request meeting s 15(2) was received (for a transferred request, the day the first agency received it, s 16(5)). Day 1 is the next day.",
    ),
    summary: z
      .string()
      .max(500)
      .optional()
      .describe("One-line description of the documents sought — no applicant names or personal information"),
    own_personal_information: z
      .boolean()
      .optional()
      .describe("True if the applicant seeks only their own personal information (no charges, Charges Regs s 7(1))"),
    third_parties: z
      .array(z.enum(["business", "personal", "state", "foreign"]))
      .optional()
      .describe("Kinds of third party who may need consulting: business (s 27), personal (s 27A), state (s 26A), foreign (s 15(7))"),
    stage: z.string().max(60).optional().describe("The current step id from foi_process_map, e.g. intake.validity"),
    completed_steps: z.array(z.string().max(60)).max(60).optional(),
    events: z.array(caseEvent).max(60).default([]).describe("Procedural events so far, any order"),
    notes: z.array(z.string().max(300)).max(30).optional().describe("Short procedural notes — no personal information"),
  })
  .describe(
    "The client-held case file. Pass back the one the previous tool returned, adding events as they happen. Holds dates and procedural facts only.",
  );
export type CaseFile = z.infer<typeof caseFile>;
