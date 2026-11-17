/**
 * Decision notices, following the structure and wording of the Department of the Prime
 * Minister and Cabinet's FOI templates (released under FOI, reference FOI/2026/081):
 * the notice of decision in its six outcomes, the schedule of documents, the practical
 * refusal decision, the revised decision under s 55G, and the internal review decision.
 *
 * What is changed from the source, so any agency can use them:
 *  - the agency's name, contact address, principal officer and records systems are
 *    slots; "the department" becomes `details.agency_short` (default "the agency");
 *  - "<insert …>" becomes a [[slot]], and an "OPTION … END OPTION" passage becomes an
 *    italic _[Option: …]_ … _[End option]_ pair, or is settled from the case file
 *    where its events answer it (extensions, a deemed refusal, a third-party notice);
 *  - footnotes become citations in the text;
 *  - a few drafting notes in _[brackets]_ are added where the Act or the Guidelines
 *    qualify the source wording. They are instructions to the drafter, to be deleted.
 *
 * Citations are tested to exist by test/content.test.ts.
 */
import type { CaseEvent } from "./case-file.ts";
import { type Ctx, date, dueOf, received, ref, slot } from "./template-helpers.ts";

export const DECISION_TYPES = ["full", "full_irrelevant", "part", "part_s24A", "refuse", "no_documents"] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

const DECISION_LABELS: Record<DecisionType, string> = {
  full: "access in full",
  full_irrelevant: "access in full, with irrelevant material deleted (s 22)",
  part: "access in part (exemptions applied)",
  part_s24A: "access in part, and part of the request refused because documents do not exist or cannot be found (s 24A)",
  refuse: "access refused (documents exempt in full)",
  no_documents: "request refused because documents do not exist or cannot be found (s 24A)",
};

export const DECISION_TYPE_HELP = `details.decision_type selects the outcome: ${DECISION_TYPES.map((t) => `${t} = ${DECISION_LABELS[t]}`).join("; ")}. Default: part`;

const decisionType = (ctx: Ctx): DecisionType => DECISION_TYPES.find((t) => t === ctx.d.decision_type) ?? "part";

// --- shared passages -----------------------------------------------------------------

const agencyName = (ctx: Ctx) => slot(ctx, "agency_name", "agency name");
/** How the notice refers to the agency after first naming it. PM&C's templates say "the department". */
const short = (ctx: Ctx) => ctx.d.agency_short ?? "the agency";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const contact = (ctx: Ctx) => slot(ctx, "foi_contact", "FOI contact email");
const option = (when: string, text: string) => `_[Option: ${when}]_\n\n${text}\n\n_[End option]_`;
const events = (ctx: Ctx, type: CaseEvent["type"]) => (ctx.cf?.events ?? []).filter((e) => e.type === type).sort((a, b) => a.date.localeCompare(b.date));
const eventDate = (ctx: Ctx, type: CaseEvent["type"], hint = "date") => date(events(ctx, type).at(-1)?.date) ?? `[[${hint}]]`;

const header = (ctx: Ctx, title: string) => `**Freedom of Information (FOI) request**

## ${title}

**Reference:** ${ref(ctx)}

${slot(ctx, "decision_date", "decision date")}

To ${slot(ctx, "applicant_name", "applicant name — added by the FOI team, not stored in the case file")}
${slot(ctx, "applicant_details", "position, organisation, and email or postal address")}

Dear ${slot(ctx, "applicant_salutation", "title and surname")}`;

const opening = (ctx: Ctx) => `I refer to your request to ${agencyName(ctx)} (${short(ctx)}) under the *Freedom of Information Act 1982* (the FOI Act), received on ${received(ctx)}.

The purpose of this letter is to notify you of a decision on your request under the FOI Act (section 15(5)(b)).`;

const scopeOfRequest = (ctx: Ctx) => `### Scope of request

You set out your request in the following terms:

> ${slot(ctx, "terms_of_request", "terms of the request, as the applicant wrote them")}

${option(
  "the request was revised. Use this in place of the paragraph above",
  `You set out your original request in the following terms:

> [[terms of the original request]]

On [[date the request was revised]], you revised the terms of your request as follows:

> [[terms of the clarified or revised request]]`,
)}`;

