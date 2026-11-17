/**
 * The evidence matrix for s 47C (deliberative processes): documents or passages down,
 * the tests of the conditional exemption across, with the evidence for each row.
 *
 * It is for an FOI officer and a line area to fill in together when it is not obvious
 * whether material is "deliberative". Each cell is an answer the people in the room
 * give; the read-out sets each answer beside its test and says which way it points.
 * It never looks at a document and does not say whether the exemption applies: the
 * assistant walks the user through what the matrix says (see PRESENT.matrix in
 * mcp/tools.ts), and the finding stays with the decision-maker.
 *
 * Pure, and shared by the server (the tool result) and the widget (which re-runs the
 * read-out as cells are edited). Citations are tested to exist by test/content.test.ts.
 */

export type MatrixTestId = "matter" | "process" | "factual" | "operational" | "excluded";

export type MatrixOption = { value: string; label: string };

export type MatrixTest = {
  id: MatrixTestId;
  /** Column heading. */
  heading: string;
  /** The question, in plain English. */
  question: string;
  provision: string;
  yes_looks_like: string[];
  no_looks_like: string[];
  options: MatrixOption[];
};

const YES_NO: MatrixOption[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
];

export const MATRIX_TESTS: MatrixTest[] = [
  {
    id: "matter",
    heading: "Opinion, advice or recommendation?",
    question: "Is this material opinion, advice or recommendation, or a record of consultation or deliberation?",
    provision: "s 47C(1)",
    yes_looks_like: [
      "Opinions, advice and recommendations, including options put forward and views on them ([6.57], [6.59]).",
      "A consultation: an exchange with someone else about the decision being worked through, even if they did not reply ([6.65]–[6.66]).",
      "Interim decisions, and a collection of facts or opinions that shows what was being considered ([6.57]).",
    ],
    no_looks_like: [
      "Content that is merely descriptive, incidental administrative content, or procedural and day-to-day content ([6.62]).",
      "The decision or conclusion reached at the end of the process ([6.62]).",
      "A document's format or label: a brief, a submission or a draft is not deliberative for that reason alone ([6.61]).",
    ],
    options: [
      { value: "yes", label: "Yes" },
      { value: "part", label: "Some of it" },
      { value: "no", label: "No" },
      { value: "unsure", label: "Not sure" },
    ],
  },
  {
    id: "process",
    heading: "Part of a deliberative process?",
    question:
      "Was it obtained, prepared or recorded in the course of, or for the purposes of, the thinking processes of an agency, a minister or the Government: weighing up options towards a decision or course of action?",
    provision: "s 47C(1)",
    yes_looks_like: [
      "Weighing up or evaluating competing arguments or considerations before settling on a course of action ([6.54]).",
      "Policy-making, administering or implementing a policy, and non-policy decision-making such as a code of conduct investigation ([6.56]).",
      "A process that has since stalled or been overtaken by events ([6.64]).",
    ],
    no_looks_like: [
      "Material the agency merely holds about a subject it is responsible for ([6.58]).",
      "Material obtained before anyone knew it would be considered in a deliberative process ([6.63]).",
      "Opinion or advice that was recorded, but not in the course of or for the purposes of a deliberative process ([6.55]).",
    ],
    options: YES_NO,
  },
  {
    id: "factual",
    heading: "Purely factual?",
    question: "Is the material purely factual?",
    provision: "s 47C(2)(b)",
    yes_looks_like: [
      "Facts that can be read apart from the opinion or advice, such as dates, figures and what happened. The exclusion is there so that material used in a deliberative process can be disclosed ([6.67]).",
      "A statement of an ultimate fact, even where the primary facts behind it are not stated ([6.69]).",
    ],
    no_looks_like: [
      "A conclusion involving opinion or judgement, or an assertion of fact that is really an opinion ([6.68]).",
      "Facts that are an integral part of the deliberative content, or so intertwined with it that it is impractical to separate them ([6.70]).",
    ],
    options: [
      { value: "no", label: "No" },
      { value: "part", label: "Some, and it can be separated" },
      { value: "intertwined", label: "Some, but it can't be separated" },
      { value: "yes", label: "Yes, all of it" },
      { value: "unsure", label: "Not sure" },
    ],
  },
  {
    id: "operational",
    heading: "Operational information?",
    question: "Is it operational information: what the agency uses to make decisions or recommendations affecting members of the public, such as its rules, guidelines, practices and precedents?",
    provision: "s 47C(2)(a)",
    yes_looks_like: ["Rules, guidelines, practices and precedents the agency applies in making decisions or recommendations that affect members of the public (s 8A). The agency must publish this information ([6.48])."],
    no_looks_like: ["Advice or options about one particular matter, as opposed to the standing rules or guidance applied to matters of that kind."],
    options: YES_NO,
  },
  {
    id: "excluded",
    heading: "Expert report or final decision?",
    question: "Is it a report of scientific or technical experts, or the record of, or formal statement of reasons for, a final decision?",
    provision: "s 47C(3)",
    yes_looks_like: [
      "A report of scientific or technical experts, including the results of studies, surveys or tests and the experts' opinions on scientific or technical matters ([6.73]–[6.74]).",
      "The record of a final decision, or a formal statement of the reasons for it, given in the exercise of a power or an adjudicative function ([6.49]).",
    ],
    no_looks_like: [
      "Social science is not 'scientific' here: for example economics, history, political science, sociology and psychology ([6.75]).",
      "Interim decisions that are still part of the deliberation ([6.57]).",
    ],
    options: YES_NO,
  },
];

