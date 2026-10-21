/**
 * Notice templates: skeletons with the content the Act requires, and slots for the
 * model (and officer) to fill. Mandatory elements — s 26 findings and reasons, review
 * rights, the decision-maker's designation — are fixed text or explicit slots, so a
 * draft cannot silently omit them.
 *
 * Dates come from the deadline engine; nothing here invents a date.
 */
import type { CaseFile } from "./case-file.ts";
import { type Timeline, longDate } from "./deadlines.ts";

export type TemplateId =
  | "acknowledgement"
  | "request_clarification"
  | "extension_s15AA_request"
  | "extension_s15_6_notice"
  | "line_area_tasking"
  | "line_area_sensitivity_response"
  | "document_schedule"
  | "statement_of_reasons"
  | "disclosure_log_entry"
  | "internal_review_decision"
  | "s24AB_notice"
  | "practical_refusal_decision"
  | "s29_charges_notice"
  | "charges_contention_decision"
  | "search_minute"
  | "third_party_consultation"
  | "third_party_decision_notice";

export type Template = {
  id: TemplateId;
  title: string;
  audience: "applicant" | "third_party" | "line_area" | "foi_team" | "public" | "oaic";
  purpose: string;
  provisions: string[];
  must_include: string[];
  body: (ctx: Ctx) => string;
};

type Ctx = { cf?: CaseFile; tl?: Timeline; d: Record<string, string> };

const slot = (ctx: Ctx, key: string, hint: string) => ctx.d[key] ?? `[[${hint}]]`;
const date = (iso?: string | null) => (iso ? longDate(iso) : undefined);
const dueOf = (ctx: Ctx) => date(ctx.tl?.processing.effective_due) ?? "[[decision due date — run foi_calculate_deadlines]]";
const ref = (ctx: Ctx) => ctx.cf?.reference ?? slot(ctx, "reference", "FOI reference");
const received = (ctx: Ctx) => date(ctx.cf?.received_date) ?? "[[date received]]";
const scope = (ctx: Ctx) => ctx.cf?.summary ?? slot(ctx, "scope", "scope of the request, as you understand it");

export const REVIEW_RIGHTS = `## Your review rights

If you disagree with this decision, you can ask for it to be reviewed. You do not have to seek internal review before asking the Information Commissioner.

**Internal review.** Apply in writing within 30 days after the day you were notified of this decision (s 54B of the FOI Act). An officer other than the person who made this decision will make a fresh decision within 30 days (s 54C). Send your application to [[FOI contact email or address]].

**Information Commissioner review.** Apply to the Australian Information Commissioner within 60 days after the day you were notified of this decision (s 54S(1)). You can apply online at www.oaic.gov.au.

**Complaints.** You may complain to the Information Commissioner about how we handled your request (Part VIIB of the FOI Act).`;