/** The extensions are stated from the case file's events where there is one; otherwise they are offered as options. */
function timeframe(ctx: Ctx, extra = ""): string {
  const head = `### Timeframe for making a decision

The FOI Act provides a period of 30 days after the date a request is received to notify a decision unless the period is extended in accordance with the FOI Act ([3.252]).${extra ? `\n\n${extra}` : ""}`;
  const agreed = (d: string) => `On ${d} you agreed to extend the processing period. We thank you for your engagement to maintain the statutory timeframes for processing.`;
  const consult = (d: string, s: string) => `On ${d} ${short(ctx)} notified you the processing period for your request had been extended by the consultation provisions within the FOI Act (section ${s}).`;
  const oaic = (d: string, s: string) => `On ${d} the Office of the Australian Information Commissioner granted ${short(ctx)} an extension of time for the processing of your request under section ${s} of the FOI Act.`;
  const late = (due: string) => `A decision on your request was due ${due}. Unfortunately, ${short(ctx)} was unable to complete the processing of your request by this date. In these circumstances ${short(ctx)} follows the Guidelines issued by the Information Commissioner under section 93A of the FOI Act (the Guidelines), which state:

> Where an access refusal decision is deemed to have been made, the agency or minister is still able to process the request and provide a statement of reasons. ([3.270])`;

  if (!ctx.cf || !ctx.tl) {
    return `${head}

${option("an extension applied. Keep those that did", [agreed("[[date]]"), consult("[[date]]", "15(6)"), oaic("[[date]]", "[[15AB or 15AC]]")].join("\n\n"))}

The statutory due date for notifying you of this decision is ${dueOf(ctx)}.

${option("the decision is out of time. Use this in place of the sentence above", late("[[date the decision was due]]"))}`;
  }
  const said = [
    ...events(ctx, "extension_s15AA").map((e) => agreed(date(e.date) ?? "")),
    ...events(ctx, "extension_s15_6").map((e) => consult(date(e.date) ?? "", "15(6)")),
    ...events(ctx, "extension_s15_8").map((e) => consult(date(e.date) ?? "", "15(8)")),
    ...events(ctx, "extension_s15AB").map((e) => oaic(date(e.date) ?? "", "15AB")),
  ];
  const due = ctx.tl.status === "deemed_refusal" ? late(dueOf(ctx)) : `The statutory due date for notifying you of this decision is ${dueOf(ctx)}.`;
  return [head, ...said, due].join("\n\n");
}

const authorised = (ctx: Ctx, what = "this decision") => `### Authorised decision-maker

I am authorised to make ${what} in accordance with arrangements approved by ${slot(ctx, "principal_officer", "the principal officer, e.g. the Secretary")} of ${short(ctx)} under section 23 of the FOI Act.`;

const guidelines = "Guidelines issued by the Information Commissioner under section 93A of the FOI Act (the Guidelines)";

const searches = (ctx: Ctx) => `### Searches

Searches were conducted by ${slot(ctx, "search_area", "area that searched")} who have knowledge of the subject connected to your request.

${option("other areas were asked", `Inquiries were also made with [[other area]] regarding any records held by their area.`)}

${option("a keyword search was run", `As part of the searches, ${short(ctx)} undertook a keyword search, using terms from your request in its [[records system]].`)}`;

const documentsInScope = (ctx: Ctx) => `### Documents in scope of request

I have identified ${slot(ctx, "document_count", "number")} document(s) that fall within the scope of your request.

These documents are set out in the Schedule of Documents at Attachment A.`;

const irrelevantMatter = (ctx: Ctx, n: number) => `#### ${n}. Deletion of irrelevant matter

Section 22 of the FOI Act provides that an agency may give access to an edited copy of a document where it is reasonably practicable to do so and the edited copy would not disclose information that would reasonably be regarded as irrelevant to the request. In this case, I am satisfied that it is reasonably practicable to prepare edited copies of the documents by deleting material that is irrelevant to the scope of the request.

On ${slot(ctx, "irrelevance_advice_date", "date the applicant was advised")}, ${short(ctx)} advised you that, consistent with its usual FOI practice, it treats certain information as irrelevant to the scope of an FOI request. This includes the personal and direct contact details of officers who are not members of the Senior Executive Service (SES), any Ministerial staff, any person's signature, and the mobile or direct telephone numbers of all officers. I am satisfied this information is reasonably regarded as irrelevant to the terms of your request.

_[Check before using the paragraph above. The Guidelines say public servants' names and contact details will generally be irrelevant under s 22 only if the applicant clearly and explicitly states they do not require them; agency policy, or no response to advice like this, is not consent ([3.166]–[3.167]). They also question treating SES and other officials differently ([3.57]).]_

${option("system-generated headers or footers were deleted", `Some documents contain system-generated headers and/or footers that did not form part of the documents at the date of your request. I consider this information to be irrelevant, and it has been deleted under section 22 of the FOI Act.`)}

I am satisfied that parts of the requested documents are irrelevant under section 22(1)(a)(ii) of the FOI Act and these parts have been deleted.`;

