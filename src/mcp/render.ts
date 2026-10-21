/**
 * Markdown for tool results. Every tool answers twice: this text, which must stand on
 * its own in tools-only clients (Copilot Studio, GitHub's agent), and the same facts as
 * structuredContent for clients that read the output schema or render the MCP App.
 */
import { MANIFEST, type PassageRow, sourceLabel } from "../corpus.ts";
import { type Timeline, longDate } from "../domain/deadlines.ts";
import type { Exemption } from "../domain/exemptions.ts";
import type { Step } from "../domain/workflow.ts";

export const DISCLAIMER =
  "Guidance only, not legal advice. Decisions must be made by an authorised officer (s 23) on the documents and evidence.";

export function sourcesLine(parts: string[] = []): string {
  const act = MANIFEST.legislation.act;
  const gl = MANIFEST.guidelines as Record<string, { version: string; updated: string }>;
  const glText = parts.length
    ? parts
        .filter((p) => gl[p])
        .map((p) => `Part ${p} v${gl[p].version}`)
        .join(", ")
    : "Parts 1–15";
  return `_Sources: FOI Act 1982 (${act.registerId}, in force ${act.inForceFrom}); OAIC FOI Guidelines (${glText}). ${DISCLAIMER}_`;
}

export const partsCited = (ids: string[]) =>
  [...new Set(ids.map((id) => /^gl:(\d+)\./.exec(id)?.[1]).filter((x): x is string => !!x))].sort((a, b) => +a - +b);

const STATUS_ICON: Record<string, string> = {
  met: "✅",
  missed: "❌",
  upcoming: "⏳",
  due_today: "⚠️",
  overdue: "❌",
  info: "•",
};

export function renderTimeline(tl: Timeline): string {
  const lines: string[] = [];
  lines.push(`## ${tl.reference ? `${tl.reference}: ` : ""}${tl.status_label}`);
  const p = tl.processing;
  if (p.effective_due) {
    const left =
      p.days_remaining === null ? "" : p.days_remaining > 0 ? ` — **${p.days_remaining} days remaining**` : p.days_remaining === 0 ? " — **due today**" : "";
    lines.push(`**Decision due: ${longDate(p.effective_due)}**${left} (as at ${longDate(tl.as_of)}).`);
  } else if (p.paused_since) {
    lines.push(`**Clock stopped since ${longDate(p.paused_since)}.** The due date will be recalculated when the stop ends.`);
  }
  lines.push(
    `30 days from ${longDate(tl.received_date)} = ${longDate(p.base_due)}` +
      (p.extension_days ? `; +${p.extension_days} days extension` : "") +
      (p.disregarded_days ? `; +${p.disregarded_days} days disregarded` : "") +
      (p.rolled_from_weekend && p.statutory_due ? `; ${longDate(p.statutory_due)} falls on a weekend, so it moves to the next business day ([3.247])` : "") +
      ".",
  );
  lines.push("", "| Date | | What | Provision |", "|---|---|---|---|");
  for (const k of tl.key_dates) {
    const rem = k.days_remaining !== undefined && k.status === "upcoming" ? ` (${k.days_remaining} days)` : "";
    lines.push(`| ${longDate(k.date)} | ${STATUS_ICON[k.status ?? "info"]} | ${k.label}${rem} | ${k.provision} |`);
  }
  if (tl.adjustments.length) {
    lines.push("", "**Adjustments**");
    for (const a of tl.adjustments) lines.push(`- ${a.applied ? `+${a.days} days` : "Not applied"}: ${a.label} (${a.provision})${a.note ? ` — ${a.note}` : ""}`);
  }
  if (tl.next_actions.length) {
    lines.push("", "**Next**");
    for (const n of tl.next_actions) lines.push(`- ${n}`);
  }
  if (tl.warnings.length) {
    lines.push("", "**Check**");
    for (const w of tl.warnings) lines.push(`- ${w}`);
  }
  return lines.join("\n");
}