export const TEMPLATES: Template[] = [
  {
    id: "acknowledgement",
    title: "Acknowledgement of FOI request",
    audience: "applicant",
    purpose: "Notify receipt within 14 days and set expectations.",
    provisions: ["s 15(5)(a)", "[3.244]"],
    must_include: ["date received", "the decision due date", "a contact officer", "charges notice where charges may apply", "disclosure log notice"],
    body: (ctx) => `**Our reference:** ${ref(ctx)}

Dear ${slot(ctx, "applicant_salutation", "applicant name — added by the FOI team, not stored in the case file")}

## Your request under the Freedom of Information Act 1982

We received your request on ${received(ctx)} for access to:

> ${scope(ctx)}

The FOI Act requires us to notify you of a decision within 30 days. The current due date is **${dueOf(ctx)}**. This date may be extended — for example, if we need to consult third parties (s 15(6)) — and we will tell you if it changes.

${ctx.cf?.own_personal_information ? "As your request is for your own personal information, no charges apply." : "We may impose charges for processing your request (s 29). If we do, we will send you a written estimate before doing the work, and you can ask for the charge to be reduced or waived."}

${slot(ctx, "scope_exclusions", "Optional: proposed exclusions to agree, e.g. duplicates, drafts, or names of junior staff. Delete if none.")}

Information released under the FOI Act may be published on our disclosure log (s 11C), except personal or business information where publication would be unreasonable.

If you have any questions, please contact ${slot(ctx, "contact_officer", "contact officer name and position")} at ${slot(ctx, "contact_details", "email / phone")}.

Yours sincerely,
${slot(ctx, "sender", "name, position")}`,
  },
  {
    id: "request_clarification",
    title: "Assistance to make a valid request / clarify scope",
    audience: "applicant",
    purpose: "Meet the duty to assist (s 15(3)) where a formal requirement is missing or scope is unclear.",
    provisions: ["s 15(2)", "s 15(3)", "[3.36]–[3.57]"],
    must_include: ["what is missing or unclear", "how to fix it", "that the request will be processed once it meets s 15(2)", "if documents are not identified: a s 24AB request consultation is needed before any refusal"],
    body: (ctx) => `**Our reference:** ${ref(ctx)}

## Help with your FOI request

Thank you for your request of ${received(ctx)}. To process it under the FOI Act we need ${slot(ctx, "missing", "what is missing — e.g. an address for notices; or more detail to identify the documents (date range, subject, business area)")}.

${slot(ctx, "suggestions", "Concrete suggestions: e.g. 'emails between the Branch and X between 1 March and 30 June 2026 about Y'")}

You can reply to ${slot(ctx, "contact_details", "contact email")}. ${slot(ctx, "clock_note", "If the request already meets s 15(2), say that the 30-day period has started and clarification does not pause it ([3.250]). If it does not identify the documents, say that we will start a request consultation process under s 24AB before any refusal.")}

Yours sincerely,
${slot(ctx, "sender", "name, position")}`,
  },
  {
    id: "extension_s15AA_request",
    title: "Request for applicant's agreement to extend time (s 15AA)",
    audience: "applicant",
    purpose: "Seek written agreement to extend the processing period by up to 30 days, before it expires.",
    provisions: ["s 15AA", "[3.255]–[3.258]"],
    must_include: ["the number of days sought (≤30 in total)", "why", "the new due date", "that agreement must be in writing", "that the IC will be notified"],
    body: (ctx) => `**Our reference:** ${ref(ctx)}

## Request to extend the time for a decision

Your request is currently due for decision on **${dueOf(ctx)}**. We are asking whether you agree to extend that time by ${slot(ctx, "days", "number of days — 30 or fewer in total across all s 15AA extensions")} days, to ${slot(ctx, "new_due", "new due date")}, because ${slot(ctx, "reason", "the specific reason — e.g. the volume of documents, or consultation needed")}.

If you agree, please reply in writing (an email is fine) before ${dueOf(ctx)}. Under s 15AA of the FOI Act we will notify the Information Commissioner of the extension. If you do not agree, we will continue to process your request within the current timeframe${slot(ctx, "alternative", "; optionally: and may apply to the Information Commissioner for an extension under s 15AB")}.

Yours sincerely,
${slot(ctx, "sender", "name, position")}

---
*After agreement: record an \`extension_s15AA\` event with the days in the case file, and send the written agreement to the OAIC ([3.256]).*`,
  },
  {
    id: "extension_s15_6_notice",
    title: "Notice of extension for third-party consultation (s 15(6))",
    audience: "applicant",
    purpose: "Inform the applicant, as soon as practicable, that the period is extended by 30 days for consultation under ss 26A, 27 or 27A.",
    provisions: ["s 15(6)", "[3.253]"],
    must_include: ["that consultation under s 26A/27/27A is required", "the 30-day extension", "the new due date"],
    body: (ctx) => `**Our reference:** ${ref(ctx)}

## Extension of time to consult

Documents within the scope of your request contain information about ${slot(ctx, "third_party_kind", "a business / another person / a State government")}, and we need to consult them under section ${slot(ctx, "section", "26A / 27 / 27A")} of the FOI Act before making a decision. Under s 15(6), the time to decide your request is extended by 30 days. The new due date is **${slot(ctx, "new_due", "new due date — record extension_s15_6 and rerun foi_calculate_deadlines")}**.

Consultation does not mean the information will be withheld; we will make the decision having considered any submissions.

Yours sincerely,
${slot(ctx, "sender", "name, position")}`,
  },
  {
    id: "line_area_tasking",
    title: "Tasking to a line area (searches and sensitivities)",
    audience: "line_area",
    purpose: "Ask a business area to search for documents and give evidence-based views on sensitivities, by a set date.",
    provisions: ["s 24A", "s 11B(4)", "[3.142]–[3.161]", "[5.15]–[5.18]"],
    must_include: ["scope verbatim", "where to search", "the return date and statutory due date", "how to record the search", "what makes a useful sensitivity view", "the irrelevant factors in s 11B(4)"],
    body: (ctx) => `**FOI reference:** ${ref(ctx)}  ·  **Please respond by:** ${slot(ctx, "return_by", "return date — allow time before the statutory due date")}  ·  **Statutory due date:** ${dueOf(ctx)}

## FOI request — search for documents and views on release

**Scope of the request**
> ${scope(ctx)}

${slot(ctx, "agreed_exclusions", "Agreed exclusions, if any (e.g. duplicates, drafts). Otherwise: 'No exclusions have been agreed.'")}

### 1. Search
Please search all places you hold records about this subject: the records system, email (including archives and the mailboxes of staff who worked on it), shared drives, Teams/chat, and any work notes or phones. Include drafts and attachments unless excluded above.

Record for us: who searched, where, the search terms and date range, and what you found. If you find nothing, tell us what you searched — we may need this for a decision that documents cannot be found (s 24A).

### 2. Your views on release
For any document you think should not be released in full, tell us — page and paragraph:
- **What harm** would release cause, **to whom**, and **how likely** it is (a real and substantial possibility, not a mere risk).
- **The facts** that show it: e.g. an open investigation, a live negotiation, a person's safety, legal advice that hasn't been shared outside the agency.
- Whether any of it is **already public**.

Please **don't** rely on any of these — the FOI Act says they must be ignored (s 11B(4)): embarrassment to the Government or loss of confidence in it; that the document could be misunderstood; that its author is senior; or that it could cause confusion or debate.

Your views are evidence for the authorised decision-maker, who decides what is released.

Contact: ${slot(ctx, "foi_contact", "FOI officer, email")}`,
  },
  {
    id: "line_area_sensitivity_response",
    title: "Line-area response: documents found and views on release",
    audience: "foi_team",
    purpose: "Help a line-area officer give the FOI team a complete search record and specific, evidence-based views.",
    provisions: ["s 24A", "s 11B(4)", "Part 5 and 6 of the Guidelines"],
    must_include: ["search record", "per-document views tied to a harm", "facts and likelihood", "what is public already"],
    body: (ctx) => `**FOI reference:** ${ref(ctx)}  ·  **From:** ${slot(ctx, "line_area", "branch / section")}

## 1. Search record
| Searched by (role) | Where | Terms / date range | Date searched | Found |
|---|---|---|---|---|
| ${slot(ctx, "search_row", "e.g. Director, Policy | Outlook incl. archive | 'Project X' 2025–26 | 3 Nov 2026 | 14 emails")} |

## 2. Documents and views
| Doc | Pages / paras | Proposed treatment | Harm, who is affected, and how likely | Facts / evidence | Already public? |
|---|---|---|---|---|---|
| ${slot(ctx, "view_row", "1 | p 2 para 3 | withhold | would reveal the location of a staff member who has received threats | security incident report of 12 Aug 2026 | no")} |

## 3. Anything else the decision-maker should know
${slot(ctx, "context", "Context that helps the decision-maker — e.g. a decision has since been announced, a negotiation has concluded")}

*Check before sending: none of the reasons above rely on embarrassment, possible misunderstanding, the author's seniority, or causing debate (s 11B(4)).*`,
  },
  {
    id: "document_schedule",
    title: "Schedule of documents",
    audience: "applicant",
    purpose: "Identify each document and the decision on it, without revealing exempt matter.",
    provisions: ["s 26", "s 22", "[3.288]"],
    must_include: ["document number", "date", "neutral description", "pages", "decision (full / part / refused)", "provisions applied"],
    body: (ctx) => `**FOI reference:** ${ref(ctx)}

| No. | Date | Description | Pages | Decision | Provisions |
|---|---|---|---|---|---|
| 1 | ${slot(ctx, "row_date", "date")} | ${slot(ctx, "row_desc", "neutral description, e.g. 'Email from Branch to Minister's Office'")} | ${slot(ctx, "row_pages", "n")} | ${slot(ctx, "row_decision", "Release in full / Release in part / Refuse")} | ${slot(ctx, "row_provisions", "e.g. s 47F, s 22")} |

*Descriptions must not reveal exempt matter (s 26(2)). Use roles, not private individuals' names.*`,
  },
  {
    id: "statement_of_reasons",
    title: "Decision and statement of reasons (s 26)",
    audience: "applicant",
    purpose: "Notify the decision with findings of fact, evidence, reasons, the decision-maker, and review rights.",
    provisions: ["s 26", "s 23", "[3.281]–[3.300]", "[6.237]"],
    must_include: [
      "the decision on each document or part (s 26(1))",
      "findings on material questions of fact and the evidence for them",
      "reasons, with the provisions quoted",
      "public interest factors and their weight for conditional exemptions (s 26(1)(aa))",
      "grounds for s 22 deletions",
      "name and designation of the decision-maker and their s 23 authority (s 26(1)(b))",
      "review and complaint rights",
      "disclosure log notice",
    ],
    body: (ctx) => `**Our reference:** ${ref(ctx)}

## Decision on your request under the Freedom of Information Act 1982

### Your request
On ${received(ctx)} you requested:
> ${scope(ctx)}

${slot(ctx, "process_history", "Any revisions to scope, extensions (s 15(6), s 15AA, s 15AB), consultations and charges, with dates")}

### Decision
I am an officer authorised under s 23 of the FOI Act to make decisions on FOI requests. I have decided to ${slot(ctx, "decision_summary", "grant access in full / grant access in part / refuse access")} to the ${slot(ctx, "document_count", "number")} documents within scope, as set out in the attached schedule.

### Material taken into account
${slot(ctx, "material", "The documents; the FOI Act; the FOI Guidelines; consultation responses; line-area submissions; search records — describe each so it can be identified ([3.290])")}

### Findings of fact and reasons
${slot(ctx, "per_exemption_reasons", "For each provision applied: quote the provision, state the findings of fact on each element with the evidence for each, and explain why the provision applies to the specific documents or parts ([3.287]–[3.294]).")}

### Public interest test (conditionally exempt material)
${slot(ctx, "public_interest", "For each conditional exemption: the factors favouring access (including s 11B(3)), the factors against, a statement that no s 11B(4) irrelevant factor was considered, the weight given to each, and why on balance access would be contrary to the public interest at this time ([6.237]). Use foi_public_interest_test.")}

### Deletions (s 22)
${slot(ctx, "deletions", "The grounds for each deletion, including any irrelevant material and why ([3.297]).")}

${REVIEW_RIGHTS}

## Disclosure log
${slot(ctx, "disclosure_log", "If the released documents will be published on our disclosure log (s 11C), say so; note personal and business information will not be published where unreasonable.")}

Yours sincerely,

${slot(ctx, "decision_maker", "decision-maker's name")}
${slot(ctx, "designation", "position / designation")}
${slot(ctx, "decision_date", "date")}`,
  },
  {
    id: "disclosure_log_entry",
    title: "Disclosure log entry",
    audience: "public",
    purpose: "Publish information released, within 10 working days after access is given.",
    provisions: ["s 11C", "[14.39]–[14.50]"],
    must_include: ["FOI reference", "date access given", "a description of what was released", "how to obtain it", "any charge for non-download access (s 11C(5))"],
    body: (ctx) => {
      const access = ctx.cf?.events?.find((e) => e.type === "access_given")?.date;
      const logBy = ctx.tl?.key_dates.find((k) => k.id === "disclosure_log_by")?.date;
      return `| FOI reference | Date of access | Description | Documents |
|---|---|---|---|
| ${ref(ctx)} | ${date(access) ?? "[[date access given]]"} | ${slot(ctx, "description", "Plain description of what was released — what the documents are about, not just the request wording")} | ${slot(ctx, "link", "download link, or how to obtain")} |

*Publish by ${date(logBy) ?? "[[10 working days after access — record access_given]]"} (s 11C(6)). Exclude personal or business information where publication would be unreasonable (s 11C(1)).*`;
    },
  },
  {
    id: "internal_review_decision",
    title: "Internal review decision",
    audience: "applicant",
    purpose: "A fresh decision by a different officer within 30 days of the application.",
    provisions: ["s 54C", "s 26", "[9.33]–[9.53]"],
    must_include: ["that the reviewer is not the original decision-maker", "a fresh decision on the merits", "s 26 content", "IC review rights"],
    body: (ctx) => `**Our reference:** ${ref(ctx)}

## Internal review decision

On ${slot(ctx, "ir_received", "date")} you applied for internal review of the decision of ${slot(ctx, "original_date", "date")} on your FOI request. I am authorised to conduct internal reviews and I was not involved in the original decision (s 54C(2)). I have made a fresh decision.

### Decision
${slot(ctx, "decision_summary", "Affirm / vary / set aside, and the outcome for each document")}

### Findings and reasons
${slot(ctx, "reasons", "As for a s 26 statement of reasons: findings of fact, evidence, reasons, and public interest weighing for conditional exemptions")}

## Your review rights
You may apply to the Australian Information Commissioner for review of this decision within 60 days after the day you are notified of it (s 54S(1)), at www.oaic.gov.au. You may also complain to the Information Commissioner about how we handled your request.

Yours sincerely,
${slot(ctx, "decision_maker", "name")}, ${slot(ctx, "designation", "designation")}`,
  },
];

