/**
 * Every citation in the curated layer resolves to the bundled corpus: a `read` id,
 * an exemption's Guidelines range and key paragraphs, and each "[x.y]" and "s N"
 * mentioned in checklists, pitfalls, templates and worksheets.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import passages from "../data/content/passages.json";
import { must } from "../src/guards.ts";
import { normaliseRef } from "../src/corpus.ts";
import { MATRIX_BASIS, MATRIX_CAUTION, MATRIX_NEXT, MATRIX_TESTS, type MatrixRow, assessRow, lean, matrixMarkdown, summarise } from "../src/domain/evidence-matrix.ts";
import { EXEMPTIONS } from "../src/domain/exemptions.ts";
import { GUIDELINES_AGAINST, WEIGHING_STEPS } from "../src/domain/public-interest.ts";
import { estimateCharges } from "../src/domain/charges.ts";
import { DECISION_TYPES } from "../src/domain/decision-notices.ts";
import { REVIEW_RIGHTS, TEMPLATES, renderTemplate } from "../src/domain/templates.ts";
import { estimateWorkload } from "../src/domain/workload.ts";
import { STEPS } from "../src/domain/workflow.ts";

const ids = new Set(z.array(z.object({ id: z.string(), parent: z.string() })).parse(passages).flatMap((p) => [p.id, p.parent]));
const has = (id: string) => ids.has(id);

function citations(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\[(\d{1,2}\.\d{1,3}[A-Z]?)\](?:\s*[–-]\s*\[\s*(\d{1,2}\.\d{1,3})\])?/g)) {
    out.push(`gl:${m[1]}`);
    if (m[2]) out.push(`gl:${m[2]}`);
  }
  // Bare Act sections: "s 15(2)", "ss 27(7)", "s 47F". Regulations are cited "Charges Regs s 7".
  for (const m of text.matchAll(/(Charges Regs )?\bs{1,2} (\d{1,3}[A-Z]{0,2})\b/g)) out.push(m[1] ? `regs:s${m[2]}` : `act:s${m[2]}`);
  return out;
}

describe("workflow", () => {
  it("has unique step ids and valid next links", () => {
    const stepIds = new Set(STEPS.map((s) => s.id));
    expect(stepIds.size).toBe(STEPS.length);
    for (const s of STEPS) for (const n of s.next) expect(stepIds.has(n), `${s.id} → ${n}`).toBe(true);
  });

  it("reads only passages that exist", () => {
    for (const s of STEPS) for (const id of s.read) expect(has(id), `${s.id} reads ${id}`).toBe(true);
  });

  it("cites only provisions and paragraphs that exist", () => {
    for (const s of STEPS) {
      const text = [s.purpose, s.when ?? "", ...s.checklist.map((c) => c.text), ...s.pitfalls, ...(s.line_area ?? [])].join("\n");
      for (const id of citations(text)) expect(has(id), `${s.id} cites ${id}`).toBe(true);
    }
  });
});

describe("exemptions", () => {
  it("point at real Guidelines ranges and paragraphs", () => {
    for (const e of EXEMPTIONS) {
      expect(has(`act:s${e.provision}`), `s ${e.provision}`).toBe(true);
      expect(has(e.guidelines.from), e.guidelines.from).toBe(true);
      expect(has(e.guidelines.to), e.guidelines.to).toBe(true);
      for (const p of e.key_paragraphs) expect(has(p), `${e.provision} → ${p}`).toBe(true);
      const text = [e.summary, ...e.elements, ...(e.carve_outs ?? []), e.harm_test ?? "", e.consultation ?? "", ...e.pitfalls].join("\n");
      for (const id of citations(text)) expect(has(id), `s ${e.provision} cites ${id}`).toBe(true);
    }
  });
});

describe("templates, worksheets and calculators", () => {
  it("cite real provisions", () => {
    const cf = { reference: "X", received_date: "2026-11-02", events: [] };
    const rendered = [
      ...TEMPLATES.map((t) => renderTemplate(t.id, cf, undefined).text),
      ...DECISION_TYPES.map((decision_type) => renderTemplate("statement_of_reasons", cf, undefined, { decision_type }).text),
    ];
    // In the decision notices, a slot's hint must not contain "]", or the slot is not recognised as one.
    const notices = [
      ...(["document_schedule", "practical_refusal_decision", "internal_review_decision", "revised_decision_s55G"] as const).map((id) => renderTemplate(id, cf, undefined).text),
      ...DECISION_TYPES.map((decision_type) => renderTemplate("statement_of_reasons", cf, undefined, { decision_type }).text),
    ];
    for (const text of notices) expect(text.replace(/\[\[[^\]]+\]\]/g, "")).not.toContain("[[");
    const charges = estimateCharges({ search_hours: 3, decision_hours: 8 });
    const work = estimateWorkload({ documents_in_scope: 500, sample_documents: 20, search_hours: 10, sample_examine_minutes: 120 });
    const text = [
      REVIEW_RIGHTS,
      ...rendered,
      ...TEMPLATES.flatMap((t) => [...t.provisions, ...t.must_include]),
      ...WEIGHING_STEPS,
      ...GUIDELINES_AGAINST,
      ...charges.notes,
      ...charges.waiver_considerations,
      must(estimateCharges({ documents_contain_applicants_personal_information: true }).barred_by, "personal information bar"),
      must(estimateCharges({ decision_late: true }).barred_by, "late decision bar"),
      ...work.cautions,
      ...work.must_consider,
      ...work.must_not_consider,
      ...work.may_consider,
      ...work.revision_suggestions,
      work.evidence_statement,
    ].join("\n");
    for (const id of citations(text)) expect(has(id), id).toBe(true);
  });
});

describe("s 47C evidence matrix", () => {
  const row = (answers: Record<string, string>): MatrixRow => ({ document: "Doc 1", answers, evidence: "" });
  const all = { matter: "yes", process: "yes", factual: "no", operational: "no", excluded: "no" };

  it("cites real provisions and paragraphs", () => {
    const cases: Record<string, string>[] = [all, { ...all, factual: "part" }, { ...all, factual: "intertwined" }, { matter: "no" }, { process: "no" }, { operational: "yes" }, { excluded: "yes" }, { factual: "yes" }, {}];
    const outcomes = cases.map((a) => assessRow(row(a)).reason);
    const text = [MATRIX_BASIS, MATRIX_CAUTION, ...MATRIX_NEXT, ...MATRIX_TESTS.flatMap((t) => [t.provision, t.question, ...t.yes_looks_like, ...t.no_looks_like]), ...outcomes, summarise([row(all)]).text, summarise([row({ matter: "no" })]).text].join("\n");
    for (const id of citations(text)) expect(has(id), id).toBe(true);
  });

  it("says which way the answers point: any one answer can point away from s 47C", () => {
    expect(assessRow(row(all)).status).toBe("towards");
    expect(assessRow(row({ ...all, factual: "intertwined" })).status).toBe("towards");
    expect(assessRow(row({ ...all, factual: "part" })).status).toBe("part");
    expect(assessRow(row({ ...all, matter: "part" })).status).toBe("part");
    for (const change of [{ matter: "no" }, { process: "no" }, { factual: "yes" }, { operational: "yes" }, { excluded: "yes" }]) expect(assessRow(row({ ...all, ...change })).status, JSON.stringify(change)).toBe("away");
  });

  it("colours each answer by which way it points, not by yes or no", () => {
    expect([lean("matter", "yes"), lean("process", "no"), lean("factual", "yes"), lean("factual", "no"), lean("operational", "yes"), lean("excluded", "no")]).toEqual(["towards", "away", "away", "towards", "away", "towards"]);
    expect([lean("matter", "part"), lean("factual", "intertwined"), lean("process", "unsure"), lean("matter", undefined)]).toEqual(["part", "towards", "open", "open"]);
  });

  it("stays open while a test is unanswered or unsure, unless an answer already points away", () => {
    expect(assessRow(row({})).status).toBe("open");
    expect(assessRow(row({ ...all, process: "unsure" })).status).toBe("open");
    expect(assessRow(row({ matter: "yes", process: "yes" })).reason).toMatch(/Purely factual; Operational information; Expert report or final decision/);
    expect(assessRow(row({ matter: "no" })).status).toBe("away");
  });

  it("reports the answers without deciding whether the exemption applies", () => {
    const cases: Record<string, string>[] = [all, { ...all, factual: "part" }, { ...all, factual: "intertwined" }, { matter: "no" }, { factual: "yes" }, {}];
    const said = [...cases.map((a) => `${assessRow(row(a)).label} ${assessRow(row(a)).reason}`), summarise(cases.map(row)).text, matrixMarkdown(cases.map(row))].join("\n");
    expect(said).not.toMatch(/can be claimed|cannot be claimed|criteria of s 47C are met|is exempt\b|s 47C applies/i);
    expect(MATRIX_BASIS).toMatch(/does not decide/);
  });

  it("summarises the rows and points to the public interest test where the answers point towards s 47C", () => {
    const s = summarise([row(all), row({ ...all, factual: "part" }), row({ matter: "no" }), row({})]);
    expect(s.counts).toEqual({ towards: 1, part: 1, away: 1, open: 1 });
    expect(s.text).toMatch(/s 11A\(5\)/);
    expect(summarise([row({ matter: "no" })]).text).toMatch(/does not fit/);
    const md = matrixMarkdown([{ document: "Doc | 1", answers: { ...all, factual: "intertwined" }, evidence: "line\nbreak" }]);
    expect(md).toContain("| Doc / 1 | Yes | Yes | Mixed | No | No | Towards s 47C |");
    expect(md).toContain("- Evidence: line break");
  });
});

describe("charges", () => {
  it("applies Schedule 1 rates, the free 5 decision hours and reg 12 deposits", () => {
    expect(estimateCharges({ search_hours: 1 }).total).toBe(15);
    expect(estimateCharges({ decision_hours: 5 }).total).toBe(0);
    expect(estimateCharges({ decision_hours: 5.5 }).total).toBe(10);
    expect(estimateCharges({ search_hours: 2, decision_hours: 6 }).deposit_maximum).toBe(20); // $50
    expect(estimateCharges({ search_hours: 1 }).deposit_maximum).toBe(0); // $15 ≤ $25
    expect(estimateCharges({ search_hours: 20 }).deposit_maximum).toBe(75); // 25% of $300
    expect(estimateCharges({ supervision_minutes: 31 }).total).toBe(12.5);
    expect(estimateCharges({ copy_pages: 10, transcript_pages: 2 }).total).toBe(52.8);
  });
});

describe("normaliseRef", () => {
  it.each([
    ["s 47F", "act:s47F"],
    ["section 15(5)(b)", "act:s15"],
    ["47F", "act:s47F"],
    ["s 15AA", "act:s15AA"],
    ["[6.123]", "gl:6.123"],
    ["6.123", "gl:6.123"],
    ["para 3.247", "gl:3.247"],
    ["Charges Regs s 7", "regs:s7"],
    ["Part 6", "gl:part6"],
    ["Sch 3", "act:sch3"],
    ["gl:3.33", "gl:3.33"],
  ])("%s → %s", (input, expected) => {
    expect(normaliseRef(input)).toBe(expected);
  });
});
