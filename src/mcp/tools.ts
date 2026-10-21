/**
 * The tools. All are read-only: they hold the law, guidance and calculators, and take
 * the client-held case file as an argument rather than storing anything.
 *
 * Each result is markdown (complete on its own, for tools-only clients) plus the same
 * facts as structuredContent. Two tools carry the timeline MCP App and the rest (bar
 * fetch) the FOI view, so what the user must see doesn't depend on the model relaying
 * it; hosts without MCP Apps get the text, and a short note on what to show from it.
 */
import {
  CLIENT_CAPABILITIES_META_KEY,
  type McpServer,
  type ServerContext,
  acceptedContent,
  inputRequired,
} from "@modelcontextprotocol/server";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { Corpus, type Env, GUIDELINE_PARTS, MANIFEST, normaliseRef, sourceLabel } from "../corpus.ts";
import { isRecord, nonEmpty } from "../guards.ts";
import { type CaseFile, caseFile, isoDate } from "../domain/case-file.ts";
import { computeTimeline, longDate, todayInCanberra } from "../domain/deadlines.ts";
import { EXEMPTIONS, EXEMPTION_BY_PROVISION, normaliseProvision, suggestExemptions } from "../domain/exemptions.ts";
import { FRANKNESS_GUIDANCE, GUIDELINES_AGAINST, GUIDELINES_FOR, IRRELEVANT, STATUTORY_FOR, WEIGHING_STEPS, factorList } from "../domain/public-interest.ts";
import { aud, estimateCharges } from "../domain/charges.ts";
import { TEMPLATES, type TemplateId, renderTemplate } from "../domain/templates.ts";
import { estimateWorkload } from "../domain/workload.ts";
import { STAGES, STEPS, STEP_BY_ID, type Step, stepsIn } from "../domain/workflow.ts";
import { TIMELINE_URI, VIEW_URI } from "./app.ts";
import { partsCited, renderExemption, renderStep, renderTimeline, sourcesLine } from "./render.ts";
import { CAVEAT_ADVICE, CAVEAT_DATES, type StepDetail, type View, calculatedDates, caseStrip, chargesView, fileSlug, guidelineLinks, processView } from "./views.ts";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

type Audience = ("user" | "assistant")[];
type Text = { type: "text"; text: string; annotations?: { audience?: Audience; priority?: number } };
type Result = { content: Text[]; structuredContent: Record<string, unknown>; isError?: boolean };

/**
 * The markdown result, plus (when given) a short note for the assistant. Where the host
 * shows the view, the view carries what the user must see; the note only covers hosts
 * that don't, where a model otherwise tends to paraphrase a draft or a table.
 */
function result(markdown: string, structured: Record<string, unknown>, present?: string): Result {
  const content: Text[] = [{ type: "text", text: markdown, annotations: { audience: ["user", "assistant"] } }];
  if (present) content.push({ type: "text", text: present, annotations: { audience: ["assistant"], priority: 1 } });
  return { content, structuredContent: structured };
}

const IF_NO_VIEW = "If the user can see this result's view, don't repeat it: refer to it and add only what helps. If they can't, ";
const PRESENT = {
  dates: `${IF_NO_VIEW}show the key dates table as given, decision due first. Never recalculate dates. Keep the case file JSON for the next call.`,
  draft: `${IF_NO_VIEW}show the draft in full and word for word, with its [[slots]]. Either way, offer to fill the slots by calling foi_draft_notice again with details.`,
  charges: `${IF_NO_VIEW}show any bar on charging first, then the total, deposit and itemised table as given.`,
  workload: `${IF_NO_VIEW}show the estimate, the activity table and the draft evidence statement as given.`,
  publicInterest: `${IF_NO_VIEW}show the 'Your factors' table and the s 11B(4) factors as given. Either way, whether any factor falls within s 11B(4), and the weight of the rest, are for the decision-maker: you may point to the provisions and ask, but don't decide it.`,
  step: `${IF_NO_VIEW}give the step's checklist as a checklist, with anything under 'For this request' first.`,
  exemption: `${IF_NO_VIEW}take the user through the elements as a numbered list, then the carve-outs and common errors. Either way, whether each element is met is the decision-maker's finding on the evidence.`,
  exemptionList: `${IF_NO_VIEW}show the table of exemptions as given. These are exemptions often considered for that kind of information, not ones found to apply.`,
  map: `${IF_NO_VIEW}show the stages and steps as a list.`,
  questions: "Ask the user these questions directly, then call foi_start_request again with the answers.",
};

function toolError(message: string, structured: Record<string, unknown> = {}): Result {
  return { isError: true, content: [{ type: "text", text: message }], structuredContent: { error: message, ...structured } };
}

/** Whether this request's client declared form elicitation (MRTR) — a spec MUST before asking. */
function canElicit(ctx: ServerContext): boolean {
  const envelope = ctx.mcpReq.envelope;
  const caps = isRecord(envelope) ? envelope[CLIENT_CAPABILITIES_META_KEY] : undefined;
  const elicitation = isRecord(caps) ? caps.elicitation : undefined;
  return isRecord(elicitation) && elicitation.form !== undefined;
}

/** What the foi_start_request form can return (the schema it asks with, below). */
const FACT_ANSWERS = z.object({
  received_date: z.union([isoDate, z.literal("")]).optional(),
  in_writing: z.boolean().optional(),
  states_foi_act: z.boolean().optional(),
  identifies_documents: z.enum(["yes", "unclear", "no"]).optional(),
  has_contact_address: z.boolean().optional(),
  own_personal_information: z.boolean().optional(),
});

const STEP_IDS = nonEmpty(STEPS.map((s) => s.id));
const TEMPLATE_IDS = nonEmpty(TEMPLATES.map((t) => t.id));
const role = z.enum(["officer", "line_area"]).default("officer").describe("officer = FOI practitioner or decision-maker; line_area = business-area staff asked to search or give views");

