/**
 * The tools. All are read-only: they hold the law, guidance and calculators, and take
 * the client-held case file as an argument rather than storing anything.
 *
 * Each result is markdown (complete on its own, for tools-only clients) plus the same
 * facts as structuredContent, and a note telling the assistant what to show the user.
 * Two tools carry the timeline MCP App and four the document view; hosts without
 * MCP Apps simply show the text.
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
import { Corpus, type Env, MANIFEST, normaliseRef, sourceLabel } from "../corpus.ts";
import { type CaseFile, caseFile, isoDate } from "../domain/case-file.ts";
import { computeTimeline, longDate, todayInCanberra } from "../domain/deadlines.ts";
import { EXEMPTIONS, EXEMPTION_BY_PROVISION, normaliseProvision, suggestExemptions } from "../domain/exemptions.ts";
import { GUIDELINES_AGAINST, GUIDELINES_FOR, IRRELEVANT, STATUTORY_FOR, WEIGHING_STEPS, checkFactors } from "../domain/public-interest.ts";
import { aud, estimateCharges } from "../domain/charges.ts";
import { TEMPLATES, type TemplateId, renderTemplate } from "../domain/templates.ts";
import { estimateWorkload } from "../domain/workload.ts";
import { STAGES, STEPS, STEP_BY_ID, type Step, stepsIn } from "../domain/workflow.ts";
import { DOCUMENT_URI, TIMELINE_URI } from "./app.ts";
import { type DocumentView, fileSlug } from "./document-view.ts";
import { partsCited, renderExemption, renderStep, renderTimeline, sourcesLine } from "./render.ts";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

type Audience = ("user" | "assistant")[];
type Text = { type: "text"; text: string; annotations?: { audience?: Audience; priority?: number } };
type Result = { content: Text[]; structuredContent: Record<string, unknown>; isError?: boolean };

/**
 * The markdown result, plus (when given) a short note telling the assistant how to show
 * it. Hosts collapse tool output, so without the note a model tends to paraphrase a
 * draft or a table the user needed to see. The note is marked for the assistant only.
 */
function result(markdown: string, structured: Record<string, unknown>, present?: string): Result {
  const content: Text[] = [{ type: "text", text: markdown, annotations: { audience: ["user", "assistant"] } }];
  if (present) content.push({ type: "text", text: `Presenting this result: ${present}`, annotations: { audience: ["assistant"], priority: 1 } });
  return { content, structuredContent: structured };
}

const PRESENT = {
  dates:
    "tell the user the outcome in a sentence, then show the key dates table as given, decision due date first, with each provision. Use these dates exactly; never recalculate or move them. Keep the case file JSON for the next tool call; show it only if asked.",
  draft:
    "this draft is the deliverable. Show it to the user in full and word for word: everything between the two horizontal rules, keeping its headings, wording and [[slots]]. Don't summarise, shorten or rephrase it. After it, list the slots still to fill and offer to fill them; to fill slots, call foi_draft_notice again with details, so the mandatory content stays intact.",
  charges:
    "show the user the total and maximum deposit (or the bar on charging, if one applies) and the itemised table as given. Then give the checks and the contention matters as a short summary, in full only if asked.",
  workload:
    "show the user the headline estimate, the activity table and the draft evidence statement in full, as given. Summarise the cautions and the must / must not / may consider lists briefly unless asked for them in full.",
  publicInterest:
    "show the user any ⚠️ possible irrelevant factors first, in full, with the s 11B(4) paragraph each one hits, then the 'Your factors' table. The factor lists and weighing steps are reference: summarise them unless asked.",
  step: "give the user this step's checklist as a checklist (with anything under 'For this request' first) and the common errors. Quote the sources only where they help, citing the section or paragraph numbers given.",
  exemption:
    "take the user through the elements as a numbered list, then the carve-outs and common errors that apply. Cite the section and paragraph numbers given; don't add provisions from memory.",
  exemptionList: "show the user the table of exemptions as given, then ask which one to open.",
  map: "show the user the stages and steps as a list, then ask where their request is up to.",
  questions: "ask the user these questions directly, as a short list, then call foi_start_request again with the answers.",
};

