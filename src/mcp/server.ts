/**
 * The MCP server factory: one McpServer per request (stateless, MCP 2026-07-28 via
 * SDK v2), serving 2025-era clients through the SDK's legacy stateless lane.
 */
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { type Env, MANIFEST } from "../corpus.ts";
import { registerApp } from "./app.ts";
import { registerPrompts } from "./prompts.ts";
import { registerResources } from "./resources.ts";
import { registerTools } from "./tools.ts";

export const NAME = "foi-navigator";
export const VERSION = `0.1.0+${MANIFEST.builtAt}`;

// Short, key point first: some hosts keep only the opening few hundred characters.
export const INSTRUCTIONS = `Guides Australian Government FOI practitioners and line-area staff through incoming requests under the FOI Act 1982 (Cth), citing the Act and the OAIC FOI Guidelines.

Typical flow: foi_start_request (new request → case file and dates) → foi_step_guidance for each step → foi_estimate_workload (practical refusal) and foi_estimate_charges (s 29) where relevant → foi_exemption_guide and foi_public_interest_test when examining documents → foi_draft_notice for letters → foi_calculate_deadlines whenever an event happens (acknowledgement, extension, consultation, charge, decision, access). foi_process_map shows all steps.

Results are for the user. Show drafts from foi_draft_notice in full, word for word; show date, charges and workload tables as given, not paraphrased. Each result ends with a short note on what to show.

The case file is client-held JSON: each tool that returns one expects it back, with new events appended. The server stores nothing.

Tools need procedural facts and general descriptions only — not applicant names or document content.

Dates come from foi_calculate_deadlines (calendar days; weekends roll forward; public holidays are not checked). Law and paragraph numbers come from search and fetch; the bundled sources are FOI Act ${MANIFEST.legislation.act.registerId} and the Guidelines as at ${MANIFEST.builtAt}.

Decisions remain with an authorised officer (s 23); outputs are drafts and guidance, not legal advice.`;

const DAY = { ttlMs: 86_400_000, cacheScope: "public" as const };

export function buildServer(env: Env): McpServer {
  const server = new McpServer(
    { name: NAME, version: VERSION, title: "FOI Navigator (Cth)" },
    {
      instructions: INSTRUCTIONS,
      cacheHints: {
        "tools/list": DAY,
        "prompts/list": DAY,
        "resources/list": DAY,
        "resources/templates/list": DAY,
        "server/discover": DAY,
      },
    },
  );
  registerTools(server, env);
  registerPrompts(server);
  registerResources(server, env);
  registerApp(server);
  return server;
}

/** One HTTP handler per isolate; a fresh server per request. */
let handler: ReturnType<typeof createMcpHandler> | null = null;
let handlerEnv: Env | null = null;
export function mcpHandler(env: Env) {
  if (!handler || handlerEnv !== env) {
    handlerEnv = env;
    handler = createMcpHandler(() => buildServer(env), { legacy: "stateless", responseMode: "json" });
  }
  return handler;
}
