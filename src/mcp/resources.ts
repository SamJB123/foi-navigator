/**
 * Resources: the reference material as documents, for clients that can attach them
 * (Claude Code @-mentions, VS Code "Add Context"). Every resource is mirrored by a tool
 * — fetch, foi_process_map, foi_exemption_guide — because ChatGPT and tools-only
 * clients cannot read resources.
 */
import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";
import { Corpus, type Env, GUIDELINE_PARTS, MANIFEST } from "../corpus.ts";
import { EXEMPTIONS, EXEMPTION_BY_PROVISION, normaliseProvision } from "../domain/exemptions.ts";
import { STAGES, stepsIn } from "../domain/workflow.ts";
import { DISCLAIMER, renderExemption } from "./render.ts";

const SECTION_ROWS = z.array(z.object({ parent: z.string(), ref: z.string(), title: z.string() }));
const PARENT_ROWS = z.array(z.object({ parent: z.string() }));

const DAY_MS = 86_400_000;
const cacheHint = { ttlMs: DAY_MS, cacheScope: "public" as const };
const md = (uri: URL, text: string) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text }] });

export const GUIDE_MD = `# FOI Navigator

Guided support for Australian Government FOI practitioners handling **incoming requests under the FOI Act 1982 (Cth)**, built on the Act (compilation ${MANIFEST.legislation.act.registerId}, in force ${MANIFEST.legislation.act.inForceFrom}), the FOI (Charges) Regulations 2019 and the OAIC FOI Guidelines.

## How it works
- **The case file** is a small JSON record of dates and procedural events. Tools return it; you pass it back. The server keeps no case data.
- **No personal information or document content is needed.** Use the agency reference, describe documents in general terms, and keep applicant names out.
- **Tool results cite** sections of the Act and Guidelines paragraphs; use \`fetch\` to read the full text.

## Tools
| Tool | Use it to |
|---|---|
| foi_process_map | See the stages and steps |
| foi_start_request | Triage a new request; create the case file |
| foi_calculate_deadlines | Recalculate dates after extensions, consultation, charges |
| foi_step_guidance | Get the checklist and law for any step (role: officer or line_area) |
| foi_estimate_workload | Evidence a practical refusal from a sample (s 24AA) |
| foi_estimate_charges | Calculate charges and deposits (Charges Regulations) |
| foi_exemption_guide | Work through an exemption's elements |
| foi_public_interest_test | Set your factors beside s 11B(3), s 11B(4) and the weighing steps |
| foi_draft_notice | Draft acknowledgements, s 24AB and s 29 notices, consultation letters, search minutes, statements of reasons, disclosure log entries |
| search / fetch | Find and read the Act and Guidelines |

## Coverage
All five stages: intake and deadlines; scope, charges and practical refusal; searches and third-party consultation; exemptions and the public interest test; decision, release, disclosure log and review.

## Limits
Calendar days; weekends roll to the next business day, but public holidays are not checked. ${DISCLAIMER}
`;

