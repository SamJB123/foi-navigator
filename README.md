# FOI Navigator

A public MCP connector that guides Australian Government FOI practitioners, and the line-area staff who support them, through **incoming requests under the *Freedom of Information Act 1982* (Cth)**. It works in Claude, ChatGPT, Microsoft Copilot (Copilot Studio, M365 Copilot, VS Code) and any MCP client.

**Live:** https://foi-navigator.aicolab.workers.dev (connector URL: `/mcp`, no authentication)

## What it does

| Stage | Status | Support |
|---|---|---|
| 1. Intake and deadlines | ready | Validity (s 15), transfer (s 16), acknowledgement, statutory date engine, planning and line-area tasking |
| 2. Scope, charges, practical refusal | ready | Sample-based workload estimator (s 24AA), s 24AB request consultation, charges calculator (Charges Regs Sch 1, regs 7, 12), s 29 notices and contention decisions |
| 3. Searches and third-party consultation | ready | Search planning and search minutes, s 24A and s 17, consultation under ss 26A/27/27A with the s 15(6) extension, third-party decision notices and release timing |
| 4. Exemptions | ready | Document schedule, line-area views, exemption elements (ss 33–47J), public interest test with s 11B(4) checks |
| 5. Decision, release, review | ready | s 23 authorisation, s 26 statement of reasons, third-party review windows, disclosure log (s 11C), internal/IC review |

Every answer cites the Act or a numbered paragraph of the OAIC FOI Guidelines, drawn from a bundled, versioned corpus. The full text is in D1 and searchable through hybrid search (FTS5 + Vectorize/bge-m3).

### Design principles

- **Tools-first, progressive enhancement.** Tools are the only MCP feature every client supports, so every tool returns complete markdown plus `structuredContent`. Prompts, resources, elicitation and the MCP App add to that, but nothing depends on them.
- **Client-held case file.** The server is stateless and stores nothing. Tools return a small JSON case file (dates and procedural events) and take it back. There is no applicant identity and no document content.
- **Server never sees documents.** Tools take procedural facts and general descriptions. Analysis of documents happens in the user's own AI tool, applying the frameworks the server provides.
- **Deterministic dates.** Deadlines come from a tested engine (`src/domain/deadlines.ts`), never from the model.

## MCP surface

