/**
 * Prompts: the common FOI jobs as slash commands (Claude, VS Code, Gemini CLI). Each
 * one only sequences the tools, so a client without prompts loses nothing — the same
 * flow is reachable by asking.
 */
import { type McpServer, completable } from "@modelcontextprotocol/server";
import { z } from "zod";
import { EXEMPTIONS } from "../domain/exemptions.ts";
import { TEMPLATES } from "../domain/templates.ts";

const user = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });

const PRIVACY =
  "Keep applicant names and the documents' content out of tool calls: the tools need procedural facts and short descriptions only. Cite provisions and Guidelines paragraphs from tool results, not from memory.";

const provisions = EXEMPTIONS.map((e) => e.provision);

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "triage_new_request",
    {
      title: "Triage a new FOI request",
      description: "Check validity, set the statutory dates, and plan the work for a newly received request.",
      argsSchema: z.object({
        received_date: z.string().optional().describe("Date received, YYYY-MM-DD"),
        summary: z.string().optional().describe("One line on what is sought (no names)"),
      }),
    },
    ({ received_date, summary }) =>
      user(
        `Help me triage a new FOI request under the FOI Act 1982 (Cth)${received_date ? `, received ${received_date}` : ""}${summary ? `, for: ${summary}` : ""}.\n\n` +
          "1. Ask me for any validity facts you don't have, then call foi_start_request.\n" +
          "2. Explain the result: is it valid, what are the acknowledgement and decision dates, and any issues (transfer, personal information, third parties).\n" +
          "3. Open foi_step_guidance for intake.plan with the case file, and tell me which later stages this request is likely to need.\n" +
          "4. Offer to draft the acknowledgement (foi_draft_notice, acknowledgement) and a line-area tasking (line_area_tasking).\n\n" +
          PRIVACY,
      ),
  );

  server.registerPrompt(
    "check_deadlines",
    {
      title: "Check FOI deadlines",
      description: "Recalculate a request's statutory dates after extensions, consultation or charges, and say what is due next.",
      argsSchema: z.object({ case_file: z.string().optional().describe("The case file JSON from an earlier tool result") }),
    },
    ({ case_file }) =>
      user(
        `Check the statutory deadlines for my FOI request.${case_file ? `\n\nCase file:\n${case_file}` : " Ask me for the case file, or the received date and what has happened since (acknowledgement, extensions, consultation, charges)."}\n\n` +
          "Call foi_calculate_deadlines. Then tell me plainly: the decision due date, how many days are left, anything overdue, and whether an extension (s 15(6), s 15AA, s 15AB) is available and how. Don't round or move dates yourself — use the tool's dates.",
      ),
  );

  server.registerPrompt(
    "assess_exemption",
    {
      title: "Assess an exemption",
      description: "Work through an exemption or conditional exemption element by element, and the public interest test if it is conditional.",
      argsSchema: z.object({
        provision: completable(z.string().describe("e.g. 47F, 47C, 42"), (value) => provisions.filter((p) => p.startsWith(value.toUpperCase()))),
        information: z.string().optional().describe("The kind of information (not the content), e.g. 'staff names in emails'"),
      }),
    },
    ({ provision, information }) =>
      user(
        `Help me decide whether s ${provision} of the FOI Act applies${information ? ` to ${information}` : ""}.\n\n` +
          `1. Call foi_exemption_guide with provision ${provision}. Walk me through each element and ask me for the facts and evidence I have for it — one element at a time.\n` +
          "2. Point out carve-outs and the common errors that apply here.\n" +
          "3. If it is a conditional exemption and the elements are met, collect my factors for and against and run foi_public_interest_test, then help me weigh them.\n" +
          "4. Summarise the findings of fact and reasons in a form I can use in the statement of reasons.\n\n" +
          PRIVACY,
      ),
  );

  server.registerPrompt(
    "draft_statement_of_reasons",
    {
      title: "Draft a statement of reasons",
      description: "Build a s 26 decision notice from the case file and the decision-maker's findings, with every mandatory element.",
      argsSchema: z.object({ case_file: z.string().optional().describe("The case file JSON") }),
    },
    ({ case_file }) =>
      user(
        `Help me draft the decision and statement of reasons (s 26) for my FOI request.${case_file ? `\n\nCase file:\n${case_file}` : ""}\n\n` +
          "1. Call foi_step_guidance for decision.statement_of_reasons and use its checklist.\n" +
          "2. Ask me for the decision on each document, the provisions relied on, my findings of fact and the evidence, and — for conditional exemptions — the public interest factors and their weight.\n" +
          "3. Call foi_draft_notice with template statement_of_reasons, filling the slots from my answers, and show me the full draft. Keep the review-rights section exactly as provided.\n" +
          "4. List any [[slots]] still unfilled and any mandatory element that is weak. The reasoning must be mine as the decision-maker.\n\n" +
          PRIVACY,
      ),
  );

  server.registerPrompt(
    "task_line_area",
    {
      title: "Task a line area",
      description: "Prepare a tasking asking a business area to search for documents and give evidence-based views on sensitivities.",
      argsSchema: z.object({ case_file: z.string().optional().describe("The case file JSON") }),
    },
    ({ case_file }) =>
      user(
        `Prepare a line-area tasking for my FOI request.${case_file ? `\n\nCase file:\n${case_file}` : ""}\n\n` +
          "Ask me which business area, any agreed scope exclusions, and the return date (leave time before the statutory due date — check with foi_calculate_deadlines). Then call foi_draft_notice with template line_area_tasking, fill it in, and show me the full draft.",
      ),
  );

  server.registerPrompt(
    "respond_as_line_area",
    {
      title: "Respond to an FOI tasking (line area)",
      description: "For business-area staff: prepare a search record and specific, evidence-based views on release for the FOI team.",
      argsSchema: z.object({ reference: z.string().optional().describe("The FOI reference on the tasking") }),
    },
    ({ reference }) =>
      user(
        `I work in a line area and the FOI team has asked me to search for documents and give my views on release${reference ? ` for ${reference}` : ""}.\n\n` +
          "1. Call foi_step_guidance for exemptions.line_area_views with role line_area and explain, in plain English, what the FOI team needs from me.\n" +
          "2. Help me record my search (where, terms, date range, results).\n" +
          "3. For anything I think is sensitive, ask me what the harm would be, who it affects, how likely it is and the facts that show it. Check my reasons against s 11B(4) (embarrassment, misunderstanding, seniority, confusion) and tell me if any rely on them.\n" +
          "4. Call foi_draft_notice with template line_area_sensitivity_response, fill it in, and show me the full draft.\n\n" +
          "Describe the documents and harms in general terms; don't paste document content.",
      ),
  );

  server.registerPrompt(
    "assess_practical_refusal",
    {
      title: "Assess a practical refusal",
      description: "Estimate the work in a large or vague request from a sample, test 'substantial and unreasonable', and prepare the s 24AB request consultation notice.",
      argsSchema: z.object({ case_file: z.string().optional().describe("The case file JSON") }),
    },
    ({ case_file }) =>
      user(
        `Help me decide whether a practical refusal reason exists for my FOI request (ss 24, 24AA).${case_file ? `\n\nCase file:\n${case_file}` : ""}\n\n` +
          "1. Call foi_step_guidance for scope.practical_refusal. Ask whether I have tried informal contact with the applicant first.\n" +
          "2. Ask me for: documents found in scope, the sample I assessed and the minutes it took, estimated search hours, consultation and redaction effort. Call foi_estimate_workload.\n" +
          "3. Help me reason through 'substantial' and 'unreasonable' for my agency, and check I haven't relied on the applicant's reasons, a fixed hours ceiling or poor record-keeping.\n" +
          "4. If a reason exists, draft the notice (foi_draft_notice, template s24AB_notice) with the evidence statement and concrete revision suggestions, show me the full draft, and remind me to record s24AB_notice in the case file.\n\n" +
          PRIVACY,
      ),
  );

  server.registerPrompt(
    "estimate_charges",
    {
      title: "Estimate and notify charges",
      description: "Decide whether to charge, calculate the preliminary assessment and deposit, and draft the s 29 notice — or decide a contention.",
      argsSchema: z.object({ case_file: z.string().optional().describe("The case file JSON") }),
    },
    ({ case_file }) =>
      user(
        `Help me with charges for my FOI request.${case_file ? `\n\nCase file:\n${case_file}` : ""}\n\n` +
          "1. First check whether a charge is allowed at all (the applicant's personal information; a late decision) and whether it is worth imposing (lowest reasonable cost). Use foi_step_guidance for scope.charges.\n" +
          "2. Ask me for search hours, decision-making hours and any copying or other costs, and call foi_estimate_charges with the case file.\n" +
          "3. If I decide to charge, draft the notice (foi_draft_notice, template s29_charges_notice) with the itemised breakdown, and show me the full draft.\n" +
          "4. If the applicant has already contested the charge, instead use scope.charges_contention and template charges_contention_decision, and help me work through hardship and the s 29(5)(b) public interest.\n\n" +
          PRIVACY,
      ),
  );

  server.registerPrompt(
    "plan_searches",
    {
      title: "Plan and record searches",
      description: "Plan reasonable searches across all likely locations, task the business areas, and record them in a search minute (or a s 24A explanation).",
      argsSchema: z.object({
        case_file: z.string().optional().describe("The case file JSON"),
        role: completable(z.string().optional().describe("officer or line_area"), (value) => ["officer", "line_area"].filter((r) => r.startsWith(value ?? ""))),
      }),
    },
    ({ case_file, role }) =>
      user(
        `Help me ${role === "line_area" ? "search for documents the FOI team has asked my area for" : "plan and record the searches for my FOI request"}.${case_file ? `\n\nCase file:\n${case_file}` : ""}\n\n` +
          `1. Call foi_step_guidance for search.searches${role === "line_area" ? " with role line_area" : ""} and turn it into a search plan for this request: locations, systems, people, terms and date range.\n` +
          "2. As I report what was searched, keep a running record, then fill in foi_draft_notice template search_minute and show me the full minute.\n" +
          "3. If documents can't be found or don't exist, use search.not_found to check s 24A is satisfied and draft the explanation for the statement of reasons.\n\n" +
          PRIVACY,
      ),
  );

  server.registerPrompt(
    "consult_third_party",
    {
      title: "Consult a third party",
      description: "Decide whether s 26A, 27 or 27A consultation is needed, extend time, draft the letter, and later time the release after their review window.",
      argsSchema: z.object({ case_file: z.string().optional().describe("The case file JSON") }),
    },
    ({ case_file }) =>
      user(
        `Help me with third-party consultation on my FOI request.${case_file ? `\n\nCase file:\n${case_file}` : ""}\n\n` +
          "1. Call foi_step_guidance for search.consultation. Ask me, in general terms, what kind of third-party information is involved, and help me decide whether consultation is required and reasonably practicable.\n" +
          "2. If it is: draft the applicant's extension notice (template extension_s15_6_notice) and the consultation letter (template third_party_consultation), showing me each draft in full; tell me to record extension_s15_6 and recalculate with foi_calculate_deadlines.\n" +
          "3. When submissions come back, use search.third_party_decision to weigh them; if releasing over an objection, draft third_party_decision_notice and tell me the earliest release date from foi_calculate_deadlines after I record third_party_decision_notice.\n\n" +
          PRIVACY,
      ),
  );

  server.registerPrompt(
    "draft_notice",
    {
      title: "Draft an FOI notice",
      description: "Draft any of the available notices or working documents from the case file.",
      argsSchema: z.object({
        template: completable(z.string().describe(TEMPLATES.map((t) => t.id).join(", ")), (value) => TEMPLATES.map((t) => t.id).filter((id) => id.startsWith(value))),
        case_file: z.string().optional().describe("The case file JSON"),
      }),
    },
    ({ template, case_file }) =>
      user(
        `Draft the FOI notice "${template}".${case_file ? `\n\nCase file:\n${case_file}` : ""}\n\nCall foi_draft_notice. Ask me for the slot values it lists as unfilled, then show me the completed draft in full, word for word, and its must-include checklist.`,
      ),
  );
}