TEMPLATES.push(
  {
    id: "s24AB_notice",
    title: "Request consultation notice (s 24AB)",
    audience: "applicant",
    purpose: "Tell the applicant the agency intends to refuse for a practical refusal reason, and open the 14-day consultation period.",
    provisions: ["s 24AB(2)", "[3.225]–[3.231]"],
    must_include: [
      "the intention to refuse access",
      "the practical refusal reason (s 24AA(1)(a) or (b))",
      "the name of the contact person and how to contact them",
      "that the consultation period is 14 days after the day the notice is given",
      "the evidence: estimated time by activity",
      "suggestions for a revised request",
      "the three options (withdraw, revise, decline to revise) and the effect of not responding",
    ],
    body: (ctx) => {
      const deemed = ctx.tl?.status === "deemed_refusal";
      return `**Our reference:** ${ref(ctx)}

## Notice of intention to refuse your request — request consultation

Thank you for your request of ${received(ctx)} for:
> ${scope(ctx)}

I intend to refuse your request because a practical refusal reason exists under s 24AA of the FOI Act: ${slot(ctx, "reason", "the work involved in processing the request would substantially and unreasonably divert the resources of the agency from its other operations (s 24AA(1)(a)) / the request does not provide enough information to identify the documents (s 24AA(1)(b))")}.

### Why
${slot(ctx, "evidence", "For s 24AA(1)(a): the number of documents found, the sample assessed, and the estimated hours for searching, examining, consulting, redacting and notifying (paste the evidence statement from foi_estimate_workload), and why that would be substantial and unreasonable for this agency. For s 24AA(1)(b): what is unclear and why the documents cannot be identified.")}

### How we can help you revise your request
Before I make a decision, you have an opportunity to consult with us to revise your request so that this reason no longer exists. For example, you could:
${slot(ctx, "suggestions", "- limit the request to [date range]\n- limit it to [business area / custodians / record system]\n- exclude duplicates, drafts and email chains\n- exclude names and contact details of junior staff\n- use key words such as …")}

Your contact person is **${slot(ctx, "contact_officer", "name and position — available for the whole period")}**, ${slot(ctx, "contact_details", "phone and email")}.

### What you need to do
The consultation period is **14 days after the day you receive this notice**. Before the end of that period, please tell us in writing that you:
1. withdraw your request; or
2. revise your request; or
3. do not wish to revise your request.

${
  deemed
    ? "_[Deemed refusal case: do not say the request will be treated as withdrawn if there is no response, and the processing time is not paused ([3.229]). Delete this line.]_"
    : "If you do not contact the contact person during the consultation period, or do not respond in writing by its end, your request will be taken to have been withdrawn (s 24AB(7)). The time taken for this consultation is not counted in the time we have to decide your request (s 24AB(8))."
}

Yours sincerely,
${slot(ctx, "sender", "name, position")}

---
*Record \`s24AB_notice\` (date given) in the case file; the clock stops. Record \`s24AB_outcome\` when the applicant responds.*`;
    },
  },
  {
    id: "practical_refusal_decision",
    title: "Decision to refuse for a practical refusal reason (s 24)",
    audience: "applicant",
    purpose: "Refuse access under s 24(1)(b) after a request consultation process, with the evidence and reasons s 26 requires.",
    provisions: ["s 24", "s 24AA", "s 26", "[3.192]–[3.234]"],
    must_include: [
      "the history of the request consultation process",
      "the practical refusal reason, with the estimate broken down by s 24AA(2) activity and how it was derived (sample, searches)",
      "why the diversion is substantial and why it is unreasonable",
      "that s 24AA(3) matters were not considered",
      "the decision-maker's name, designation and authority",
      "review rights",
    ],
    body: (ctx) => `**Our reference:** ${ref(ctx)}

## Decision on your request under the Freedom of Information Act 1982

On ${received(ctx)} you requested:
> ${scope(ctx)}

On ${slot(ctx, "s24AB_date", "date")} we gave you a notice under s 24AB of the FOI Act and invited you to consult with ${slot(ctx, "contact_officer", "contact person")} to revise your request. ${slot(ctx, "consultation_history", "What happened: e.g. 'You contacted us on … and revised your request to … / indicated you did not wish to revise it.' Include the assistance offered.")}

### Decision
I am an officer authorised under s 23 of the FOI Act. I am satisfied that a practical refusal reason still exists in relation to your ${slot(ctx, "request_kind", "revised")} request, and I have decided to refuse access under s 24(1)(b).

### Findings and reasons
${slot(ctx, "findings", "The number of documents within scope and how that was established (searches, records kept); the sample assessed (size, %, by whom); the estimated time for each activity in s 24AA(2) — identifying, locating and collating; examining and deciding; consulting; making edited copies; notifying — and the total.")}

${slot(ctx, "substantial_unreasonable", "Why the work is substantial (ordinary meaning, [3.207]) and why it is unreasonable: the agency's size and FOI resourcing, the impact on other operations and other FOI requests, any public interest in the documents ([3.201], [3.212]–[3.216]).")}

In reaching this decision I have not had regard to any reasons you gave for your request, or to my belief about your reasons, or to any maximum charge (s 24AA(3)).

${REVIEW_RIGHTS}

Yours sincerely,

${slot(ctx, "decision_maker", "decision-maker's name")}
${slot(ctx, "designation", "position / designation")}`,
  },
  {
    id: "s29_charges_notice",
    title: "Notice of charge — preliminary assessment (s 29(1))",
    audience: "applicant",
    purpose: "Notify the applicant that they are liable to pay a charge, with every element s 29(1) requires.",
    provisions: ["s 29(1)", "Charges Regs ss 9, 12", "[4.54]–[4.57]"],
    must_include: [
      "that the applicant is liable to pay a charge (s 29(1)(a))",
      "the preliminary assessment and its basis (s 29(1)(b))",
      "the right to contend it is wrongly assessed, or should be reduced or not imposed (s 29(1)(c))",
      "the s 29(5) matters: financial hardship and the public interest (s 29(1)(d))",
      "any deposit (s 29(1)(e))",
      "the 30-day response options (s 29(1)(f))",
      "that no response means the request is taken to be withdrawn (s 29(1)(g))",
    ],
    body: (ctx) => `**Our reference:** ${ref(ctx)}

## Notice of charge for your FOI request

I have decided that you are liable to pay a charge for processing your request of ${received(ctx)} (s 29(1)(a) of the FOI Act; s 8 of the Freedom of Information (Charges) Regulations 2019).

### Preliminary assessment
The preliminary assessment of the charge is **${slot(ctx, "total", "$ total")}**, calculated as follows:

${slot(ctx, "charge_breakdown", "Paste the line items from foi_estimate_charges: search and retrieval hours at $15/hour; decision-making hours at $20/hour after the first 5 hours (which are free); copies, etc.")}

This is based on ${slot(ctx, "basis", "the number of documents identified, where they are held, and a sample of N documents reviewed / experience with similar requests")}.

### Deposit
${slot(ctx, "deposit", "You are required to pay a deposit of $X before we continue processing your request (s 29(1)(e); Charges Regs s 12). / No deposit is required.")}

### Your options
Within **30 days** after you receive this notice, you must tell us in writing that you:
1. agree to pay the charge (paying the charge or deposit is enough); or
2. contend that the charge has been wrongly assessed, or should be reduced or not imposed, giving your reasons; or
3. withdraw your request.

If you do not respond within 30 days, your request will be taken to have been withdrawn (s 29(2)).

In deciding whether to reduce or not impose the charge, I must take into account whether payment would cause you (or anyone on whose behalf you applied) financial hardship, and whether giving access is in the general public interest or in the interest of a substantial section of the public (s 29(5)). I can also consider other relevant matters. If you claim financial hardship, please provide some evidence, such as a concession card or pension statement. If you rely on the public interest, please explain who would benefit from release and how.

You may contest the charge even after paying it. The time to process your request stops from the day you receive this notice until you pay the charge or deposit, or we decide not to impose it (s 31). You must pay any charge before you are given access (Charges Regs s 11). A deposit is refunded only if the charge is not imposed, is reduced below the deposit, or we do not decide in time (Charges Regs s 12).

${slot(ctx, "payment_options", "How to pay")}

Yours sincerely,
${slot(ctx, "sender", "name, position")}

---
*Record \`charge_notice\` (date given) in the case file; the clock stops. Record \`charge_contention_received\` or \`charge_resolved\` when the applicant responds.*`,
  },
  {
    id: "charges_contention_decision",
    title: "Decision on a charges contention (s 29(4)–(9))",
    audience: "applicant",
    purpose: "Decide whether to reduce or not impose a charge, with reasons and review rights, within 30 days of the contention.",
    provisions: ["s 29(4)–(9)", "[4.95]–[4.117]"],
    must_include: [
      "the contention and the material considered",
      "findings on financial hardship (s 29(5)(a))",
      "findings on the general public interest or a substantial section of the public (s 29(5)(b))",
      "other matters considered",
      "the decision and the amount payable, justifying any partial reduction",
      "the decision-maker's name and designation (s 29(9))",
      "review and complaint rights (s 29(9))",
    ],
    body: (ctx) => `**Our reference:** ${ref(ctx)}

## Decision on your contention about charges

On ${slot(ctx, "contention_date", "date")} you contended that the charge of ${slot(ctx, "original_charge", "$ amount")} notified on ${slot(ctx, "notice_date", "date")} ${slot(ctx, "contention_kind", "was wrongly assessed / should be reduced / should not be imposed")}, because ${slot(ctx, "applicant_reasons", "summary of the applicant's reasons")}.

### Decision
I am authorised under s 23 of the FOI Act. I have decided that ${slot(ctx, "decision", "the charge is not imposed / the charge is reduced to $X / the charge of $X stands")}.

### Reasons
**Assessment.** ${slot(ctx, "assessment", "Whether the charge was correctly calculated under the Act and Charges Regulations ([4.95]).")}

**Financial hardship (s 29(5)(a)).** ${slot(ctx, "hardship", "The evidence provided and the finding ([4.101]–[4.104]). If hardship is shown, it may be difficult to justify any charge.")}

**Public interest (s 29(5)(b)).** ${slot(ctx, "public_interest", "Whether giving access is in the general public interest or of a substantial section of the public: the public or section identified, the topic's currency and significance, what is already public, and how a benefit would flow; the volume and cost compared with the subject matter ([4.105]–[4.112]).")}

**Other matters.** ${slot(ctx, "other_matters", "Any other relevant matter, including whether release would advance the objects of the FOI Act ([4.96]–[4.99], [4.114]).")}

${slot(ctx, "partial_reduction", "If you accepted hardship or public interest but only reduced the charge: why a charge is still appropriate ([4.100], [4.112]). Otherwise delete.")}

${REVIEW_RIGHTS}

Yours sincerely,

${slot(ctx, "decision_maker", "decision-maker's name")}
${slot(ctx, "designation", "position / designation")}

---
*Due within 30 days of the contention (s 29(6)); otherwise the preliminary assessment is taken to be the decision (s 29(7)). Record \`charge_resolved\` when paid or not imposed.*`,
  },
  {
    id: "search_minute",
    title: "Search minute (record of searches)",
    audience: "foi_team",
    purpose: "Record the searches for documents, so the agency can show all reasonable steps were taken and explain them in the decision.",
    provisions: ["s 24A", "[3.142]–[3.161]"],
    must_include: ["the scope as interpreted", "each search: who, where, terms and parameters, date range, date searched, time taken, results", "backups or archives considered", "records known to be destroyed and under what authority", "limitations"],
    body: (ctx) => `**FOI reference:** ${ref(ctx)}  ·  **Prepared by:** ${slot(ctx, "prepared_by", "name, position")}

## Record of searches

**Scope as interpreted**
> ${scope(ctx)}

${slot(ctx, "interpretation", "How the scope was read and any clarification agreed with the applicant ([3.144], [3.146])")}

| # | Business area / searcher (role) | System or location | Search terms / parameters | Date range | Date searched | Time taken | Results |
|---|---|---|---|---|---|---|---|
| 1 | ${slot(ctx, "row_area", "e.g. Policy Branch, Director")} | ${slot(ctx, "row_system", "e.g. Content Manager; Outlook incl. archive; Teams; work mobile")} | ${slot(ctx, "row_terms", "e.g. 'Project X' OR 'PX'")} | ${slot(ctx, "row_range", "1 Jan–30 Jun 2026")} | ${slot(ctx, "row_date", "date")} | ${slot(ctx, "row_time", "h")} | ${slot(ctx, "row_results", "n documents / nil")} |

**Officers consulted about where documents may be:** ${slot(ctx, "officers_consulted", "roles and what they advised ([3.152])")}

**Backups and archives:** ${slot(ctx, "backups", "searched / not searched and why ([3.154]–[3.156])")}

**Records destroyed or not received:** ${slot(ctx, "destroyed", "what, when, under which records authority ([3.148]); or contractor documents sought under s 6C measures ([3.149])")}

**Limitations:** ${slot(ctx, "limitations", "anything that could not be searched, and why")}`,
  },
  {
    id: "third_party_consultation",
    title: "Third-party consultation letter (s 26A / s 27 / s 27A)",
    audience: "third_party",
    purpose: "Invite a State, business or person to make submissions in support of an exemption contention, without leading them or identifying the applicant.",
    provisions: ["ss 26A, 27, 27A", "[3.86]–[3.101]", "[6.156]–[6.168]", "[6.201]–[6.211]"],
    must_include: [
      "why they are being consulted, and the provision",
      "the documents or parts (edited copy where useful)",
      "an open question: do you object, and why",
      "a request for specific reasons and evidence",
      "a response date, and that a decision may proceed without a response",
      "no veto; the decision rests with the agency",
      "review rights depend on making a submission",
      "the disclosure log",
      "the applicant's identity is not disclosed",
    ],
    body: (ctx) => `**Our reference:** ${ref(ctx)}

Dear ${slot(ctx, "third_party", "name of the person, business, or State agency FOI contact officer")}

## Consultation about a request under the Freedom of Information Act 1982

We have received a request under the FOI Act for access to documents that ${slot(ctx, "connection", "contain information about your business affairs (s 27) / contain personal information about you (s 27A) / originated with or were received from your State government (s 26A)")}. The documents concerned are ${slot(ctx, "documents", "description; enclose an edited copy marked to show the relevant parts")}.

Before we decide whether to release them, the FOI Act gives you the opportunity to make a submission (s ${slot(ctx, "section", "26A / 27 / 27A")}).

**Do you object to the release of these documents, or parts of them? If so, why?**

Please give specific reasons and any evidence that supports them — for example, what effect release would have on you or your organisation and why. General concerns are difficult to give weight to. ${slot(ctx, "exemption_hint", "Optional, neutral: the provisions that may be relevant are s 47F (personal privacy) / ss 47 and 47G (business information) / s 47B (Commonwealth–State relations); see foi_exemption_guide.")}

Please respond by **${slot(ctx, "respond_by", "date — allow a reasonable time within the extended processing period")}**. If we do not hear from you by then, we may make a decision without your views.

Please note:
- The decision is ours to make. We will consider your submission carefully, but it is not a veto.
- If you make a submission objecting to release and we decide to release anyway, we will tell you, and you will be able to seek review before the documents are released. If you do not make a submission, those review rights do not apply.
- Documents released under the FOI Act are generally published on our disclosure log, unless publishing personal or business information would be unreasonable.
- We cannot tell you who made the request.

Contact: ${slot(ctx, "contact_details", "FOI officer, email, phone")}

Yours sincerely,
${slot(ctx, "sender", "name, position")}

---
*Tell the applicant about the 30-day extension (template extension_s15_6_notice) and record \`extension_s15_6\`.*`,
  },
  {
    id: "third_party_decision_notice",
    title: "Notice to an objecting third party of a decision to release",
    audience: "third_party",
    purpose: "Notify a third party who made a submission that the agency has decided to release, and of their review rights, before any access is given.",
    provisions: ["ss 26A(3), 27(6), 27A(5)", "ss 54A, 54M, 54S(2)", "[3.311]–[3.316]"],
    must_include: [
      "the decision and the documents or parts affected",
      "how their submission was considered and why it was not accepted",
      "that access will not be given until their review opportunities have run out",
      "their internal review and IC review rights and time limits (30 days)",
      "a date by which to tell the agency if they intend to seek review",
      "the decision-maker's name and designation",
    ],
    body: (ctx) => `**Our reference:** ${ref(ctx)}

Dear ${slot(ctx, "third_party", "name")}

## Decision to release documents you were consulted about

Thank you for your submission of ${slot(ctx, "submission_date", "date")}. I am authorised under s 23 of the FOI Act and have decided to give access to ${slot(ctx, "documents", "the documents / parts, described")}.

### Reasons
${slot(ctx, "reasons", "The exemption you contended for, the findings on each element, the weight given to your submission and why, and (for s 47F/47G/47B) the public interest factors and their weight ([6.168], [6.211]).")}

### Your review rights
The documents will **not** be released until your opportunities to seek review have run out (s ${slot(ctx, "section", "26A(4) / 27(7) / 27A(6)")}).
- **Internal review:** apply in writing within 30 days after the day you are notified of this decision (s 54B).
- **Information Commissioner review:** apply within 30 days after the day you are notified of this decision (s 54S(2)) at www.oaic.gov.au.

Please let us know by **${slot(ctx, "intent_by", "date")}** if you intend to seek review. If we have not heard from you and no application has been made by the time your review rights run out, we will release the documents.

Yours sincerely,
${slot(ctx, "decision_maker", "name")}, ${slot(ctx, "designation", "designation")}

---
*Record \`third_party_decision_notice\` (date given): foi_calculate_deadlines shows the earliest release date. Check with the third party about 3 working days before releasing ([3.316]).*`,
  },
);

export const TEMPLATE_BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

export function renderTemplate(id: TemplateId, cf: CaseFile | undefined, tl: Timeline | undefined, details: Record<string, string> = {}) {
  const t = TEMPLATE_BY_ID.get(id);
  if (!t) throw new Error(`No template "${id}"`);
  const text = t.body({ cf, tl, d: details });
  const unfilled = [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
  return { template: t, text, unfilled };
}