| Kind | What |
|---|---|
| Tools (11, all read-only) | `foi_process_map`, `foi_start_request`, `foi_calculate_deadlines`, `foi_step_guidance`, `foi_estimate_workload`, `foi_estimate_charges`, `foi_exemption_guide`, `foi_public_interest_test`, `foi_draft_notice`, `search`, `fetch` (the last two follow OpenAI's search/fetch contract) |
| MCP Apps | `ui://foi-navigator/timeline.html`, an interactive deadline timeline on `foi_start_request` and `foi_calculate_deadlines`. `ui://foi-navigator/document.html`, a card for drafts and reports with key figures, warnings, slots to fill, copy (rich text) and download, on `foi_draft_notice`, `foi_estimate_charges`, `foi_estimate_workload` and `foi_public_interest_test`. Shows in Claude, ChatGPT, VS Code and M365 Copilot; other clients get text. |
| Presentation | Every user-facing result ends with an assistant-only note (`annotations.audience: ["assistant"]`) saying what to show the user: drafts in full and word for word, date, charges and workload tables as given. |
| Elicitation | `foi_start_request` asks for missing validity facts with a form (MRTR, 2026-07-28) when the client declares form elicitation. Otherwise it returns the questions as text. |
| Prompts (11) | `triage_new_request`, `check_deadlines`, `assess_practical_refusal`, `estimate_charges`, `plan_searches`, `consult_third_party`, `assess_exemption`, `draft_statement_of_reasons`, `task_line_area`, `respond_as_line_area`, `draft_notice` |
| Templates (17) | acknowledgement, request clarification, s 15AA and s 15(6) extensions, s 24AB notice, practical refusal decision, s 29 charges notice, charges contention decision, search minute, line-area tasking and response, third-party consultation and decision notices, document schedule, statement of reasons, disclosure log entry, internal review decision |
| Resources | `foi://guide`, `foi://process-map`, `foi://sources`, `foi://act/{section}`, `foi://guidelines/{paragraph}`, `foi://guidelines/part/{part}`, `foi://exemptions/{provision}` |

Protocol: `@modelcontextprotocol/server` 2.3.1 `createMcpHandler`, stateless (spec 2026-07-28), with the legacy stateless lane for 2025-era clients. There is no Durable Object, and no `agents` McpAgent.

## Layout

```
src/
  index.ts            Worker routes: /mcp, /, /healthz, /admin/reindex
  corpus.ts           D1 + Vectorize hybrid search, citation parsing
  explainer.html      the landing page: how the connector works, for FOI staff new to MCP
  landing.ts          serves it, filling in the connector URL and source versions
  domain/             pure logic and curated content (no I/O)
    case-file.ts      the client-held case file schema
    deadlines.ts      the statutory date engine
    charges.ts        Charges Regulations calculator (Sch 1, regs 7, 12)
    workload.ts       sample-based practical refusal estimate (s 24AA)
    workflow.ts       stages, steps, checklists (every citation tested)
    exemptions.ts     Part IV exemptions as element checklists
    public-interest.ts  s 11B factors and the s 11B(4) tripwire
    templates.ts      notice templates with mandatory content
  mcp/                tools, prompts, resources, MCP App, markdown rendering
  widget/             the MCP App source (bundled into dist/timeline.html)
scripts/              fetch sources → build corpus → index vectors; widget build; live smoke test
data/content/         passages.json + manifest.json (versions, licences)
data/d1/content.sql   the D1 load (generated)
test/                 deadlines, citation integrity, MCP protocol (workerd)
```

## Updating the law and guidance

The OAIC revises the Guidelines often, so check versions in `data/content/manifest.json`.

```sh
pnpm content:fetch      # Act + Charges Regs (legislation.gov.au API) and Guidelines HTML → sources/
pnpm content:build      # → data/content/*.json, data/d1/content.sql
pnpm test               # citation tests fail if a cited paragraph moved or vanished
pnpm db:load:remote     # reload D1
FOI_ADMIN_TOKEN=… node scripts/index-vectors.ts   # re-embed into Vectorize
pnpm deploy
node scripts/smoke.ts   # live checks, both protocol eras
```

## Deploying your own copy

```sh
pnpm install
wrangler d1 create foi-navigator          # put the id in wrangler.jsonc
wrangler vectorize create foi-navigator-passages --dimensions=1024 --metric=cosine
wrangler vectorize create-metadata-index foi-navigator-passages --property-name=source --type=string
pnpm db:load:remote && pnpm deploy
wrangler secret put ADMIN_TOKEN
FOI_URL=https://<your worker> FOI_ADMIN_TOKEN=… node scripts/index-vectors.ts
```

## Limits

- Commonwealth only. The structure (a date engine, curated steps and exemptions, and a corpus) is designed to take a state or territory jurisdiction next.
- Calendar days. Weekend due dates roll to the next business day ([3.247]). **Public holidays are not checked**, and every timeline says so.
- The lapsed FOI Amendment Bill 2025 is not modelled. Rules live in data and code that can absorb a future Bill.
- Guidance, not legal advice. Decisions are made by an authorised officer (s 23).

## Sources and licence

- FOI Act 1982 and FOI (Charges) Regulations 2019 come from the Federal Register of Legislation (CC BY 4.0). "Based on content from the Federal Register of Legislation. For the latest information on Australian Government legislation please go to https://www.legislation.gov.au."
- OAIC FOI Guidelines come from www.oaic.gov.au, © Commonwealth of Australia, CC BY 4.0. They have been reformatted into passages and are not endorsed by the OAIC.