const noDocuments = (ctx: Ctx, n: number, title: string) => `#### ${n}. ${title}

Section 24A(1) of the FOI Act provides:

> An agency or Minister may refuse a request for access to a document if:
> (a) all reasonable steps have been taken to find the document; and
> (b) the agency or Minister is satisfied that the document:
> (i) is in the agency's or Minister's possession but cannot be found; or
> (ii) does not exist.

In determining whether all reasonable steps have been taken to find documents within the scope of your request, I have had regard to the Guidelines, in particular paragraphs [3.144]–[3.145].

The Guidelines explain that agencies are required to undertake reasonable searches based on a flexible and common-sense interpretation of the terms of the request, having regard to the circumstances of the particular request and the agency's normal business practices. What constitutes 'all reasonable steps' does not require searches that are extravagant or excessive, but rather searches that are appropriate and suitable to the purpose and context of the request. The Guidelines explain what constitutes effective searches as:

> Ensuring that the search is conducted by the officers most likely to be able to find requested documents, rather than the FOI officer, will increase the effectiveness of the search. Where officers within the agency may have information about the requested documents they should be consulted, and records kept of their advice. Advising FOI applicants of the relevant business areas that conducted the searches may assure them that all reasonable steps have been taken to identify and retrieve the documents they seek and to assist in their consideration of whether to accept the agency's or minister's initial decision. ([3.152])

Having regard to the subject matter of your request, ${short(ctx)} identified ${slot(ctx, "search_area", "area that searched")} as the business area best placed to identify and locate documents that may fall within scope.

Consistent with usual record-keeping and information management practices of ${short(ctx)}, searches were undertaken in the following locations where documents relevant to your request would reasonably be expected to be held:

${slot(
  ctx,
  "search_locations",
  "locations searched, as a list. For example: the group email account of the business area; officer email accounts within it; the official records management system; the ministerial and parliamentary correspondence system",
)}

These searches were undertaken by the relevant business area who are best placed to know whether documents of the kind requested exist.

As a result of these searches, no documents were found to be in the possession of ${short(ctx)} that fall within the scope of ${slot(ctx, "s24A_scope", "your request / this part of your request")}.

I am satisfied that the searches undertaken were appropriate and suitable in the circumstances, and that ${short(ctx)} has taken all reasonable steps to locate documents within the scope of your request.

I am satisfied that the documents you have requested cannot be found or do not exist, and I have decided to refuse access under section 24A of the FOI Act.`;

const exemptionReasons = (ctx: Ctx, n: number) => `#### ${n}. ${slot(ctx, "exemption_title", "title of the exemption, as in the FOI Act")}

${slot(
  ctx,
  "exemption_reasons",
  "the exemption relied on and the findings of fact for applying it, in plain English, with references to the relevant parts of the Guidelines. Repeat this section for each exemption",
)}`;

const publicInterest = (ctx: Ctx, n: number) =>
  option(
    "a conditional exemption applies (ss 47B–47J). Delete this section otherwise",
    `#### ${n}. Public interest test

The FOI Act requires a conditionally exempt document to be disclosed unless (in the circumstances) its disclosure would, on balance, be contrary to the public interest (section 11A(5)). To determine these circumstances the FOI Act requires me to consider and weigh up the factors for and against disclosure at the time of making the decision.

As I have found material, as per the 'Decision' section of this letter, is conditionally exempt, I am now required to consider the public interest factors.

**Irrelevant factors**

In making my decision I have not considered the irrelevant factors of section 11B(4) of the FOI Act, which are that:

- access to the document could result in embarrassment to the Commonwealth Government, or cause a loss of confidence in the Commonwealth Government
- access to the document could result in any person misinterpreting or misunderstanding the document
- the author of the document was (or is) of high seniority in the agency to which the request for access to the document was made
- access to the document could result in confusion or unnecessary debate.

**Factors favouring access**

I have noted the objects of the FOI Act (section 3) and the factors favouring access in section 11B(3) of the FOI Act. Having regard to the circumstances and the material before me I am satisfied of the following:

${slot(
  ctx,
  "factors_for",
  "the s 11B(3) factors that apply, as a list: access would promote the objects of the FOI Act; access may inform debate on a matter of public importance; access may promote effective oversight of public expenditure; access will provide you with your personal information",
)}

${option(
  "a factor is neutral",
  `I find the following factors neutral in the circumstances, as the material found to be conditionally exempt [[would appear to be of interest to a limited or narrow section of the public / does not offer any insights into public expenditure / does not contain your personal information]].`,
)}

I have also considered the Guidelines, which further discuss the public interest factors for access, and found the following applicable in the circumstances:

${slot(
  ctx,
  "guidelines_factors_for",
  "any further factors favouring access from the Guidelines that apply, as a list. For example: contribute to the administration of justice generally, including procedural fairness; advance the fair treatment of individuals in their dealings with agencies; contribute to innovation and the facilitation of research",
)}

**Factors contrary to the public interest**

The FOI Act requires me to have regard to the Guidelines to work out if disclosure of the conditionally exempt material is contrary to the public interest.

The Guidelines contain a non-exhaustive list of factors against disclosure ([6.233]). In the circumstances I find the following to be relevant:

${slot(
  ctx,
  "factors_against",
  "the factors against disclosure from paragraph 6.233 of the Guidelines that relate to the reasons the material is exempt, as a list. For example: could reasonably be expected to prejudice the protection of an individual's right to privacy; could reasonably be expected to prejudice an agency's ability to obtain confidential information; could reasonably be expected to prejudice the management function of an agency",
)}

Further, I have considered the nature of the conditionally exempt material, the role and function of ${short(ctx)} in connection to that material, and found the following factors against disclosure to be relevant:

${slot(ctx, "other_factors_against", "any other factors against disclosure, as a list")}

**Public interest findings**

After careful consideration of all the relevant factors, as set out above, I give the greatest weight to ${slot(ctx, "greatest_weight", "the factor of greatest weight, and why")}.

Therefore, I have decided, on balance, the factors against disclosure outweigh those favouring disclosure and I am of the view the disclosure of the conditionally exempt material is contrary to the public interest.`,
  );