function toolError(message: string, structured: Record<string, unknown> = {}): Result {
  return { isError: true, content: [{ type: "text", text: message }], structuredContent: { error: message, ...structured } };
}

/** Whether this request's client declared form elicitation (MRTR) — a spec MUST before asking. */
function canElicit(ctx: ServerContext): boolean {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
  const caps = envelope?.[CLIENT_CAPABILITIES_META_KEY] as { elicitation?: { form?: unknown } } | undefined;
  return caps?.elicitation?.form !== undefined;
}

const STEP_IDS = STEPS.map((s) => s.id) as [string, ...string[]];
const TEMPLATE_IDS = TEMPLATES.map((t) => t.id) as [TemplateId, ...TemplateId[]];
const role = z.enum(["officer", "line_area"]).default("officer").describe("officer = FOI practitioner or decision-maker; line_area = business-area staff asked to search or give views");

const timelineOutput = z.looseObject({
  case_file: z.looseObject({}).optional(),
  timeline: z.looseObject({ status: z.string(), key_dates: z.array(z.looseObject({})) }).optional(),
});

export function registerTools(server: McpServer, env: Env): void {
  const corpus = new Corpus(env);

  // ---------------------------------------------------------------------------
  server.registerTool(
    "foi_process_map",
    {
      title: "FOI process map",
      description:
        "The stages and steps of handling an incoming FOI request under the FOI Act 1982 (Cth), with each step's id and whether this server gives full guided support ('ready') or reference material only ('planned'). " +
        "Use it to orient a practitioner or line-area officer, then open any step with foi_step_guidance.",
      inputSchema: z.object({
        role,
        stage: z.enum(["intake", "scope", "search", "exemptions", "decision"]).optional().describe("Only this stage"),
      }),
      outputSchema: z.looseObject({ stages: z.array(z.looseObject({})) }),
      annotations: READ_ONLY,
    },
    async ({ role, stage }) => {
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
      return result(lines.join("\n"), { role, stages }, PRESENT.map);
    },
  );

  // ---------------------------------------------------------------------------
  registerAppTool(
    server,
    "foi_start_request",
    {
      title: "Start a new FOI request",
      description:
        "Triage a newly received FOI request: tests validity against s 15(2), flags transfer, administrative access, personnel records (s 15A) and Part V amendment requests, " +
        "and creates the case file with the statutory dates (acknowledge by, decide by). Takes procedural facts about the request only — not the applicant's identity or the documents. " +
        "Missing facts are returned as questions to ask (or asked directly where the client supports forms). Show the user the verdict and the key dates table from the result.",
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
      const facts = { ...input } as Record<string, unknown>;
      // Fold in answers from an elicitation round, if this is the retry.
      const answers = acceptedContent<Record<string, unknown>>(ctx.mcpReq.inputResponses, "request_facts");
      if (answers) for (const [k, v] of Object.entries(answers)) if (v !== undefined && v !== "") facts[k] = v;

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
        return result(md, { status: "needs_information", missing, questions: missing.map((k) => questions[k]) }, PRESENT.questions) as never;
      }

      const issues: string[] = [];
      const actions: string[] = [];
      if (facts.generated_by_bot) issues.push("Generated by an automated system with no person making it: not a valid request ([3.23]). Confirm whether a person is making it before treating it as invalid.");
      if (facts.amendment_request) issues.push("This is a request to amend or annotate personal records — Part V (s 48), not an access request. Decide within 30 days (s 51D); see Guidelines Part 7.");
      if (facts.personnel_records) issues.push("Personnel records: if the agency has a routine procedure for employee access, s 15A may require it to be used first ([2.91]).");
      if (facts.in_writing === false) issues.push("Not in writing (s 15(2)(a)). Help the applicant put it in writing (s 15(3)).");
      if (facts.states_foi_act === false) issues.push("Does not say it is made under the FOI Act (s 15(2)(aa)). If intention is unclear, check with the applicant; consider administrative release ([3.5]–[3.12], [3.33]).");
      if (facts.has_contact_address === false) issues.push("No address for notices (s 15(2)(c)). Ask for one.");
      if (facts.identifies_documents === "no") issues.push("Does not identify the documents (s 15(2)(b)). Assist the applicant (s 15(3)); a refusal on this ground needs a request consultation under s 24AB first ([3.50]).");
      if (facts.identifies_documents === "unclear") actions.push("Scope is unclear but arguably identifiable: treat as valid and clarify with the applicant — the clock is already running ([3.250]).");

      const invalid =
        facts.generated_by_bot === true ||
        facts.amendment_request === true ||
        facts.in_writing === false ||
        facts.has_contact_address === false ||
        facts.states_foi_act === false ||
        facts.identifies_documents === "no";
      const validity = facts.amendment_request ? "part_v_amendment" : invalid ? "not_yet_valid" : "valid";

      if (facts.other_agency_more_connected) actions.push("Consider transfer under s 16 — get the other agency's agreement and notify the applicant (step intake.transfer).");
      if (facts.own_personal_information) actions.push("Own personal information: no charges (Charges Regs s 7(1)); s 47F does not apply merely because the information is about the applicant (s 47F(3)).");
      const tps = (facts.third_parties as string[] | undefined) ?? [];
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
        stage: validity === "valid" ? "intake.acknowledge" : "intake.validity",
        completed_steps: validity === "valid" ? ["intake.receive", "intake.validity"] : ["intake.receive"],
        events: [],
      });
      const asOf = (facts.as_of as string | undefined) ?? todayInCanberra();
      const tl = computeTimeline(cf, asOf);

      const verdict = {
        valid: "**Valid request** — the processing period started the day after receipt.",
        not_yet_valid:
          "**Not yet a valid request.** The 30-day clock starts the day after a request meeting s 15(2) is received; the dates below assume it was valid on the received date — update received_date if it becomes valid later.",
        part_v_amendment: "**Part V amendment request** — different process; dates below are for an access request and may not apply.",
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
        `start with the verdict (valid or not, and why) and any issues, then ${PRESENT.dates}`,
      ) as never;
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
      return result(md, { case_file, timeline: tl }, PRESENT.dates) as never;
    },
  );

  // ---------------------------------------------------------------------------
  server.registerTool(
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
    },
    async ({ step: stepId, role, case_file }) => {
      const step = STEP_BY_ID.get(stepId) as Step;
      const excerpts = await corpus.many(await expandReads(corpus, step.read));
      const tailored: string[] = [];
      if (case_file) {
        const tl = computeTimeline(case_file);
        if (tl.processing.effective_due)
          tailored.push(`Decision due ${longDate(tl.processing.effective_due)} (${tl.status_label.toLowerCase()}${tl.processing.days_remaining !== null ? `, ${tl.processing.days_remaining} days remaining` : ""}).`);
        if (tl.status === "deemed_refusal") tailored.push("The request is a deemed refusal: decide as soon as possible; no charges; consider s 15AC(4).");
        if (case_file.own_personal_information) tailored.push("Own personal information: no charges (Charges Regs s 7(1)); s 47F(3) applies to the applicant's own information.");
        if (case_file.third_parties?.length) tailored.push(`Third parties flagged: ${case_file.third_parties.join(", ")} — plan consultation and the s 15(6) extension.`);
      }
      const md = [renderStep(step, role, excerpts, tailored), "", sourcesLine(partsCited(step.read))].join("\n");
      const next = case_file ? { ...case_file, stage: step.id } : undefined;
      return result(
        md,
        {
          step: { ...step, checklist: step.checklist.filter((c) => !c.roles || c.roles.includes(role)) },
          role,
          excerpts: excerpts.map((e) => ({ id: e.id, ref: e.ref, source: sourceLabel(e), title: e.title, url: e.url, text: e.text })),
          ...(next ? { case_file: next } : {}),
        },
        PRESENT.step,
      );
    },
  );

  // ---------------------------------------------------------------------------
  server.registerTool(
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
        return result(
          md,
          {
            exemption: e,
            section_text: section?.kind === "passage" ? section.text : null,
            key_paragraphs: paras.map((p) => ({ id: p.id, ref: p.ref, title: p.title, url: p.url, text: p.text })),
          },
          PRESENT.exemption,
        );
      }
      const candidates = information ? suggestExemptions(information) : [];
      const list = candidates.length ? candidates : EXEMPTIONS;
      const md = [
        information
          ? candidates.length
            ? `## Exemptions that commonly apply to: _${information}_`
            : `## No exemption matched _${information}_ by type — the full list:`
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
      return result(md, { candidates: list.map(({ provision, name, kind, summary }) => ({ provision, name, kind, summary })) }, PRESENT.exemptionList);
    },
  );

  // ---------------------------------------------------------------------------
  const CONDITIONAL = EXEMPTIONS.filter((e) => e.kind === "conditional").map((e) => e.provision) as [string, ...string[]];
  registerAppTool(
    server,
    "foi_public_interest_test",
    {
      title: "Public interest test worksheet",
      description:
        "A worksheet for the public interest test on a conditionally exempt document (ss 11A(5), 11B): the s 11B(3) factors, the Guidelines' factor lists, and a check of the factors you propose against the irrelevant factors in s 11B(4) " +
        "(embarrassment, misinterpretation, seniority, confusion or debate) and against generic frankness-and-candour claims. Give short descriptions of factors, not document content. " +
        "Show the user any flagged factors and the factor table from the result.",
      inputSchema: z.object({
        provision: z.enum(CONDITIONAL).describe("The conditional exemption the document meets, e.g. 47C"),
        factors_for: z.array(z.string().max(300)).max(20).default([]).describe("Factors favouring access you have identified"),
        factors_against: z.array(z.string().max(300)).max(20).default([]).describe("Factors against access you have identified"),
      }),
      outputSchema: z.looseObject({ checks: z.array(z.looseObject({})) }),
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: DOCUMENT_URI } },
    },
    async ({ provision, factors_for, factors_against }) => {
      const checks = checkFactors(factors_for, factors_against);
      const flagged = checks.filter((c) => c.flags.length);
      const frank = checks.filter((c) => c.frankness);
      const e = EXEMPTION_BY_PROVISION.get(provision)!;
      const lines = [`## Public interest test — s ${provision} (${e.name})`, ""];
      if (flagged.length) {
        lines.push("### ⚠️ Possible irrelevant factors (s 11B(4)) — these must not be taken into account");
        for (const c of flagged) lines.push(`- "${c.factor}" → looks like ${c.flags.map((f) => `**${f.id}**: ${f.text}`).join("; ")}. Remove it, or restate the real harm (who, how, how likely) if there is one.`);
        lines.push("");
      }
      if (frank.length) {
        lines.push("### Frankness and candour");
        for (const c of frank) lines.push(`- "${c.factor}" — claims that release will inhibit future advice need specific evidence about this document and these circumstances; generic claims carry little weight ([6.245]–[6.252]).`);
        lines.push("");
      }
      if (!factors_for.length) lines.push("**No factors favouring access given.** Consider each s 11B(3) factor below; it is rare that disclosure would not promote the objects of the Act ([6.230]).", "");
      if (!factors_against.length) lines.push("**No factors against access given.** If none apply on the facts, access must be given (s 11A(5)).", "");
      lines.push("### Factors favouring access — s 11B(3) (consider each if relevant)");
      for (const f of STATUTORY_FOR) lines.push(`- **${f.id}** ${f.text}${factors_for.length ? "" : ""}`);
      lines.push("", "Other factors favouring access in the Guidelines ([6.231], non-exhaustive):", ...GUIDELINES_FOR.map((f) => `- ${f}`));
      lines.push("", "### Factors against access ([6.233], non-exhaustive — use only those the facts support)", ...GUIDELINES_AGAINST.map((f) => `- ${f}`));
      lines.push("", "### Irrelevant factors — s 11B(4)", ...IRRELEVANT.map((i) => `- **${i.id}** ${i.text}`));
      if (provision === "47B") lines.push("", "_s 47B: see also [6.240]–[6.244] on the public interest test and Commonwealth–State relations._");
      lines.push("", "### Your factors", "| Side | Factor | Check |", "|---|---|---|");
      for (const c of checks) lines.push(`| ${c.side} | ${c.factor} | ${c.flags.length ? `⚠️ ${c.flags.map((f) => f.id).join(", ")}` : c.frankness ? "needs evidence" : "ok"} |`);
      if (!checks.length) lines.push("| — | none given | |");
      lines.push("", "### Weighing", ...WEIGHING_STEPS.map((s, i) => `${i + 1}. ${s}`), "", sourcesLine(["6"]));
      const md = lines.join("\n");
      const view: DocumentView = {
        kind: "report",
        title: `Public interest test — s ${provision}`,
        subtitle: `${e.name} · ss 11A(5), 11B`,
        headline: [
          { label: "Factors for access", value: String(factors_for.length) },
          { label: "Factors against", value: String(factors_against.length) },
          { label: "Possible irrelevant factors", value: String(flagged.length) },
        ],
        flags: [
          ...flagged.map((c) => `**"${c.factor}"** looks like ${c.flags.map((f) => f.id).join(", ")}: it must not be taken into account.`),
          ...frank.map((c) => `**"${c.factor}"** is a frankness and candour claim: it needs specific evidence ([6.245]–[6.252]).`),
        ],
        body: md,
        filename: fileSlug("public-interest", provision),
      };
      return result(
        md,
        {
          provision,
          checks,
          irrelevant_flagged: flagged.length,
          statutory_factors_for: STATUTORY_FOR,
          guidelines_factors_for: GUIDELINES_FOR,
          guidelines_factors_against: GUIDELINES_AGAINST,
          weighing_steps: WEIGHING_STEPS,
          view,
        },
        PRESENT.publicInterest,
      ) as never;
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
      _meta: { ui: { resourceUri: DOCUMENT_URI } },
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
      const view: DocumentView = {
        kind: "draft",
        title: t.title,
        subtitle: [case_file?.reference, `for the ${t.audience.replace("_", " ")}`, t.provisions.join(", ")].filter(Boolean).join(" · "),
        must_include: t.must_include,
        unfilled,
        body: text,
        filename: fileSlug(case_file?.reference, t.id),
      };
      return result(
        md,
        { template: t.id, title: t.title, audience: t.audience, provisions: t.provisions, must_include: t.must_include, text, unfilled, view },
        PRESENT.draft,
      ) as never;
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
      _meta: { ui: { resourceUri: DOCUMENT_URI } },
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
      const view: DocumentView = {
        kind: "report",
        title: `Charges — preliminary assessment${case_file?.reference ? ` for ${case_file.reference}` : ""}`,
        subtitle: "FOI (Charges) Regulations 2019 · s 29(1)",
        headline: res.barred_by
          ? [{ label: "Charge", value: "$0.00" }]
          : [
              { label: "Total", value: aud(res.total) },
              { label: "Maximum deposit", value: aud(res.deposit_maximum) },
              { label: "Free decision hours", value: `${res.free_decision_hours} h` },
            ],
        flags: res.barred_by ? [res.barred_by] : [],
        body: md,
        filename: fileSlug(case_file?.reference, "charges-assessment"),
      };
      return result(md, { ...res, view }, PRESENT.charges) as never;
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
      _meta: { ui: { resourceUri: DOCUMENT_URI } },
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
      const view: DocumentView = {
        kind: "report",
        title: "Practical refusal — workload estimate",
        subtitle: `Sample of ${input.sample_documents} of ${input.documents_in_scope} documents (${res.sample_percent}%) · s 24AA`,
        headline: [
          { label: "Estimated work", value: `${res.total_hours} h` },
          { label: "Working days", value: String(res.total_days) },
          ...(res.fte_weeks !== undefined ? [{ label: "FOI team weeks", value: String(res.fte_weeks) }] : []),
        ],
        flags: res.cautions.slice(0, 2),
        extract: { label: "evidence statement", text: res.evidence_statement },
        body: md,
        filename: "practical-refusal-workload-estimate",
      };
      return result(md, { ...res, view }, PRESENT.workload) as never;
    },
  );

  // ---------------------------------------------------------------------------
  server.registerTool(
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
      // OpenAI's search contract: structured results mirrored as JSON text.
      return { content: [{ type: "text", text: JSON.stringify({ results, mode }) }], structuredContent: { results, mode } };
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
          ? (MANIFEST.guidelines as Record<string, { version: string; updated: string }>)[unit.part.replace("Part ", "")]
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
