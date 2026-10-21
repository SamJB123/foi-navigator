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
import { EXEMPTIONS } from "../src/domain/exemptions.ts";
import { GUIDELINES_AGAINST, WEIGHING_STEPS } from "../src/domain/public-interest.ts";
import { estimateCharges } from "../src/domain/charges.ts";
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
    const rendered = TEMPLATES.map((t) => renderTemplate(t.id, { reference: "X", received_date: "2026-11-02", events: [] }, undefined).text);
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