function thirdPartyReview(ctx: Ctx): string {
  const notified = events(ctx, "third_party_decision_notice").at(-1);
  const text = `### Third party review rights

${cap(short(ctx))} consulted with ${slot(ctx, "third_parties", "a third party / third parties")} potentially affected by the release of the documents. They have an opportunity to seek a review of my access decision ([3.311]–[3.315]). The time for the third party to apply for an internal or external review is 30 days from the date the access decision is notified to them, being ${notified ? date(notified.date) : "[[date the third party was notified]]"}. The timing of review opportunities is explained in the Guidelines ([3.315], Table 4).

Subject to the outcome of a third party review, access to the documents will be provided after the review time is ended.`;
  return notified ? text : option("a consulted third party objected and the decision is to release", text);
}

function reviewRights(ctx: Ctx, intro: string, internal = true): string {
  const internalReview = `**Internal review**

Under section 54 of the FOI Act, you may apply in writing to ${short(ctx)} for an internal review of my decision. An application for internal review must be made within 30 days after the date of this letter.

Where possible, you should include reasons why you believe the decision should be reviewed. An internal review will be conducted by an officer other than the original decision maker, and a decision will be made within 30 days of ${short(ctx)} receiving your application.

Applications for review should be sent to ${contact(ctx)}.

_[Delete the internal review paragraphs if this decision was made personally by the principal officer or the Minister: internal review is not available (s 54(1)).]_

`;
  return `### Review rights

${intro}

${internal ? internalReview : ""}**Information Commissioner review**

Under section 54L of the FOI Act, you may apply to the Australian Information Commissioner to review my decision. An application for review by the Information Commissioner must be made in writing within 60 days after the date of this letter.

You may apply online using the web form on the Office of the Australian Information Commissioner's website: https://webform.oaic.gov.au/prod?entitytype=ICReview&layoutcode=ICReviewWF`;
}

const complaints = (ctx: Ctx) => `### FOI complaints

If you are dissatisfied with the way ${short(ctx)} has managed your FOI request, you may raise your concerns with ${short(ctx)}. We welcome feedback and may be able to take steps to address your concerns.

If you are not satisfied with the response, you may make a complaint to the Australian Information Commissioner. A complaint to the Information Commissioner must be made in writing. You can lodge a complaint using the web form on the Office of the Australian Information Commissioner's website: https://webform.oaic.gov.au/prod?entitytype=Complaint&layoutcode=FOIComplaintWF

If you wish to discuss any aspect of your request, you may contact the FOI Section by email at ${contact(ctx)}.`;

const signOff = (ctx: Ctx, position = "position, e.g. Assistant Secretary") => `Yours sincerely

${slot(ctx, "decision_maker", "decision-maker's name")}
${slot(ctx, "designation", position)}
${slot(ctx, "branch", "branch")}
${agencyName(ctx)}`;

const DISSATISFIED = "If you are dissatisfied with my decision, you may apply for either an internal review or a review by the Australian Information Commissioner.";
const DISAGREE = "If you disagree with my decision, you may apply for internal review or Information Commissioner review of the decision.";

// --- notice of decision ----------------------------------------------------------------

const exemptionsApplied = (ctx: Ctx) => `**Exemptions applied**

My decision is to apply the following exemptions:

${slot(ctx, "exemptions_summary", "summary of the decision, as a list. For example: Document 1 is exempt under section 33 of the FOI Act; Documents 2–3 are exempt in part under section 47E of the FOI Act")}`;

const refusedParts = (ctx: Ctx) => `**Refused access**

My decision is to refuse access to the following parts of your request under section 24A of the FOI Act:

${slot(ctx, "refused_parts", "the extract of the request that is refused")}`;

const releasedAndDeleted = (ctx: Ctx) => `**Documents released in full**

I have decided to grant access in full to document(s) ${slot(ctx, "documents_released_in_full", "document numbers")}.

In making my decision, I have deleted material that is reasonably regarded as irrelevant to the scope of the request, in accordance with section 22 of the FOI Act. I have also deleted material found to be exempt under the FOI Act. Deletions are marked in the documents by way of redaction and include references to the relevant provisions of the FOI Act that have been applied.

Documents found to be exempt in full have not been released. Information about these documents is set out in the Schedule of Documents.`;

