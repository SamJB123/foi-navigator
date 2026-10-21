/**
 * A practical refusal workload estimate (s 24AA), from a representative sample.
 *
 * The Guidelines expect an evidence-based estimate broken down by the activities in
 * s 24AA(2), from a sample assessed as if deciding access — usually 10–15% of the
 * documents, or fewer for very large sets ([3.209]–[3.211]). The hours are evidence,
 * not the test: there is no threshold ([3.208]); the decision-maker must be satisfied
 * the diversion is both substantial and unreasonable ([3.193], [3.206]–[3.216]).
 */

export type WorkloadInput = {
  documents_in_scope: number;
  pages_in_scope?: number;
  sample_documents: number;
  search_hours: number;
  sample_examine_minutes: number;
  sample_redact_minutes?: number;
  sample_documents_needing_consultation?: number;
  consultation_minutes_each?: number;
  decision_and_notification_hours?: number;
  documents_already_found_exempt?: boolean;
  fte_available_for_foi?: number;
};

export type WorkloadResult = {
  sample_percent: number;
  scale: number;
  lines: { activity: string; provision: string; hours: number; basis: string }[];
  total_hours: number;
  total_days: number;
  fte_weeks?: number;
  cautions: string[];
  must_consider: string[];
  must_not_consider: string[];
  may_consider: string[];
  revision_suggestions: string[];
  evidence_statement: string;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export function estimateWorkload(input: WorkloadInput): WorkloadResult {
  const docs = Math.max(1, input.documents_in_scope);
  const sample = Math.max(1, Math.min(input.sample_documents, docs));
  const scale = docs / sample;
  const pct = r1((sample / docs) * 100);
  const cautions: string[] = [];

  const examine = (input.sample_examine_minutes * scale) / 60;
  const redact = ((input.sample_redact_minutes ?? 0) * scale) / 60;
  const consultDocs = (input.sample_documents_needing_consultation ?? 0) * scale;
  let consult = (consultDocs * (input.consultation_minutes_each ?? 0)) / 60;
  if (input.documents_already_found_exempt && consult > 0) {
    cautions.push("Consultation time is excluded: there is no need to consult third parties about material the agency has already decided is exempt ([3.203]).");
    consult = 0;
  }
  const notify = input.decision_and_notification_hours ?? 0;

  const lines = [
    { activity: "Identifying, locating and collating documents", provision: "s 24AA(2)(a)", hours: r1(input.search_hours), basis: "search estimate for the whole request (keep the search records, [3.211])" },
    { activity: "Examining documents and deciding access", provision: "s 24AA(2)(b)(i)", hours: r1(examine), basis: `${input.sample_examine_minutes} min for ${sample} sampled documents × ${r1(scale)}` },
    { activity: "Consulting third parties", provision: "s 24AA(2)(b)(ii)", hours: r1(consult), basis: consult ? `≈${Math.round(consultDocs)} documents × ${input.consultation_minutes_each} min` : "none" },
    { activity: "Making edited copies (redaction)", provision: "s 24AA(2)(c)", hours: r1(redact), basis: input.sample_redact_minutes ? `${input.sample_redact_minutes} min for the sample × ${r1(scale)}` : "none estimated" },
    { activity: "Notifying the decision (statement of reasons, schedule)", provision: "s 24AA(2)(d)", hours: r1(notify), basis: notify ? "estimate" : "none estimated" },
  ];
  const total = r1(lines.reduce((s, l) => s + l.hours, 0));

  if (pct < 10)
    cautions.push(
      `The sample is ${pct}% of the documents. The Guidelines' previous guidance was 10–15%; a smaller sample can be acceptable for a very large set, but it must be representative — explain why it is ([3.209]).`,
    );
  if (sample < 5) cautions.push("A sample this small is unlikely to be representative of complexity across the documents.");
  cautions.push(
    "Use the actual documents and actual time taken on the sample — not a charges calculator's preset assumptions ([3.210]–[3.211]).",
    "There is no hours threshold: don't treat any figure (e.g. 40 hours) as a ceiling ([3.208]). The estimate is one consideration.",
  );

  const fte = input.fte_available_for_foi;
  const statement =
    `We estimate that processing this request would take about ${total} hours (${r1(total / 7.5)} working days). ` +
    `This is based on ${input.documents_in_scope} documents${input.pages_in_scope ? ` (${input.pages_in_scope} pages)` : ""} identified within scope, and an assessment of a sample of ${sample} documents (${pct}%) reviewed as if making an access decision. ` +
    `The estimate comprises: ${lines.filter((l) => l.hours > 0).map((l) => `${l.activity.toLowerCase()} (${l.provision}) ${l.hours} hours`).join("; ")}. ` +
    (fte ? `The agency has ${fte} FTE available for FOI processing, so this request alone would occupy about ${r1(total / (fte * 37.5))} weeks of that capacity. ` : "") +
    "[[Explain why this diversion would be substantial and unreasonable for this agency — its size and FOI resourcing, the effect on other operations and other FOI work, and any public interest in the documents ([3.201], [3.212]–[3.216]).]]";

  return {
    sample_percent: pct,
    scale: r1(scale),
    lines,
    total_hours: total,
    total_days: r1(total / 7.5),
    fte_weeks: fte ? r1(total / (fte * 37.5)) : undefined,
    cautions,
    must_consider: [
      "The resources needed to identify, locate or collate the documents (s 24AA(2)(a)).",
      "Deciding access, including examining the documents and consulting any person or body (s 24AA(2)(b)).",
      "Making copies or edited copies (s 24AA(2)(c)), and notifying any interim or final decision (s 24AA(2)(d)).",
      "Both elements: the diversion must be substantial AND unreasonable ([3.198], [3.206]–[3.216]); the decision-maker must actually be persuaded ([3.193]).",
    ],
    must_not_consider: [
      "Any reasons the applicant gives for the request, or the agency's belief about those reasons (s 24AA(3)(a)–(b)).",
      "Any maximum charge for a request of that kind (s 24AA(3)(c)).",
      "Poor record-keeping or inefficient filing systems as a ground in themselves ([3.205]).",
    ],
    may_consider: [
      "Staff available for FOI, and whether specialist or senior officers with competing duties are needed ([3.201]).",
      "The impact on other work, including other FOI requests ([3.201]).",
      "Whether the applicant has cooperated in framing the request ([3.201]).",
      "Significant public interest in the documents, or an applicant significantly affected by government decisions, weighs against unreasonableness ([3.216]).",
      "The agency's size and capacity — a large agency may absorb a substantial request ([3.214]–[3.215]).",
      "Two or more requests about the same documents or substantially the same subject may be treated as one (s 24(2), [3.217]–[3.222]), but not after a deemed refusal ([3.220]).",
    ],
    revision_suggestions: [
      "A narrower date range.",
      "Specific business areas, custodians or record systems.",
      "Key words for electronic searches ([3.231]).",
      "Excluding duplicates, drafts, email chains already captured, or media monitoring.",
      "Excluding names and contact details of junior staff, or third parties' personal information, to remove consultation.",
      "Pointing to information already published, or offering administrative release of a summary ([3.231], [3.240]).",
    ],
    evidence_statement: statement,
  };
}