export const MATRIX_TEST_IDS: MatrixTestId[] = MATRIX_TESTS.map((t) => t.id);

export type MatrixRow = {
  /** A label for the document or passage, e.g. "Doc 3, p 2 paras 4–6". Not its content. */
  document: string;
  /** By test id; a test not yet answered has no entry. */
  answers: Record<string, string>;
  /** What in the material, or what known fact, supports the answers. */
  evidence: string;
};

/** Which way a row's answers point: towards s 47C, to part of the material only, away from it, or not answered. */
export type MatrixStatus = "towards" | "part" | "away" | "open";
export type MatrixOutcome = { status: MatrixStatus; label: string; reason: string };

export const STATUS_LABELS: Record<MatrixStatus, string> = {
  towards: "Every answer points towards s 47C",
  part: "The answers point to part of it only",
  away: "An answer points away from s 47C",
  open: "Not answered yet",
};

const outcome = (status: MatrixStatus, reason: string): MatrixOutcome => ({ status, label: STATUS_LABELS[status], reason });
const answered = (v: string | undefined) => v !== undefined && v !== "" && v !== "unsure";

/**
 * Which way one row's answers point, and the answer doing the work. An answer that
 * points away from s 47C settles the row whatever else is blank; otherwise every test
 * must be answered. This reports the answers; it is not a finding.
 */
export function assessRow(row: MatrixRow): MatrixOutcome {
  const a = row.answers;
  if (a.matter === "no") return outcome("away", "Question 1 was answered 'no'. Material that is not deliberative matter cannot be conditionally exempt under s 47C ([6.50]).");
  if (a.process === "no") return outcome("away", "Question 2 was answered 'no'. Opinion or advice must have been obtained, prepared or recorded in the course of, or for the purposes of, a deliberative process ([6.55]).");
  if (a.operational === "yes") return outcome("away", "Question 4 was answered 'yes'. Operational information is not deliberative matter (s 47C(2)(a)).");
  if (a.excluded === "yes") return outcome("away", "Question 5 was answered 'yes'. s 47C does not apply to expert scientific or technical reports, or to the record of or reasons for a final decision (s 47C(3)).");
  if (a.factual === "yes") return outcome("away", "Question 3 was answered 'yes, all of it'. Purely factual material is not deliberative matter (s 47C(2)(b)).");

  const missing = MATRIX_TESTS.filter((t) => !answered(a[t.id]));
  if (missing.length) return outcome("open", `Still to answer: ${missing.map((t) => t.heading.replace(/\?$/, "")).join("; ")}.`);

  if (a.matter === "part" || a.factual === "part") {
    const rest = [a.matter === "part" ? "parts that are not opinion, advice or recommendation" : "", a.factual === "part" ? "purely factual material that can be separated" : ""].filter(Boolean).join(" and ");
    return outcome("part", `The answers describe deliberative matter together with ${rest}. That material can be released in an edited copy (s 22, [6.71]); the public interest test would apply to what remains (s 11A(5)).`);
  }
  if (a.factual === "intertwined")
    return outcome(
      "towards",
      "No answer points away from s 47C. Factual material was said to be impractical to separate from the deliberative content ([6.70]–[6.71]): note why. If the decision-maker accepts these answers, the public interest test comes next (s 11A(5)).",
    );
  return outcome("towards", "No answer points away from s 47C. If the decision-maker accepts these answers on the evidence, the material is conditionally exempt only, and the public interest test comes next (s 11A(5)).");
}