/** The decision and its reasons, for each outcome in the source templates. */
function decisionAndReasons(ctx: Ctx, type: DecisionType): string {
  switch (type) {
    case "full":
      return `### Decision

I have decided to grant access in full to the document(s) identified within the scope of your request.

The document(s) are enclosed.`;
    case "full_irrelevant":
      return `### Decision

I have decided to grant access in full to the document(s) identified within the scope of your request, with irrelevant material deleted. Irrelevant material is deleted under section 22 of the FOI Act.

The document(s) are enclosed.

### Reasons for decision

My findings of fact and reasons for deciding certain information is irrelevant are set out below.

${irrelevantMatter(ctx, 1)}`;
    case "part":
      return `### Decision

I have decided to grant access in part to the document(s) identified within the scope of your request.

${exemptionsApplied(ctx)}

${releasedAndDeleted(ctx)}

### Reasons for decision

My findings of fact and reasons for deciding certain material is exempt or irrelevant are set out below.

${exemptionReasons(ctx, 1)}

${publicInterest(ctx, 2)}

${irrelevantMatter(ctx, 3)}`;
    case "part_s24A":
      return `### Decision

I have decided to grant access in part to the document(s) identified within the scope of your request and refuse access to part of your request on grounds documents did not exist.

${exemptionsApplied(ctx)}

${refusedParts(ctx)}

${releasedAndDeleted(ctx)}

### Reasons for decision

My findings of fact and reasons for deciding certain material is refused, exempt or irrelevant are set out below.

${noDocuments(ctx, 1, "Requests may be refused if documents cannot be found, do not exist or have not been received")}

${exemptionReasons(ctx, 2)}

${publicInterest(ctx, 3)}

${irrelevantMatter(ctx, 4)}`;
    case "refuse":
      return `### Decision

I have decided to refuse access to the document(s) identified within the scope of your request.

${exemptionsApplied(ctx)}

Documents found to be exempt in full have not been released. Information about these documents is set out in the Schedule of Documents.

${option("part of the request is also refused because documents do not exist or cannot be found", refusedParts(ctx))}

### Reasons for decision

My findings of fact and reasons for deciding documents are exempt or refused are set out below.

${option("part of the request is refused under section 24A. Renumber the sections if this is deleted", noDocuments(ctx, 1, "Requests may be refused if documents cannot be found, do not exist or have not been received"))}

${exemptionReasons(ctx, 2)}

${publicInterest(ctx, 3)}`;
    case "no_documents":
      return `### Decision

I have decided to refuse access to your request on the grounds documents cannot be found or do not exist, under section 24A of the FOI Act.

### Reasons for decision

My findings of fact and reasons for deciding to refuse your request for access are set out below.

${noDocuments(ctx, 1, "Documents cannot be found or do not exist")}`;
  }
}

export function noticeOfDecision(ctx: Ctx): string {
  const type = decisionType(ctx);
  const thirdParty = type !== "no_documents";
  const material = [
    "the terms of your request",
    `searches and inquiries undertaken by ${short(ctx)}`,
    ...(type === "no_documents" ? [] : ["the document(s) relevant to your request"]),
    "the FOI Act",
    guidelines,
  ].map((m) => `- ${m}`);
  const consulted = `- the views of a third party consulted by ${short(ctx)}`;
  const which = ctx.d.decision_type
    ? ""
    : `_[This draft is for a decision to give ${DECISION_LABELS[type]}. For another outcome, draft it again with details.decision_type set to one of: ${DECISION_TYPES.join(", ")}.]_\n\n`;
  return [
    which + header(ctx, "Notice of Decision"),
    opening(ctx),
    scopeOfRequest(ctx),
    timeframe(ctx),
    authorised(ctx),
    `### Material taken into account

In reaching my decision I referred to the following:

${material.join("\n")}${thirdParty ? `\n${ctx.cf?.third_parties?.length ? consulted : `${consulted} _[Option: delete if no third party was consulted]_`}` : ""}`,
    ...(type === "no_documents" ? [] : [searches(ctx), documentsInScope(ctx)]),
    decisionAndReasons(ctx, type),
    ...(thirdParty ? [thirdPartyReview(ctx)] : []),
    reviewRights(ctx, type === "full" || type === "full_irrelevant" ? DISSATISFIED : DISAGREE),
    complaints(ctx),
    signOff(ctx),
  ].join("\n\n");
}

// --- schedule of documents -------------------------------------------------------------

export const scheduleOfDocuments = (ctx: Ctx) => `**Freedom of Information (FOI) request**

## Schedule of Documents

**Reference:** ${ref(ctx)}

| Number | Date | Size (pages) | Description (document reference) | Decision on release |
|---|---|---|---|---|
| 1. | ${slot(ctx, "row_date", "date")} | ${slot(ctx, "row_pages", "pages")} | ${slot(ctx, "row_desc", "neutral description, e.g. 'Email from Branch to Minister's Office'")} | ${slot(ctx, "row_decision", "Release in full / Release in part (provisions) / Exempt in full (provisions)")} |

_[Describe documents without disclosing exempt matter ([3.288]; s 26(2)). Use roles, not private individuals' names.]_`;

// --- practical refusal decision (s 24) -------------------------------------------------