export function registerResources(server: McpServer, env: Env): void {
  const corpus = new Corpus(env);

  server.registerResource(
    "guide",
    "foi://guide",
    { title: "How to use FOI Navigator", description: "What the server does, the case file, tools and coverage.", mimeType: "text/markdown", cacheHint },
    async (uri) => md(uri, GUIDE_MD),
  );

  server.registerResource(
    "process-map",
    "foi://process-map",
    { title: "FOI process map", description: "Stages and steps for an incoming Commonwealth FOI request.", mimeType: "text/markdown", cacheHint },
    async (uri) =>
      md(
        uri,
        [
          "# FOI process map",
          ...STAGES.flatMap((s) => [
            "",
            `## ${s.title}${s.status === "planned" ? " (planned)" : ""}`,
            s.summary,
            ...stepsIn(s.id).map((st) => `- \`${st.id}\` **${st.title}** — ${st.purpose}`),
          ]),
        ].join("\n"),
      ),
  );

  server.registerResource(
    "sources",
    "foi://sources",
    { title: "Sources, versions and licences", description: "Which compilation of the Act and which Guidelines versions are bundled, and attribution.", mimeType: "application/json", cacheHint },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(MANIFEST, null, 2) }] }),
  );

  server.registerResource(
    "act-section",
    new ResourceTemplate("foi://act/{section}", {
      list: async () => {
        const results = SECTION_ROWS.parse(
          (await env.DB.prepare("SELECT DISTINCT parent, ref, title FROM passages WHERE source = 'act' AND parent LIKE 'act:s%' ORDER BY ord").all()).results,
        );
        const seen = new Set<string>();
        return {
          resources: results
            .filter((r) => !seen.has(r.parent) && seen.add(r.parent))
            .map((r) => ({ uri: `foi://act/${r.parent.slice(5)}`, name: `${r.ref} ${r.title}`, mimeType: "text/markdown" })),
        };
      },
      complete: {
        section: async (value) => {
          const { results } = await env.DB.prepare("SELECT DISTINCT parent FROM passages WHERE source = 'act' AND parent LIKE ? ORDER BY ord LIMIT 20")
            .bind(`act:s${value.toUpperCase()}%`)
            .all();
          return PARENT_ROWS.parse(results).map((r) => r.parent.slice(5));
        },
      },
    }),
    { title: "FOI Act section", description: "One section of the FOI Act 1982, e.g. foi://act/47F.", mimeType: "text/markdown", cacheHint },
    async (uri, { section }) => {
      const unit = await corpus.unit(`act:s${String(section).toUpperCase()}`);
      if (!unit || unit.kind !== "passage") return md(uri, `No section ${section} in the FOI Act.`);
      return md(uri, `# FOI Act 1982 ${unit.ref} — ${unit.title}\n_${unit.heading}_\n\n${unit.text}\n\n${unit.url}\n\n_${MANIFEST.licence.legislation}_`);
    },
  );

  server.registerResource(
    "guidelines-paragraph",
    new ResourceTemplate("foi://guidelines/{paragraph}", { list: undefined }),
    { title: "FOI Guidelines paragraph", description: "One numbered paragraph of the OAIC FOI Guidelines, e.g. foi://guidelines/6.123.", mimeType: "text/markdown", cacheHint },
    async (uri, { paragraph }) => {
      const row = await corpus.get(`gl:${paragraph}`);
      if (!row) return md(uri, `No Guidelines paragraph [${paragraph}].`);
      return md(uri, `# FOI Guidelines ${row.part} ${row.ref}\n_${row.heading}_\n\n${row.text}\n\n${row.url}\n\n_${MANIFEST.licence.guidelines}_`);
    },
  );

  server.registerResource(
    "guidelines-part",
    new ResourceTemplate("foi://guidelines/part/{part}", {
      list: async () => ({
        resources: Object.entries(GUIDELINE_PARTS).map(([n, g]) => ({
          uri: `foi://guidelines/part/${n}`,
          name: g.title,
          mimeType: "text/markdown",
        })),
      }),
    }),
    { title: "FOI Guidelines part outline", description: "Headings and paragraph ranges of one part of the Guidelines.", mimeType: "text/markdown", cacheHint },
    async (uri, { part }) => {
      const unit = await corpus.unit(`gl:part${part}`);
      if (!unit || unit.kind !== "outline") return md(uri, `No Guidelines Part ${part}.`);
      const meta = GUIDELINE_PARTS[String(part)];
      return md(
        uri,
        [`# ${unit.title}`, `_Version ${meta?.version}, ${meta?.updated} · ${unit.url}_`, "", ...unit.sections.map((s) => `- ${s.from}–${s.to} ${s.heading}`)].join("\n"),
      );
    },
  );

  server.registerResource(
    "exemption",
    new ResourceTemplate("foi://exemptions/{provision}", {
      list: async () => ({
        resources: EXEMPTIONS.map((e) => ({ uri: `foi://exemptions/${e.provision}`, name: `s ${e.provision} ${e.name}`, mimeType: "text/markdown" })),
      }),
      complete: { provision: (value) => EXEMPTIONS.map((e) => e.provision).filter((p) => p.startsWith(value.toUpperCase())) },
    }),
    { title: "Exemption guide", description: "Elements, carve-outs and common errors for one exemption, e.g. foi://exemptions/47C.", mimeType: "text/markdown", cacheHint },
    async (uri, { provision }) => {
      const e = EXEMPTION_BY_PROVISION.get(normaliseProvision(String(provision)));
      if (!e) return md(uri, `No exemption s ${provision}.`);
      const section = await corpus.unit(`act:s${e.provision}`);
      const paras = await corpus.many(e.key_paragraphs);
      return md(uri, renderExemption(e, section?.kind === "passage" ? section.text : null, paras));
    },
  );
}