export type MatrixSummary = { counts: Record<MatrixStatus, number>; text: string };

export function summarise(rows: MatrixRow[]): MatrixSummary {
  const counts: Record<MatrixStatus, number> = { towards: 0, part: 0, away: 0, open: 0 };
  for (const r of rows) counts[assessRow(r).status] += 1;
  const n = rows.length;
  if (!n) return { counts, text: "No documents or passages entered yet. Add a row for each one, answer the five questions, and note the evidence." };
  const of = (k: number) => `${k} of ${n}`;
  const parts = [
    counts.towards ? `every answer points towards s 47C for ${of(counts.towards)}` : "",
    counts.part ? `the answers point to part only of ${of(counts.part)}` : "",
    counts.away ? `an answer points away from s 47C for ${of(counts.away)}` : "",
    counts.open ? `${of(counts.open)} ${counts.open === 1 ? "is" : "are"} not answered yet` : "",
  ].filter(Boolean);
  const head = `Across ${n} ${n === 1 ? "row" : "rows"}: ${parts.join("; ")}.`;
  const tail =
    counts.towards + counts.part > 0
      ? " Where the answers point towards s 47C, the next question is the public interest test: access must still be given unless it would, on balance, be contrary to the public interest (s 11A(5))."
      : counts.open === 0
        ? " On these answers s 47C does not fit this material. If there is a real harm in release, check whether another exemption covers it."
        : "";
  return { counts, text: head + tail };
}

/** Shown with every matrix: what it is, and whose finding it is. */
export const MATRIX_BASIS =
  "The matrix records the answers given and sets each beside its test in s 47C. It has not seen the documents and does not decide whether the exemption applies: that is the decision-maker's finding, on the documents and the evidence.";

export const MATRIX_CAUTION =
  "The Guidelines say s 47C should be claimed only in clearly applicable circumstances: not every document held by a policy area is deliberative, even if it deals with developing or implementing a policy ([6.52]).";

export const MATRIX_NEXT = [
  "Where the answers point towards s 47C and the decision-maker accepts them, run the public interest test on that material (foi_public_interest_test, provision 47C). Harm from release is weighed there; s 47C itself has no harm test.",
  "Where they point to part only, prepare an edited copy that releases the rest (s 22, [6.71]).",
  "Where an answer points away from s 47C, ask whether the concern is a harm another exemption covers (foi_exemption_guide).",
  "Keep the evidence column: the statement of reasons needs findings of fact and the evidence for them ([3.289]–[3.291]).",
];

const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
const optionLabel = (t: MatrixTest, value: string | undefined) => t.options.find((o) => o.value === value)?.label ?? "—";

/** The whole matrix as markdown: the table, the read-out, the tests explained, and what comes next. */
export function matrixMarkdown(rows: MatrixRow[]): string {
  const lines = ["## Evidence matrix — s 47C (deliberative processes)", "", summarise(rows).text, "", `_${MATRIX_BASIS}_`, ""];
  lines.push(`| Document or passage | ${MATRIX_TESTS.map((t) => t.heading).join(" | ")} | Evidence | Where the answers point |`);
  lines.push(`|${"---|".repeat(MATRIX_TESTS.length + 3)}`);
  for (const r of rows) {
    const o = assessRow(r);
    lines.push(`| ${cell(r.document) || "—"} | ${MATRIX_TESTS.map((t) => optionLabel(t, r.answers[t.id])).join(" | ")} | ${cell(r.evidence) || "—"} | **${o.label}.** ${o.reason} |`);
  }
  if (!rows.length) lines.push(`| _add a document or passage_ | ${MATRIX_TESTS.map(() => "—").join(" | ")} | — | — |`);
  lines.push("", "### The five questions", MATRIX_CAUTION, "");
  MATRIX_TESTS.forEach((t, i) => {
    lines.push(`**${i + 1}. ${t.heading}** (${t.provision}) ${t.question}`);
    lines.push(...t.yes_looks_like.map((x) => `- A "yes" looks like: ${x}`), ...t.no_looks_like.map((x) => `- A "no" looks like: ${x}`), "");
  });
  lines.push("### What comes next", ...MATRIX_NEXT.map((n) => `- ${n}`));
  return lines.join("\n");
}