export function practicalRefusalDecision(ctx: Ctx): string {
  const noticeDate = eventDate(ctx, "s24AB_notice", "date of the request consultation notice");
  const outcome = events(ctx, "s24AB_outcome").at(-1);
  const revised = `On ${outcome?.outcome === "revised" ? date(outcome.date) : "[[date the request was revised]]"}, you revised your request in the following terms:

> ${slot(ctx, "revised_terms", "revised terms of the request")}`;
  return [
    header(ctx, "Notice of Decision"),
    opening(ctx),
    scopeOfRequest(ctx),
    `### Request consultation process

On ${noticeDate}, ${short(ctx)} wrote to you under section 24AB of the FOI Act as part of a request consultation process. A copy of this notice is at Attachment A.

The purpose of the request consultation process was to notify you of the intention to refuse your request under section 24 of the FOI Act on grounds a practical refusal reason exists in relation to your request. This occurs when the work involved in processing a request would substantially and unreasonably divert the resources of ${short(ctx)} from its usual duties or operations, or the terms of the request were unclear and did not provide sufficient information for ${short(ctx)} to identify the requested documents.

As part of the request consultation process you were invited to revise the terms of your request, and ${short(ctx)} included advice on how you could approach making a revised request.

${outcome?.outcome === "revised" ? revised : option("the applicant revised the request", revised)}`,
    timeframe(
      ctx,
      "The request consultation period is not counted as part of the above processing period: under section 24AB(8), the period from the date you received the notice to the date you revised your request, or indicated that you did not wish to revise it, was not counted when working out the timeframe for making the decision.",
    ),
    authorised(ctx),
    `### Material taken into account

In reaching my decision I have had regard to the following:

- the original terms of your request
- the request consultation notice at Attachment A
- ${slot(ctx, "consultation_response", "the revised request terms of (date) / your advice that you did not agree to revise the terms of your request")}
- searches and inquiries undertaken by ${short(ctx)}
- a sample of documents relevant to the terms of your request
- the FOI Act
- ${guidelines}`,
    `### Decision

I have decided to refuse access under section 24 of the FOI Act.

My decision to refuse your request is made on grounds a practical refusal reason continues to exist under section 24AA of the FOI Act.

### Reasons for decision

My findings of fact and reasons for deciding to refuse your request for access are set out below.

#### 1. Power to refuse request: diversion of resources

Section 24(1) of the FOI Act provides:

> If an agency or Minister is satisfied, when dealing with a request for a document, that a practical refusal reason exists in relation to the request (see section 24AA), the agency or Minister:
> (a) must undertake a request consultation process (see section 24AB); and
> (b) if, after the request consultation process, the agency or Minister is satisfied that the practical refusal reason still exists—the agency or Minister may refuse to give access to the document in accordance with the request.

**Request consultation process**

Before I refuse access, I must be satisfied ${short(ctx)} undertook a request consultation process in accordance with section 24AB of the FOI Act. ${cap(short(ctx))} provided you with a written request consultation notice (Attachment A) which:

- notified you of the intention to refuse access to the request
- clearly identified the practical refusal reason(s) relied upon
- provided contact details to enable you to consult with ${short(ctx)} during the consultation period
- specified the request consultation period, during which you could revise your request or indicate that you did not wish to do so.

I have reviewed the consultation notice and am satisfied that it met the requirements of section 24AB.

**Whether a practical refusal reason continues to exist**

Following completion of the request consultation process, I must now consider whether the practical refusal reason continues to exist.

The request consultation notice was issued because ${short(ctx)} formed the view that your request:

${slot(
  ctx,
  "practical_refusal_reason",
  "the reason(s), as a list: would require a substantial and unreasonable diversion of resources from other operations (section 24AA(1)(a)); and/or did not provide sufficient information to enable an officer to identify the documents sought, as required by section 15(2)(b) (section 24AA(1)(b))",
)}

${slot(
  ctx,
  "steps_after_consultation",
  "a concise description of the steps taken following consultation — consideration of any revised scope, further clarification attempts, sampling exercises or additional searches — and why they did not resolve the practical refusal reason",
)}

${option(
  "the reason is a substantial and unreasonable diversion of resources. Use foi_estimate_workload for the figures",
  `**Substantial and unreasonable diversion of resources**

Following the consultation process, revised searches identified at least [[number]] documents that may fall within the scope of the request. Each document would need to be retrieved and individually assessed for access under the FOI Act.

${cap(short(ctx))} undertook a sampling exercise to estimate the time required to process the request, which included:

- [[X]] minutes per document to retrieve and prepare for assessment
- [[X]] minutes per document or page for decision-making
- [[X]] hours to undertake third party consultation(s) under the FOI Act
- [[X]] hours to undertake consultations with other agencies, as the authors or owners of the information
- [[X]] minutes per document to prepare a schedule of documents.

I have also had regard to the complexity of the documents, noting that they include material such as [[the kinds of material that make them complex, e.g. intertwined personal and third-party business information, confidential material, deliberative content]].

On this basis, ${short(ctx)} estimates that it would take at least [[X]] hours for a single officer to process your request in its current form. This estimate does not include time already spent processing the request prior to refusal.`,
)}

**Assessment of reasonableness**

I acknowledge that processing requests for access to documents is a legitimate and important function of ${short(ctx)}, and that FOI requests may require the reallocation of resources in some circumstances.

However, having regard to the estimated processing time, the complexity of the material, and the other operational responsibilities of ${short(ctx)} (including the processing of other FOI requests), I am satisfied that processing the request in its current form would constitute a substantial and unreasonable diversion of resources from its other operations.

In reaching this view, I have had regard to the public interest in promoting access to government information. I consider, however, that in the circumstances of this request, that interest is outweighed by the competing public interest in ${short(ctx)} being able to perform its ordinary functions without substantial interference.

In reaching this decision I have not had regard to any reasons you gave for your request, or to my belief about your reasons, or to any maximum charge (s 24AA(3)).

For the reasons set out above, I am satisfied that a practical refusal reason continues to exist in relation to your request.

Accordingly, I have decided to refuse your request under section 24 of the FOI Act.

### Assistance to make a revised request

You are welcome to make a new request for access to documents relating to this subject matter.

If you choose to do so, you may wish to have regard to the advice previously provided in the request consultation notice, which was intended to assist you to frame a request that could be processed under the FOI Act. You may wish to consider:

${slot(
  ctx,
  "revision_suggestions",
  "the suggestions that fit, as a list: narrowing the scope to specific categories of documents; reducing the number of third parties whose correspondence is sought; breaking the request into smaller requests submitted over time; reducing the timeframe covered; whether the request is directed to the correct agency",
)}

${cap(short(ctx))} remains willing to assist you, where appropriate, to frame a revised request that would be capable of being processed under the FOI Act.`,
    reviewRights(ctx, DISAGREE),
    complaints(ctx),
    signOff(ctx),
  ].join("\n\n");
}