export function renderStep(step: Step, role: "officer" | "line_area", excerpts: PassageRow[], tailored: string[]): string {
  const lines: string[] = [];
  lines.push(`## ${step.title}${step.status === "planned" ? " (planned — reference only)" : ""}`);
  lines.push(`_Step \`${step.id}\`_ — ${step.purpose}`);
  if (step.when) lines.push(`**When:** ${step.when}`);
  if (step.status === "planned") {
    lines.push(
      "",
      "> Full guided support for this stage is planned but not yet built. The checklist below covers the essentials and the provisions to read; the deadline calculator already handles this stage's clock effects.",
    );
  }
  if (tailored.length) {
    lines.push("", "**For this request**");
    for (const t of tailored) lines.push(`- ${t}`);
  }
  if (role === "line_area" && step.line_area?.length) {
    lines.push("", "**For the line area**");
    for (const l of step.line_area) lines.push(`- ${l}`);
  }
  const items = step.checklist.filter((c) => !c.roles || c.roles.includes(role));
  lines.push("", "**Checklist**");
  for (const c of items) lines.push(`- [ ] ${c.text}`);
  if (step.pitfalls.length) {
    lines.push("", "**Common errors**");
    for (const p of step.pitfalls) lines.push(`- ${p}`);
  }
  if (excerpts.length) {
    lines.push("", "**What the sources say**");
    for (const e of excerpts) {
      const body = e.text.replace(/\n\n\[\^[\s\S]*$/, "").replace(/\s+/g, " ").slice(0, 420);
      lines.push(`- **${sourceLabel(e)} ${e.ref}** ${e.source === "guidelines" ? "" : `(${e.title}) `}— ${body}${body.length >= 420 ? "…" : ""}`);
    }
  }
  if (step.templates?.length) lines.push("", `**Templates:** ${step.templates.map((t) => `\`${t}\``).join(", ")} (foi_draft_notice)`);
  if (step.next.length) lines.push("", `**Next steps:** ${step.next.map((n) => `\`${n}\``).join(", ")}`);
  return lines.join("\n");
}

export function renderExemption(e: Exemption, sectionText: string | null, keyParas: PassageRow[]): string {
  const lines: string[] = [];
  lines.push(`## s ${e.provision} — ${e.name}`);
  lines.push(
    e.kind === "exempt"
      ? "**Exemption** (Part IV Division 2): no public interest test, but there is a discretion to release (s 3A)."
      : "**Conditional exemption** (Part IV Division 3): if the criteria are met, access must still be given unless it would, on balance, be contrary to the public interest (s 11A(5)) — run foi_public_interest_test.",
  );
  lines.push("", e.summary);
  lines.push("", "**Elements — make a finding on each, with evidence**");
  e.elements.forEach((el, i) => lines.push(`${i + 1}. ${el}`));
  if (e.harm_test) lines.push("", `**Harm threshold:** ${e.harm_test}`);
  if (e.carve_outs?.length) {
    lines.push("", "**Carve-outs and limits**");
    for (const c of e.carve_outs) lines.push(`- ${c}`);
  }
  if (e.consultation) lines.push("", `**Consultation:** ${e.consultation}`);
  if (e.ncnd) lines.push("", "**Neither confirm nor deny:** available where the existence of the document would itself be exempt (s 25).");
  if (e.pitfalls.length) {
    lines.push("", "**Common errors**");
    for (const p of e.pitfalls) lines.push(`- ${p}`);
  }
  if (e.line_area_questions.length) {
    lines.push("", "**Questions for the line area**");
    for (const q of e.line_area_questions) lines.push(`- ${q}`);
  }
  if (sectionText) lines.push("", `**The Act — s ${e.provision}**`, "```", sectionText.slice(0, 3500), "```");
  if (keyParas.length) {
    lines.push("", `**Key Guidelines paragraphs** (Part ${e.guidelines.part}, ${e.guidelines.from.slice(3)}–${e.guidelines.to.slice(3)})`);
    for (const p of keyParas) {
      const body = p.text.replace(/\n\n\[\^[\s\S]*$/, "").replace(/\s+/g, " ").slice(0, 500);
      lines.push(`- **${p.ref}** ${p.title !== p.heading ? `_${p.title}_ ` : ""}— ${body}${body.length >= 500 ? "…" : ""}`);
    }
  }
  return lines.join("\n");
}