const timelineOutput = z.looseObject({
  case_file: z.looseObject({}).optional(),
  timeline: z.looseObject({ status: z.string(), key_dates: z.array(z.looseObject({})) }).optional(),
});

export function registerTools(server: McpServer, env: Env): void {
  const corpus = new Corpus(env);

  // ---------------------------------------------------------------------------
  registerAppTool(
    server,
    "foi_process_map",
    {
      title: "FOI process map",
      description:
        "The stages and steps of handling an incoming FOI request under the FOI Act 1982 (Cth), with each step's id and whether this server gives full guided support ('ready') or reference material only ('planned'). " +
        "Use it to orient a practitioner or line-area officer, then open any step with foi_step_guidance. Pass the case file to show where the request is up to.",
      inputSchema: z.object({
        role,
        stage: z.enum(["intake", "scope", "search", "exemptions", "decision"]).optional().describe("Only this stage"),
        case_file: caseFile.optional().describe("Marks the current and completed steps"),
      }),
      outputSchema: z.looseObject({ stages: z.array(z.looseObject({})) }),
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: VIEW_URI } },
    },
    async ({ role, stage, case_file }) => {
      const stages = STAGES.filter((s) => !stage || s.id === stage).map((s) => ({
        ...s,
        steps: stepsIn(s.id)
          .filter((st) => st.roles.includes(role))
          .map((st) => ({ id: st.id, title: st.title, status: st.status, purpose: st.purpose })),
      }));
      const lines = ["# Handling an incoming FOI request (Commonwealth)", ""];
      if (role === "line_area")
        lines.push("_For line-area staff: you will mostly be asked to search for documents and to explain any genuine harm from release. The FOI team and an authorised decision-maker decide._", "");
      for (const s of stages) {
        lines.push(`### ${s.title}${s.status === "planned" ? " — planned (reference only)" : ""}`, s.summary);
        for (const st of s.steps) lines.push(`- \`${st.id}\` ${st.title}${st.status === "planned" ? " _(planned)_" : ""} — ${st.purpose}`);
        lines.push("");
      }
      lines.push("**Start a new request:** foi_start_request. **Dates:** foi_calculate_deadlines. **Any step:** foi_step_guidance.", "", sourcesLine());
      const md = lines.join("\n");
      const view = processView(role, case_file, undefined, md, {});
      return result(md, { role, stages, view }, PRESENT.map);
    },
  );

  // ---------------------------------------------------------------------------
  registerAppTool(
    server,
    "foi_start_request",
    {
      title: "Start a new FOI request",
      description:
        "Triage a newly received FOI request: checks the facts given against the formal requirements of s 15(2), flags transfer, administrative access, personnel records (s 15A) and Part V amendment requests, " +
        "and creates the case file with the statutory dates (acknowledge by, decide by). Takes procedural facts about the request only — not the applicant's identity or the documents. " +
        "Missing facts are returned as questions to ask (or asked directly where the client supports forms).",
      inputSchema: z.object({
        received_date: isoDate.optional().describe("Day the request was received (email: when it reached the FOI inbox)"),
        reference: z.string().max(80).optional().describe("Agency FOI reference"),
        summary: z.string().max(500).optional().describe("One-line description of the documents sought — no personal information"),
        in_writing: z.boolean().optional().describe("s 15(2)(a)"),
        states_foi_act: z.boolean().optional().describe("States it is a request under the FOI Act, or the intent is clear (s 15(2)(aa), [3.33])"),
        identifies_documents: z.enum(["yes", "unclear", "no"]).optional().describe("Enough information to identify the documents (s 15(2)(b))"),
        has_contact_address: z.boolean().optional().describe("Gives an address (email is fine) for notices (s 15(2)(c))"),
        own_personal_information: z.boolean().optional().describe("Seeks only the applicant's own personal information"),
        personnel_records: z.boolean().optional().describe("Seeks an employee's own personnel records (s 15A)"),
        amendment_request: z.boolean().optional().describe("Asks to amend or annotate personal records rather than for access (Part V)"),
        generated_by_bot: z.boolean().optional().describe("Generated by an automated system with no person making it ([3.23])"),
        other_agency_more_connected: z.boolean().optional().describe("Another agency holds the documents or is more closely connected (s 16)"),
        third_parties: z.array(z.enum(["business", "personal", "state", "foreign"])).optional().describe("Third-party information likely in scope"),
        as_of: isoDate.optional().describe("Calculate status as at this date (default: today in Canberra)"),
      }),
      outputSchema: timelineOutput.extend({ validity: z.string().optional(), status: z.string().optional() }),
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: TIMELINE_URI } },
    },
    async (input, ctx) => {
      // Fold in answers from an elicitation round, if this is the retry. A blank date field means "not answered".
      const answers = acceptedContent(ctx.mcpReq.inputResponses, "request_facts", FACT_ANSWERS);
      const { received_date: answeredDate, ...answered } = answers ?? {};
      const facts = { ...input, ...answered, ...(answeredDate ? { received_date: answeredDate } : {}) };

      const REQUIRED = ["received_date", "in_writing", "states_foi_act", "identifies_documents", "has_contact_address"] as const;
      const missing = REQUIRED.filter((k) => facts[k] === undefined);
      // Ask once: a declined or cancelled form falls through to the text questions.
      const alreadyAsked = ctx.mcpReq.inputResponses?.request_facts !== undefined;
      if (missing.length && canElicit(ctx) && !alreadyAsked) {
        return inputRequired({
          inputRequests: {
            request_facts: inputRequired.elicit({
              message: "A few facts about the new FOI request (no names or document content needed):",
              requestedSchema: {
                type: "object",
                properties: {
                  received_date: { type: "string", format: "date", title: "Date received", description: "When it reached the agency (YYYY-MM-DD)" },
                  in_writing: { type: "boolean", title: "In writing?" },
                  states_foi_act: { type: "boolean", title: "Made under the FOI Act (or intent clear)?" },
                  identifies_documents: { type: "string", title: "Identifies the documents?", enum: ["yes", "unclear", "no"] },
                  has_contact_address: { type: "boolean", title: "Gives an address or email for notices?" },
                  own_personal_information: { type: "boolean", title: "Only the applicant's own personal information?", default: false },
                },
                required: [...missing],
              },
            }),
          },
        });
      }
      if (missing.length) {
        const questions: Record<string, string> = {
          received_date: "What date was the request received (for email, when it reached the FOI inbox)?",
          in_writing: "Is the request in writing?",
          states_foi_act: "Does it say it is made under the FOI Act, or is that intention clear (e.g. sent to the FOI mailbox)?",
          identifies_documents: "Does it give enough detail to identify the documents (yes / unclear / no)?",
          has_contact_address: "Does it give an address or email for notices?",
        };
        const md = [
          "## Before triage: a few facts are needed",
          "",
          ...missing.map((k) => `- ${questions[k]}`),
          "",
          "Ask the practitioner, then call foi_start_request again with the answers. No applicant names or document content are needed.",
        ].join("\n");
        return result(md, { status: "needs_information", missing, questions: missing.map((k) => questions[k]) }, PRESENT.questions);
      }

      const issues: string[] = [];
      const actions: string[] = [];
      if (facts.generated_by_bot) issues.push("Generated by an automated system with no person making it: the Guidelines treat such a request as not valid ([3.23]). Confirm that no person is making it first.");
      if (facts.amendment_request) issues.push("This is a request to amend or annotate personal records — Part V (s 48), not an access request. Decide within 30 days (s 51D); see Guidelines Part 7.");
      if (facts.personnel_records) issues.push("Personnel records: if the agency has a routine procedure for employee access, s 15A may require it to be used first ([2.91]).");
      if (facts.in_writing === false) issues.push("Not in writing (s 15(2)(a)). Help the applicant put it in writing (s 15(3)).");
      if (facts.states_foi_act === false) issues.push("Does not say it is made under the FOI Act (s 15(2)(aa)). If intention is unclear, check with the applicant; consider administrative release ([3.5]–[3.12], [3.33]).");
      if (facts.has_contact_address === false) issues.push("No address for notices (s 15(2)(c)). Ask for one.");
      if (facts.identifies_documents === "unclear")
        actions.push("Scope is unclear. If the request meets s 15(2)(b), the clock runs from receipt even while you clarify scope with the applicant ([3.250]).");

      // Failing s 15(2)(b) is not invalidity: the Guidelines require assistance and a request consultation instead ([3.49]–[3.50]).
      const invalid =
        facts.generated_by_bot === true ||
        facts.amendment_request === true ||
        facts.in_writing === false ||
        facts.has_contact_address === false ||
        facts.states_foi_act === false;
      const validity = facts.amendment_request
        ? "part_v_amendment"
        : invalid
          ? "not_yet_valid"
          : facts.identifies_documents === "no"
            ? "identification_issue"
            : "meets_s15_2";

      if (facts.other_agency_more_connected) actions.push("Consider transfer under s 16 — get the other agency's agreement and notify the applicant (step intake.transfer).");
      if (facts.own_personal_information) actions.push("Own personal information: no charges (Charges Regs s 7(1)); s 47F does not apply merely because the information is about the applicant (s 47F(3)).");
      const tps = facts.third_parties ?? [];
      if (tps.length)
        actions.push(
          `Third-party consultation likely (${tps.map((t) => ({ business: "s 27", personal: "s 27A", state: "s 26A", foreign: "s 15(7)" })[t]).join(", ")}): it extends the period by 30 days (s 15(6)/(8)) once notified — start early.`,
        );

      const cf: CaseFile = caseFile.parse({
        reference: facts.reference,
        received_date: facts.received_date,
        summary: facts.summary,
        own_personal_information: facts.own_personal_information,
        third_parties: tps.length ? tps : undefined,
        // Only the officer completes the validity step: the tool has only their answers.
        stage: { meets_s15_2: "intake.acknowledge", identification_issue: "scope.request_consultation", not_yet_valid: "intake.validity", part_v_amendment: "intake.validity" }[validity],
        completed_steps: ["intake.receive"],
        events: [],
      });
      const asOf = facts.as_of ?? todayInCanberra();
      const tl = computeTimeline(cf, asOf);

      const verdict = {
        meets_s15_2: "**On the facts given, the request meets the formal requirements of s 15(2).** The processing period runs from the day after receipt ([3.250]).",
        identification_issue:
          "**On the facts given, the request doesn't identify the documents (s 15(2)(b)).** The Guidelines say this can't simply be treated as invalid: assist the applicant (s 15(3)) and run a request consultation (s 24AB) before any refusal ([3.49]–[3.50]). The dates below run from the received date.",
        not_yet_valid:
          "**On the facts given, the request doesn't yet meet s 15(2)** (see the issues below). The processing period runs from the day after a request meeting s 15(2) is received; the dates below assume the received date, so update it if the request is fixed later.",
        part_v_amendment: "**Part V amendment request**: a different process. The dates below are for an access request and may not apply.",
      }[validity];
      const md = [
        `# New FOI request${cf.reference ? ` ${cf.reference}` : ""}`,
        verdict,
        ...(issues.length ? ["", "**Issues**", ...issues.map((i) => `- ${i}`)] : []),
        ...(actions.length ? ["", "**Consider**", ...actions.map((a) => `- ${a}`)] : []),
        "",
        renderTimeline(tl),
        "",
        `**Next step:** \`${cf.stage}\` — open it with foi_step_guidance; draft the acknowledgement with foi_draft_notice (template \`acknowledgement\`). Keep the case file below and pass it to the next tool, adding events as they happen.`,
        "",
        "```json",
        JSON.stringify(cf),
        "```",
        "",
        sourcesLine(["3"]),
      ].join("\n");
      return result(
        md,
        { validity, issues, actions, case_file: cf, timeline: tl },
        `Relay the s 15(2) result as "on the facts given", not as a finding that the request is valid, with any issues. ${PRESENT.dates}`,
      );
    },
  );

  // ---------------------------------------------------------------------------
  registerAppTool(
    server,
    "foi_calculate_deadlines",
    {
      title: "Calculate FOI deadlines",
      description:
        "Statutory dates for a request from its case file: acknowledgement (s 15(5)(a)), decision due (s 15(5)(b)) after extensions (ss 15(6), 15(8), 15AA, 15AB) and disregarded periods (request consultation s 24AB(8); unpaid charges s 31), " +
        "deemed refusal (s 15AC), review windows (ss 54B, 54S), internal review due (s 54C) and disclosure log (s 11C(6)). Calendar days; weekends roll forward ([3.247]); public holidays are not checked. " +
        "Add an event to the case file's events list to see its effect. Show the user the key dates table from the result.",
      inputSchema: z.object({
        case_file: caseFile,
        as_of: isoDate.optional().describe("Calculate status as at this date (default: today in Canberra)"),
      }),
      outputSchema: timelineOutput,
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: TIMELINE_URI } },
    },
    async ({ case_file, as_of }) => {
      const tl = computeTimeline(case_file, as_of ?? todayInCanberra());
      const md = [renderTimeline(tl), "", "```json", JSON.stringify(case_file), "```", "", sourcesLine(["3"])].join("\n");
      return result(md, { case_file, timeline: tl }, PRESENT.dates);
    },
  );

  // ---------------------------------------------------------------------------
  registerAppTool(
    server,
    "foi_step_guidance",
    {
      title: "Guidance for an FOI step",
      description:
        "The checklist, common errors, templates and key provisions for one step of the FOI process (ids from foi_process_map, e.g. intake.validity, exemptions.public_interest, decision.statement_of_reasons), " +
        "with the relevant passages of the Act and Guidelines quoted. Pass the case file to tailor it to the request; role line_area gives plain-English guidance for business-area staff.",
      inputSchema: z.object({
        step: z.enum(STEP_IDS).describe("Step id from foi_process_map"),
        role,
        case_file: caseFile.optional(),
      }),
      outputSchema: z.looseObject({ step: z.looseObject({ id: z.string() }), excerpts: z.array(z.looseObject({})) }),
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: VIEW_URI } },
    },
    async ({ step: stepId, role, case_file }) => {
      const step = STEP_BY_ID.get(stepId);
      if (!step) return toolError(`No step "${stepId}". See foi_process_map for step ids.`);
      const excerpts = await corpus.many(await expandReads(corpus, step.read));
      const tailored: string[] = [];
      if (case_file) {
        const tl = computeTimeline(case_file);
        if (tl.processing.effective_due)
          tailored.push(`Decision due ${longDate(tl.processing.effective_due)} (${tl.status_label.toLowerCase()}${tl.processing.days_remaining !== null ? `, ${tl.processing.days_remaining} days remaining` : ""}).`);
        if (tl.status === "deemed_refusal")
          tailored.push("On the recorded events, the processing period has ended without a decision: a deemed refusal (s 15AC). Decide as soon as possible; Charges Regs s 7(2)–(3) bars charges; consider s 15AC(4).");
        if (case_file.own_personal_information) tailored.push("Own personal information: no charges (Charges Regs s 7(1)); s 47F(3) applies to the applicant's own information.");
        if (case_file.third_parties?.length) tailored.push(`Third parties flagged: ${case_file.third_parties.join(", ")} — plan consultation and the s 15(6) extension.`);
      }
      const md = [renderStep(step, role, excerpts, tailored), "", sourcesLine(partsCited(step.read))].join("\n");
      const next = case_file ? { ...case_file, stage: step.id } : undefined;
      const checklist = step.checklist.filter((c) => !c.roles || c.roles.includes(role));
      const detail: StepDetail = {
        id: step.id,
        title: step.title,
        purpose: step.purpose,
        when: step.when,
        tailored,
        line_area: role === "line_area" ? (step.line_area ?? []) : [],
        checklist: checklist.map((c) => c.text),
        pitfalls: step.pitfalls,
        templates: step.templates ?? [],
        next: step.next,
        excerpts: excerpts.map((e) => ({
          ref: e.ref,
          label: `${sourceLabel(e)} ${e.ref}${e.source === "guidelines" ? "" : ` (${e.title})`}`,
          url: e.url,
          text: e.text.replace(/\n\n\[\^[\s\S]*$/, "").replace(/\s+/g, " ").slice(0, 600),
        })),
      };
      const links = await guidelineLinks(corpus, [...detail.checklist, ...detail.pitfalls, ...detail.line_area]);
      const view = processView(role, next, detail, md, links);
      return result(
        md,
        {
          step: { ...step, checklist },
          role,
          excerpts: excerpts.map((e) => ({ id: e.id, ref: e.ref, source: sourceLabel(e), title: e.title, url: e.url, text: e.text })),
          ...(next ? { case_file: next } : {}),
          view,
        },
        PRESENT.step,
      );
    },
  );

  // ---------------------------------------------------------------------------
  registerAppTool(
    server,
    "foi_exemption_guide",
    {
      title: "Exemption guide",
      description:
        "The elements, carve-outs, consultation duties, common errors and line-area questions for an exemption or conditional exemption in Part IV of the FOI Act (ss 33–47J), with the section text and key Guidelines paragraphs. " +
        "Give a provision (e.g. '47F', 's 47C'); or describe the kind of information (e.g. 'staff names and a complaint', 'legal advice') to get candidate exemptions; or neither, for the full list.",
      inputSchema: z.object({
        provision: z.string().max(20).optional().describe("e.g. 47F, s 47E, 42"),
        information: z.string().max(300).optional().describe("The kind of information being considered — a category, not the document's content"),
      }),
      outputSchema: z.looseObject({}),
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: VIEW_URI } },
    },
    async ({ provision, information }) => {
      if (provision) {
        const key = normaliseProvision(provision);
        const e = EXEMPTION_BY_PROVISION.get(key);
        if (!e) {
          return toolError(
            `s ${key} is not an exemption in Part IV. Exemptions: ${EXEMPTIONS.map((x) => `s ${x.provision}`).join(", ")}. For other provisions use fetch (e.g. id "s ${key}").`,
          );
        }
        const section = await corpus.unit(`act:s${e.provision}`);
        const paras = await corpus.many(e.key_paragraphs);
        const md = [renderExemption(e, section?.kind === "passage" ? section.text : null, paras), "", sourcesLine([String(e.guidelines.part)])].join("\n");
        const key_paragraphs = paras.map((p) => ({ id: p.id, ref: p.ref, title: p.title, url: p.url, text: p.text }));
        const view: View = {
          kind: "exemption",
          title: `s ${e.provision} — ${e.name}`,
          subtitle: e.kind === "exempt" ? "Exemption · Part IV Division 2" : "Conditional exemption · Part IV Division 3 · public interest test required",
          exemption: e,
          section_text: section?.kind === "passage" ? section.text : null,
          key_paragraphs: key_paragraphs.map((p) => ({ ...p, text: p.text.replace(/\n\n\[\^[\s\S]*$/, "").replace(/\s+/g, " ").slice(0, 700) })),
          links: await guidelineLinks(corpus, [...e.elements, ...(e.carve_outs ?? []), ...e.pitfalls, e.consultation ?? "", e.harm_test ?? "", e.summary]),
          caveats: [CAVEAT_ADVICE],
          body: md,
          filename: fileSlug("exemption", e.provision),
        };
        return result(md, { exemption: e, section_text: view.section_text, key_paragraphs, view }, PRESENT.exemption);
      }
      const candidates = information ? suggestExemptions(information) : [];
      const list = candidates.length ? candidates : EXEMPTIONS;
      const md = [
        information
          ? candidates.length
            ? `## Exemptions often considered for: _${information}_`
            : `## No exemption is listed against _${information}_ — the full list:`
          : "## Exemptions in Part IV of the FOI Act",
        "",
        "| Provision | Name | Kind | Test |",
        "|---|---|---|---|",
        ...list.map((e) => `| s ${e.provision} | ${e.name} | ${e.kind === "exempt" ? "Exempt" : "Conditional (public interest test)"} | ${e.summary} |`),
        "",
        "Open one with foi_exemption_guide and a provision. Candidates are a starting point: each element must be established on the evidence.",
        "",
        sourcesLine(["5", "6"]),
      ].join("\n");
      const rows = list.map(({ provision, name, kind, summary }) => ({ provision, name, kind, summary }));
      const view: View = {
        kind: "exemption_list",
        title: information ? (candidates.length ? "Exemptions often considered" : "Exemptions in Part IV") : "Exemptions in Part IV",
        subtitle: information ? `For: ${information}` : "ss 33–47J of the FOI Act",
        information,
        matched: candidates.length > 0,
        candidates: rows,
        links: {},
        caveats: ["Candidates are a starting point: each element must be established on the evidence.", CAVEAT_ADVICE],
        body: md,
        filename: "exemptions",
      };
      return result(md, { candidates: rows, view }, PRESENT.exemptionList);
    },
  );

  // ---------------------------------------------------------------------------
  const CONDITIONAL = nonEmpty(EXEMPTIONS.filter((e) => e.kind === "conditional").map((e) => e.provision));
  registerAppTool(
    server,
    "foi_public_interest_test",
    {
      title: "Public interest test worksheet",
      description:
        "A worksheet for the public interest test on a conditionally exempt document (ss 11A(5), 11B): the decision-maker's factors for and against access, set beside the s 11B(3) factors, the Guidelines' factor lists, " +
        "the irrelevant factors in s 11B(4) and the weighing steps. Give short descriptions of factors, not document content.",
      inputSchema: z.object({
        provision: z.enum(CONDITIONAL).describe("The conditional exemption the document meets, e.g. 47C"),
        factors_for: z.array(z.string().max(300)).max(20).default([]).describe("Factors favouring access you have identified"),
        factors_against: z.array(z.string().max(300)).max(20).default([]).describe("Factors against access you have identified"),
      }),
      outputSchema: z.looseObject({ factors: z.array(z.looseObject({})) }),
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: VIEW_URI } },
    },
    async ({ provision, factors_for, factors_against }) => {
      const factors = factorList(factors_for, factors_against);
      const e = EXEMPTION_BY_PROVISION.get(provision);
      if (!e) return toolError(`s ${provision} is not a conditional exemption. Conditional exemptions: ${CONDITIONAL.map((p) => `s ${p}`).join(", ")}.`);
      const lines = [`## Public interest test — s ${provision} (${e.name})`, ""];
      lines.push("### Your factors", "| Side | Factor |", "|---|---|");
      for (const f of factors) lines.push(`| ${f.side === "for" ? "For access" : "Against access"} | ${f.factor} |`);
      if (!factors.length) lines.push("| — | none given |");
      if (!factors_for.length) lines.push("", "**No factors favouring access given.** Consider each s 11B(3) factor below; the Guidelines say it would be a rare case in which disclosure would not promote the objects of the Act ([6.230]).");
      if (!factors_against.length) lines.push("", "**No factors against access given.** Access must be given unless it would, on balance, be contrary to the public interest (s 11A(5)).");
      lines.push("", "### Irrelevant factors — s 11B(4)", "These must not be taken into account in deciding whether access would, on balance, be contrary to the public interest:", ...IRRELEVANT.map((i) => `- **${i.id}** ${i.text}`));
      lines.push("", "### Factors favouring access — s 11B(3) (must be considered if relevant, [6.229])");
      for (const f of STATUTORY_FOR) lines.push(`- **${f.id}** ${f.text}`);
      lines.push("", "Other factors favouring access in the Guidelines ([6.231], non-exhaustive):", ...GUIDELINES_FOR.map((f) => `- ${f}`));
      lines.push("", "### Factors against access ([6.233], non-exhaustive; the Act lists none, [6.232])", "Where disclosure could reasonably be expected to:", ...GUIDELINES_AGAINST.map((f) => `- ${f}`));
      if (provision === "47C") lines.push("", `_${FRANKNESS_GUIDANCE}_`);
      if (provision === "47B") lines.push("", "_s 47B: see also [6.240]–[6.244] on the public interest test and Commonwealth–State relations._");
      lines.push("", "### Weighing", ...WEIGHING_STEPS.map((s, i) => `${i + 1}. ${s}`), "", sourcesLine(["6"]));
      const md = lines.join("\n");
      const view: View = {
        kind: "public_interest",
        title: `Public interest test — s ${provision}`,
        subtitle: `${e.name} · ss 11A(5), 11B`,
        provision,
        name: e.name,
        factors,
        statutory_for: STATUTORY_FOR,
        irrelevant: IRRELEVANT,
        guidelines_for: GUIDELINES_FOR,
        guidelines_against: GUIDELINES_AGAINST,
        frankness: provision === "47C" ? FRANKNESS_GUIDANCE : undefined,
        weighing_steps: WEIGHING_STEPS,
        links: await guidelineLinks(corpus, [...WEIGHING_STEPS, FRANKNESS_GUIDANCE, "[6.229] [6.231] [6.232] [6.233]"]),
        caveats: [CAVEAT_ADVICE],
        body: md,
        filename: fileSlug("public-interest", provision),
      };
      return result(
        md,
        {
          provision,
          factors,
          irrelevant_factors: IRRELEVANT,
          statutory_factors_for: STATUTORY_FOR,
          guidelines_factors_for: GUIDELINES_FOR,
          guidelines_factors_against: GUIDELINES_AGAINST,
          weighing_steps: WEIGHING_STEPS,
          view,
        },
        PRESENT.publicInterest,
      );
    },
  );

  // ---------------------------------------------------------------------------
  registerAppTool(
    server,
    "foi_draft_notice",
    {
      title: "Draft an FOI notice",
      description:
        "A structured draft of an FOI notice or working document, with the content the Act requires and [[slots]] still to fill. Templates: " +
        TEMPLATES.map((t) => `${t.id} (${t.title})`).join("; ") +
        ". Dates are filled from the case file; pass details to fill slots by name. The draft is for the user: show it to them in full, word for word.",
      inputSchema: z.object({
        template: z.enum(TEMPLATE_IDS),
        case_file: caseFile.optional(),
        details: z.record(z.string(), z.string().max(4000)).optional().describe("Slot values by name, e.g. { contact_officer: 'FOI Officer', decision_summary: 'grant access in part' }"),
      }),
      outputSchema: z.looseObject({ text: z.string(), must_include: z.array(z.string()), unfilled: z.array(z.string()) }),
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: VIEW_URI } },
    },
    async ({ template, case_file, details }) => {
      const tl = case_file ? computeTimeline(case_file) : undefined;
      const { template: t, text, unfilled } = renderTemplate(template, case_file, tl, details ?? {});
      const md = [
        `## Draft: ${t.title}`,
        `_For: ${t.audience.replace("_", " ")} · ${t.provisions.join(", ")}_`,
        "",
        "**Must include:** " + t.must_include.join("; ") + ".",
        "",
        "---",
        "",
        text,
        "",
        "---",
        unfilled.length ? `**Still to fill (${unfilled.length}):** ${unfilled.map((u) => `[[${u}]]`).join(" · ")}` : "All slots filled — review before sending.",
        "",
        "_A draft for the officer to check and adopt; the decision-maker must personally endorse any reasoning ([3.298])._",
      ].join("\n");
      const view: View = {
        kind: "draft",
        title: t.title,
        subtitle: [case_file?.reference, `for the ${t.audience.replace("_", " ")}`, t.provisions.join(", ")].filter(Boolean).join(" · "),
        template: t.id,
        audience: t.audience,
        must_include: t.must_include,
        unfilled,
        calculated: calculatedDates(case_file, tl),
        case: case_file && tl ? caseStrip(case_file, tl) : undefined,
        links: await guidelineLinks(corpus, [text]),
        caveats: ["A draft for the officer to check and adopt; the decision-maker must personally endorse any reasoning ([3.298]).", ...(case_file ? [CAVEAT_DATES] : []), CAVEAT_ADVICE],
        body: text,
        filename: fileSlug(case_file?.reference, t.id),
      };
      return result(
        md,
        { template: t.id, title: t.title, audience: t.audience, provisions: t.provisions, must_include: t.must_include, text, unfilled, view },
        PRESENT.draft,
      );
    },
  );

  // ---------------------------------------------------------------------------
  registerAppTool(
    server,
    "foi_estimate_charges",
    {
      title: "Estimate FOI charges",
      description:
        "A preliminary assessment of charges under the FOI (Charges) Regulations 2019 for a s 29(1) notice: itemised by Schedule 1 item (search $15/h; decision-making $20/h after 5 free hours; copies, transcripts, supervised inspection, actual costs), " +
        "with the maximum deposit (reg 12), the bars on charging (reg 7: applicant's personal information; late decision), and the matters for a reduction or waiver decision (s 29(5)). Takes hours and page counts, not documents. " +
        "Show the user the total, deposit and itemised table from the result.",
      inputSchema: z.object({
        search_hours: z.number().min(0).max(10000).optional().describe("Search and retrieval time, assuming documents are where the filing system indicates"),
        decision_hours: z.number().min(0).max(10000).optional().describe("Total decision-making time, including examining, consulting, redacting and notifying (the first 5 hours are free)"),
        copy_pages: z.number().int().min(0).optional().describe("Pages of copies other than photocopies"),
        photocopy_pages: z.number().int().min(0).optional(),
        transcript_pages: z.number().int().min(0).optional(),
        supervision_minutes: z.number().int().min(0).optional().describe("Supervised inspection or viewing"),
        actual_costs: z.number().min(0).optional().describe("Actual costs: computer production, electronic copies, postage, etc."),
        actual_costs_description: z.string().max(200).optional(),
        documents_contain_applicants_personal_information: z.boolean().optional().describe("True if the documents contain the applicant's own personal information (no charge, reg 7(1))"),
        case_file: caseFile.optional().describe("If given, checks whether the decision is already late (reg 7(2)–(3))"),
      }),
      outputSchema: z.looseObject({ total: z.number(), chargeable: z.boolean(), lines: z.array(z.looseObject({})) }),
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: VIEW_URI } },
    },
    async ({ case_file, ...input }) => {
      const tl = case_file ? computeTimeline(case_file) : undefined;
      const res = estimateCharges({
        ...input,
        documents_contain_applicants_personal_information: input.documents_contain_applicants_personal_information ?? case_file?.own_personal_information,
        decision_late: tl?.status === "deemed_refusal",
      });
      const md = [
        `## Charges — preliminary assessment${case_file?.reference ? ` for ${case_file.reference}` : ""}`,
        res.barred_by ? `**${res.barred_by}**` : `**Total: ${aud(res.total)}** · maximum deposit ${aud(res.deposit_maximum)} (${res.deposit_rule})`,
        "",
        "| Item | Schedule 1 | Quantity | Rate | Amount |",
        "|---|---|---|---|---|",
        ...res.lines.map((l) => `| ${l.item} | ${l.provision} | ${l.quantity} | ${l.rate} | ${aud(l.amount)} |`),
        ...(res.lines.length ? [] : ["| — | | | | $0.00 |"]),
        "",
        "**Check**",
        ...res.notes.map((n) => `- ${n}`),
        "",
        "**If the applicant contests the charge (s 29(4)–(5))**",
        ...res.waiver_considerations.map((n) => `- ${n}`),
        "",
        "Next: decide whether to charge at all; if so, draft the notice with foi_draft_notice (template s29_charges_notice) and record charge_notice in the case file.",
        "",
        sourcesLine(["4"]),
      ].join("\n");
      const view = chargesView(res, input.decision_hours ?? 0, case_file, md, await guidelineLinks(corpus, [...res.notes, ...res.waiver_considerations, res.barred_by ?? ""]));
      return result(md, { ...res, view }, PRESENT.charges);
    },
  );

  registerAppTool(
    server,
    "foi_estimate_workload",
    {
      title: "Estimate practical refusal workload",
      description:
        "An evidence-based estimate of the work in processing a request, for deciding whether a practical refusal reason exists (s 24AA(1)(a)): extrapolates time measured on a representative sample to the whole set, broken down by the s 24AA(2) activities, " +
        "with the matters that must, may and must not be considered, scope-revision suggestions, and a draft evidence statement for a s 24AB notice. Not a threshold test: the decision-maker must be satisfied the diversion is substantial and unreasonable. " +
        "Show the user the estimate, the activity table and the evidence statement from the result.",
      inputSchema: z.object({
        documents_in_scope: z.number().int().min(1).describe("Documents identified within scope (from actual searches)"),
        pages_in_scope: z.number().int().min(0).optional(),
        sample_documents: z.number().int().min(1).describe("Documents in the sample assessed as if deciding access"),
        search_hours: z.number().min(0).describe("Estimated time to identify, locate and collate all documents"),
        sample_examine_minutes: z.number().min(0).describe("Minutes taken to examine and decide on the sampled documents"),
        sample_redact_minutes: z.number().min(0).optional().describe("Minutes to prepare edited copies of the sampled documents"),
        sample_documents_needing_consultation: z.number().int().min(0).optional().describe("Sampled documents needing third-party consultation"),
        consultation_minutes_each: z.number().min(0).optional().describe("Minutes per consultation (identify, contact, consider submission)"),
        decision_and_notification_hours: z.number().min(0).optional().describe("Statement of reasons, schedule and notification"),
        documents_already_found_exempt: z.boolean().optional().describe("True if the material needing consultation has already been decided exempt (then consultation time is excluded, [3.203])"),
        fte_available_for_foi: z.number().min(0).optional().describe("FTE the agency has for FOI processing"),
      }),
      outputSchema: z.looseObject({ total_hours: z.number(), lines: z.array(z.looseObject({})), evidence_statement: z.string() }),
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: VIEW_URI } },
    },
    async (input) => {
      const res = estimateWorkload(input);
      const md = [
        `## Practical refusal — workload estimate`,
        `**About ${res.total_hours} hours (${res.total_days} working days)**${res.fte_weeks !== undefined ? ` — about ${res.fte_weeks} weeks of the FOI team's capacity` : ""}. Sample: ${input.sample_documents} of ${input.documents_in_scope} documents (${res.sample_percent}%), scaled ×${res.scale}.`,
        "",
        "| Activity | Provision | Hours | Basis |",
        "|---|---|---|---|",
        ...res.lines.map((l) => `| ${l.activity} | ${l.provision} | ${l.hours} | ${l.basis} |`),
        "",
        "**Cautions**",
        ...res.cautions.map((c) => `- ${c}`),
        "",
        "**Must consider**",
        ...res.must_consider.map((c) => `- ${c}`),
        "",
        "**Must not consider**",
        ...res.must_not_consider.map((c) => `- ${c}`),
        "",
        "**May also consider**",
        ...res.may_consider.map((c) => `- ${c}`),
        "",
        "**Ways the applicant could revise the request**",
        ...res.revision_suggestions.map((c) => `- ${c}`),
        "",
        "**Draft evidence statement** (for the s 24AB notice — the decision-maker must complete the reasoning)",
        `> ${res.evidence_statement}`,
        "",
        "Next: if a practical refusal reason may exist, give a s 24AB notice (foi_draft_notice, template s24AB_notice) and record s24AB_notice in the case file.",
        "",
        sourcesLine(["3"]),
      ].join("\n");
      const view: View = {
        kind: "workload",
        title: "Practical refusal — workload estimate",
        subtitle: "s 24AA(1)(a) · for a s 24AB notice",
        total_hours: res.total_hours,
        total_days: res.total_days,
        fte_weeks: res.fte_weeks,
        sample: `Sample of ${input.sample_documents} of ${input.documents_in_scope} documents (${res.sample_percent}%), scaled ×${res.scale}`,
        lines: res.lines,
        evidence_statement: res.evidence_statement,
        cautions: res.cautions,
        must_consider: res.must_consider,
        must_not_consider: res.must_not_consider,
        may_consider: res.may_consider,
        revision_suggestions: res.revision_suggestions,
        links: await guidelineLinks(corpus, [...res.cautions, ...res.must_consider, ...res.must_not_consider, ...res.may_consider, ...res.revision_suggestions]),
        caveats: [
          "Not a threshold test: there is no number of hours that makes a request a practical refusal ([3.208]). The decision-maker must be satisfied the work would substantially and unreasonably divert resources (s 24AA(1)(a)).",
          CAVEAT_ADVICE,
        ],
        body: md,
        filename: "practical-refusal-workload-estimate",
      };
      return result(md, { ...res, view }, PRESENT.workload);
    },
  );

  // ---------------------------------------------------------------------------
  registerAppTool(
    server,
    "search",
    {
      title: "Search the FOI Act and Guidelines",
      description:
        "Hybrid keyword and semantic search over the FOI Act 1982, the FOI (Charges) Regulations 2019 and the OAIC FOI Guidelines (Parts 1–15), returning citable passages (sections and numbered paragraphs) with links. " +
        "Pass a result's id to fetch for the full text. A query that names a provision or paragraph ('s 24AB', '[6.146]') returns it first.",
      inputSchema: z.object({
        query: z.string().min(2).max(300),
        source: z.enum(["act", "regs", "guidelines"]).optional().describe("Limit to one source"),
        part: z.string().max(10).optional().describe("Guidelines part, e.g. 'Part 6'"),
        limit: z.number().int().min(1).max(25).default(8),
      }),
      outputSchema: z.looseObject({ results: z.array(z.looseObject({ id: z.string(), title: z.string(), url: z.string() })) }),
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: VIEW_URI } },
    },
    async ({ query, source, part, limit }) => {
      const { hits, mode } = await corpus.search(query, { source, part, limit });
      const results = hits.map((h) => ({
        id: h.id,
        title: `${h.source === "guidelines" ? "FOI Guidelines" : h.source === "act" ? "FOI Act" : "Charges Regulations"} ${h.ref} — ${h.title}`,
        url: h.url,
        ref: h.ref,
        source: h.source,
        heading: h.heading,
        snippet: h.snippet,
        matched_by: h.matched_by,
      }));
      const view: View = {
        kind: "search",
        title: "Search the Act and Guidelines",
        subtitle: query,
        query,
        mode,
        results: results.map(({ id, ref, source, title, heading, snippet, url }) => ({ id, ref, source, title, heading, snippet, url })),
        links: {},
        caveats: ["Excerpts only: read the authoritative text before relying on a passage.", CAVEAT_ADVICE],
        body: results.map((r) => `- **${r.title}** — ${r.snippet} (${r.url})`).join("\n"),
        filename: fileSlug("search", query),
      };
      // OpenAI's search contract: structured results mirrored as JSON text (the view rides alongside).
      return { content: [{ type: "text", text: JSON.stringify({ results, mode }) }], structuredContent: { results, mode, view } };
    },
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch a provision or Guidelines paragraph",
      description:
        "Full text of a passage by id from search, or by citation: an Act section ('s 47F', 'act:s47F'), a Charges Regulations section ('Charges Regs s 7'), a Guidelines paragraph ('[6.123]', 'gl:6.123'), " +
        "or a Guidelines part's outline ('Part 6'). Act sections come whole even when search returns them in parts.",
      inputSchema: z.object({ id: z.string().min(1).max(60) }),
      outputSchema: z.looseObject({ id: z.string(), title: z.string(), text: z.string(), url: z.string() }),
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      const unit = await corpus.unit(id);
      if (!unit) return toolError(`Nothing found for "${id}". Try search, or a citation like "s 24AB", "[3.247]" or "Part 6".`);
      if (unit.kind === "outline") {
        const text = [`${unit.title}`, "", ...unit.sections.map((s) => `${s.from}–${s.to}  ${s.heading} (${s.paragraphs})`)].join("\n");
        const doc = { id: unit.id, title: `FOI Guidelines ${unit.title} — outline`, text, url: unit.url, metadata: { kind: "outline", sections: unit.sections.length } };
        return { content: [{ type: "text", text: JSON.stringify(doc) }], structuredContent: doc };
      }
      const label = unit.source === "guidelines" ? `FOI Guidelines ${unit.part} ${unit.ref}` : `${sourceLabel(unit)} ${unit.ref}`;
      const versions =
        unit.source === "guidelines"
          ? GUIDELINE_PARTS[unit.part.replace("Part ", "")]
          : MANIFEST.legislation[unit.source as "act" | "regs"];
      const doc = {
        id: unit.id,
        title: `${label} — ${unit.title}`,
        text: `${unit.heading ? `${unit.heading}\n\n` : ""}${unit.text}`,
        url: unit.url,
        metadata: { source: unit.source, ref: unit.ref, heading: unit.heading, version: versions, licence: unit.source === "guidelines" ? MANIFEST.licence.guidelines : MANIFEST.licence.legislation },
      };
      return { content: [{ type: "text", text: JSON.stringify(doc) }], structuredContent: doc };
    },
  );
}

/** Act ids in `read` may be parents of chunks; resolve each to its first chunk for an excerpt. */
async function expandReads(corpus: Corpus, ids: string[]): Promise<string[]> {
  const rows = await corpus.many(ids);
  const found = new Set(rows.map((r) => r.id));
  const out: string[] = [];
  for (const id of ids) {
    if (found.has(id)) out.push(id);
    else {
      const kids = await corpus.children(normaliseRef(id) ?? id);
      if (kids[0]) out.push(kids[0].id);
    }
  }
  return out;
}