// --- revised decision during IC review (s 55G) -----------------------------------------

export const revisedDecision = (ctx: Ctx) =>
  [
    `**Freedom of Information (FOI) request**

## Notice of Revised Decision under section 55G of the FOI Act

**Reference:** ${ref(ctx)}

To: ${slot(ctx, "applicant_name", "applicant name — added by the FOI team, not stored in the case file")}
${slot(ctx, "applicant_details", "email address")}

cc: Office of the Australian Information Commissioner, foidr@oaic.gov.au

Dear ${slot(ctx, "applicant_salutation", "title and surname")}

I refer to your request under the *Freedom of Information Act 1982* (the FOI Act) to ${agencyName(ctx)} (${short(ctx)}) of ${received(ctx)}, seeking access to documents in the following terms:

> ${slot(ctx, "terms_of_request", "terms of the request, as the applicant wrote them")}

Your FOI request was ${slot(ctx, "primary_decision", "refused under section XX of the FOI Act / deemed to have been refused")} on ${slot(ctx, "primary_decision_date", "date of the primary decision")}.

On ${slot(ctx, "ic_review_notified", "date")} the Office of the Australian Information Commissioner (OAIC) notified ${short(ctx)} that you applied for Information Commissioner (IC) review of that decision.

The purpose of this letter is to provide you with a revised decision in relation to your FOI request.`,
    `### Section 55G of the FOI Act

Section 55G(1)(a) of the FOI Act provides that after an application is made to the IC for review, an agency or Minister may (at any time during IC review) revoke or vary an access refusal decision to favour the applicant by giving access to a document in accordance with the request.

Section 55G(2) of the FOI Act provides that an agency must notify the IC of the new decision (section 55G(2)(a)) and the revised decision will be the decision under review (section 55G(2)(b)).`,
    `${authorised(ctx, "this revised decision")}

I have reviewed this matter, and consider that I am in a position to grant access ${slot(ctx, "access_granted", "in full / in part")} to documents responsive to your request made under the FOI Act. Accordingly, I have decided to make this revised decision under section 55G of the FOI Act.`,
    `### Documents in scope of request

I have identified ${slot(ctx, "document_count", "number")} documents responsive to your request, using ${slot(ctx, "search_description", "the searches made against the terms of the request")}. I have determined that the documents at issue are suitable for disclosure ${slot(ctx, "access_granted", "in full / in part")}. A schedule detailing my decision on access for each document is provided at Attachment A.`,
    `### Material taken into account

In reaching my decision, I referred to the following:

- your FOI request
- documents identified by ${short(ctx)}
- your request for IC review
- consultation comments received by ${short(ctx)} _[Option: delete if none]_
- the FOI Act
- the ${guidelines}`,
    `### Revised decision and reasons

I have decided to ${slot(ctx, "revised_decision", "grant access in part to the relevant documents, with certain material exempt under section XX and conditionally exempt under section XX of the FOI Act")}. Irrelevant material has been deleted under section 22(1)(a)(ii) of the FOI Act.

${slot(ctx, "reasons", "substantive reasons: for each provision, the findings of fact and why it applies")}

${option(
  "a conditional exemption applies",
  `Having found the material to be conditionally exempt, I am required to apply the public interest test as set out in section 11B of the FOI Act.

**Public interest considerations**

Section 11A(5) of the FOI Act provides that conditionally exempt material must nevertheless be disclosed to the applicant unless its disclosure would, on balance, be contrary to the public interest. In determining whether disclosure would be contrary to the public interest, the FOI Act requires a decision-maker to balance the public interest factors.

As I have decided that certain material within the document is conditionally exempt under section [[conditional exemption]] of the FOI Act, I am now required to consider the public interest factors. In doing so, I have not taken into account the irrelevant factors as set out in section 11B(4) of the FOI Act.

In applying the public interest test, I have noted the objects of the FOI Act (section 3) and the factors favouring access as listed in section 11B(3) of the FOI Act. Having regard to the material before me and the circumstances of the material found to be conditionally exempt, I am satisfied that access would:

[[factors favouring access, as a list]]

The FOI Act does not set out any public interest factors against disclosure and requires agencies to have regard to the Guidelines in order to work out if disclosure would, on balance, be contrary to the public interest (section 11B(5)).

The Guidelines contain a non-exhaustive list of factors that may weigh against disclosure ([6.233]). Having regard to the circumstances of the material found to be conditionally exempt, I am satisfied that disclosure could reasonably be expected to:

[[factors against disclosure, as a list]]

After careful consideration of all relevant factors, I have decided that, on balance, the factors against disclosure outweigh those favouring disclosure. Accordingly, I am of the view that disclosure of the conditionally exempt material would be contrary to the public interest.`,
)}`,
    `### Publication of documents

Under section 11C of the FOI Act, ${short(ctx)} will make arrangements to publish the documents released to you on its FOI disclosure log.

### Review rights

A revised decision does not automatically conclude the IC review. The revised decision will be the decision under review (s 55G(2)(b)). The OAIC will generally consult the applicant as to whether they wish to continue the IC review on the basis of the revised decision.

### Complaints

If you are unhappy with the way we have handled your FOI request, please let us know what we could have done better. If you are not satisfied with our response, you can make a complaint to the Australian Information Commissioner. A complaint to the IC must be made in writing. More information about complaints is available at https://www.oaic.gov.au/freedom-of-information/your-freedom-of-information-rights/freedom-of-information-complaints

If you wish to discuss any aspect of your request, you can contact the FOI Section by email at ${contact(ctx)}.`,
    signOff(ctx),
  ].join("\n\n");

// --- internal review decision (s 54C) --------------------------------------------------

export const internalReviewDecision = (ctx: Ctx) =>
  [
    `**Freedom of Information (FOI) request**

## Internal review decision and reasons under section 54 of the *Freedom of Information Act 1982*

**Reference:** ${ref(ctx)}

To: ${slot(ctx, "applicant_name", "applicant name — added by the FOI team, not stored in the case file")}
${slot(ctx, "applicant_details", "email address")}

Dear ${slot(ctx, "applicant_salutation", "title and surname")}

I refer to your email requesting an internal review of an access refusal decision made under the *Freedom of Information Act 1982* (the FOI Act) by ${agencyName(ctx)} (${short(ctx)}) dated ${eventDate(ctx, "decision_notified", "date of the original decision")}.

Section 54(2) of the FOI Act allows an applicant to apply for internal review of a decision refusing to give access to a document in accordance with the request.`,
    `### Scope of internal review

On ${eventDate(ctx, "internal_review_received", "date of the internal review request")} you set out your request for review in the following terms (extract):

> ${slot(ctx, "review_request", "the internal review request, as the applicant wrote it")}`,
    `### Authorised decision-maker

The FOI Act provides that an agency must arrange for a person (other than the person who made the original decision) to review the decision (s 54C(2)).

I am authorised to make this review decision in accordance with arrangements approved by ${slot(ctx, "principal_officer", "the principal officer, e.g. the Secretary")} of ${short(ctx)} under section 23 of the FOI Act.`,
    `### Internal review decision

I have decided ${slot(ctx, "decision_summary", "to affirm / not to affirm")} the original decision on access. I am satisfied that ${slot(ctx, "reasons_overview", "overview of the reasons")}.

In reaching my decision I referred to the following:

- the terms of your request for internal review
- the original FOI request
- a review of document searches undertaken by ${short(ctx)} in the original FOI request
- the FOI Act
- the ${guidelines}`,
    `### Background

**Original FOI request**

On ${received(ctx)} you made a request under the FOI Act to ${short(ctx)} to seek access to the following:

> ${slot(ctx, "terms_of_request", "terms of the request, as the applicant wrote them, including any revision")}

**Summary of original decision**

Access to the requested documents was refused ${slot(ctx, "original_refusal", "in full / in part")} under ${slot(ctx, "original_provisions", "section(s)")} of the FOI Act on the grounds that ${slot(ctx, "original_grounds", "grounds")}.`,
    `### Reasons for internal review decision

${slot(ctx, "reasons", "reasons: a fresh decision on the merits, with findings of fact, evidence, and the public interest weighing for any conditional exemption")}

${option("there is other information to give", `### Other information\n\n[[other information]]`)}`,
    `${reviewRights(ctx, "If you disagree with my review decision, you may apply for Information Commissioner review of the decision.", false)}

More information about Information Commissioner review is available at https://www.oaic.gov.au/freedom-of-information/reviews-and-complaints/information-commissioner-review/`,
    `### Complaints

If you are unhappy with the way we have handled your FOI request, please let us know what we could have done better. We may be able to rectify the problem. If you are not satisfied with our response, you can make a complaint to the Australian Information Commissioner. A complaint to the Information Commissioner must be made in writing.

More information about complaints is available from the Office of the Australian Information Commissioner at https://www.oaic.gov.au/freedom-of-information/reviews-and-complaints/make-an-foi-complaint/

If you wish to discuss any aspect of your request, you can contact the FOI Section by email at ${contact(ctx)}.`,
    signOff(ctx, "position, e.g. First Assistant Secretary"),
  ].join("\n\n");
