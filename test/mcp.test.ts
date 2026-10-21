/**
 * The MCP surface end to end, through the Worker's fetch handler: both protocol eras,
 * every tool, resources, prompts, the MCP App resource and MRTR elicitation.
 */
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../src/index.ts";

const ORIGIN = "https://foi.test";
let id = 1;

async function parse(res: Response) {
  const text = await res.text();
  const body = text.startsWith("event:") || text.startsWith("data:") ? text.split("\n").filter((l) => l.startsWith("data:")).pop()!.slice(5) : text;
  return JSON.parse(body);
}

/** A 2025-era request (legacy stateless lane), as Claude.ai and Copilot Studio send today. */
async function legacy(method: string, params: Record<string, unknown> = {}) {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
      body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }),
    }),
    env,
  );
  expect(res.status).toBe(200);
  return parse(res);
}

/** A 2026-07-28 request: per-request _meta envelope and routing headers. */
async function modern(method: string, params: Record<string, unknown> = {}, caps: Record<string, unknown> = {}) {
  const name = typeof params.name === "string" ? params.name : typeof params.uri === "string" ? params.uri : undefined;
  const res = await worker.fetch(
    new Request(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        ...(name ? { "mcp-name": name } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: id++,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": caps,
            "io.modelcontextprotocol/clientInfo": { name: "foi-test", version: "0" },
          },
        },
      }),
    }),
    env,
  );
  return parse(res);
}

const call = (name: string, args: Record<string, unknown>) => legacy("tools/call", { name, arguments: args });

describe("discovery", () => {
  it("lists the eleven read-only tools, with the App on the two timeline tools", async () => {
    const { result } = await legacy("tools/list");
    const tools = result.tools as { name: string; annotations?: { readOnlyHint?: boolean }; _meta?: Record<string, unknown>; title?: string }[];
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "fetch",
        "foi_calculate_deadlines",
        "foi_draft_notice",
        "foi_estimate_charges",
        "foi_estimate_workload",
        "foi_exemption_guide",
        "foi_process_map",
        "foi_public_interest_test",
        "foi_start_request",
        "foi_step_guidance",
        "search",
      ].sort(),
    );
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
      expect(t.title, t.name).toBeTruthy();
    }
    const withUi = (uri: string) => tools.filter((t) => JSON.stringify(t._meta ?? {}).includes(uri)).map((t) => t.name).sort();
    expect(withUi("ui://foi-navigator/timeline.html")).toEqual(["foi_calculate_deadlines", "foi_start_request"]);
    expect(withUi("ui://foi-navigator/document.html")).toEqual(["foi_draft_notice", "foi_estimate_charges", "foi_estimate_workload", "foi_public_interest_test"]);
  });

  it("tells the assistant to show user-facing results, and gives the document view a card", async () => {
    const { result } = await call("foi_draft_notice", { template: "acknowledgement", case_file: { received_date: "2026-11-05", reference: "FOI-1", events: [] } });
    const [doc, note] = result.content;
    expect(doc.text).toContain("## Draft: Acknowledgement of FOI request");
    expect(note.annotations.audience).toEqual(["assistant"]);
    expect(note.text).toMatch(/in full and word for word/);
    const view = result.structuredContent.view;
    expect(view.kind).toBe("draft");
    expect(view.body).toBe(result.structuredContent.text);
    expect(view.unfilled.length).toBeGreaterThan(0);
    expect(view.filename).toBe("foi-1-acknowledgement");

    const ch = (await call("foi_estimate_charges", { search_hours: 6, decision_hours: 12 })).result;
    expect(ch.structuredContent.view.headline[0]).toEqual({ label: "Total", value: "$230.00" });
    const pi = (await call("foi_public_interest_test", { provision: "47C", factors_against: ["release would embarrass the Minister"] })).result;
    expect(pi.structuredContent.view.flags[0]).toContain("embarrass");
    for (const name of ["foi_process_map", "foi_exemption_guide"]) {
      const r = (await call(name, {})).result;
      expect(r.content.at(-1).text, name).toMatch(/^Presenting this result:/);
    }
  });

  it("answers a 2026-07-28 tools/list with cache hints", async () => {
    const { result } = await modern("tools/list");
    expect(result.tools.length).toBe(11);
    expect(result.cacheScope).toBe("public");
  });

  it("lists prompts and resources", async () => {
    const prompts = (await legacy("prompts/list")).result.prompts.map((p: { name: string }) => p.name);
    expect(prompts).toEqual(expect.arrayContaining(["triage_new_request", "assess_exemption", "respond_as_line_area", "draft_statement_of_reasons"]));
    const resources = (await legacy("resources/list")).result.resources.map((r: { uri: string }) => r.uri);
    expect(resources).toEqual(expect.arrayContaining(["foi://guide", "foi://process-map", "foi://sources", "ui://foi-navigator/timeline.html", "foi://act/47F", "foi://exemptions/47C"]));
  });

  it("serves the MCP Apps as self-contained HTML resources", async () => {
    for (const uri of ["ui://foi-navigator/timeline.html", "ui://foi-navigator/document.html"]) {
      const { result } = await legacy("resources/read", { uri });
      const c = result.contents[0];
      expect(c.mimeType, uri).toBe("text/html;profile=mcp-app");
      expect(c.text, uri).toContain("<main id=\"app\">");
      expect(c.text, uri).not.toMatch(/<script[^>]+src=/);
    }
  });

  it("reads a section and a paragraph as resources", async () => {
    const act = (await legacy("resources/read", { uri: "foi://act/47F" })).result.contents[0].text;
    expect(act).toContain("unreasonable disclosure of personal information");
    const gl = (await legacy("resources/read", { uri: "foi://guidelines/3.247" })).result.contents[0].text;
    expect(gl).toContain("calendar days");
  });

  it("returns a prompt that sequences the tools", async () => {
    const { result } = await legacy("prompts/get", { name: "assess_exemption", arguments: { provision: "47C" } });
    expect(result.messages[0].content.text).toContain("foi_exemption_guide");
  });
});

describe("intake", () => {
  it("asks for missing facts in text when the client cannot elicit", async () => {
    const { result } = await call("foi_start_request", { reference: "FOI-1" });
    expect(result.structuredContent.status).toBe("needs_information");
    expect(result.content[0].text).toContain("What date was the request received");
  });

  it("elicits missing facts by MRTR when the client declares form elicitation", async () => {
    const res = await modern("tools/call", { name: "foi_start_request", arguments: { reference: "FOI-1" } }, { elicitation: { form: {} } });
    expect(JSON.stringify(res)).toContain("input_required");
    expect(JSON.stringify(res)).toContain("received_date");
  });

  it("folds in elicited answers on the retry, and does not ask twice after a decline", async () => {
    const caps = { elicitation: { form: {} } };
    const answered = await modern(
      "tools/call",
      {
        name: "foi_start_request",
        arguments: { reference: "FOI-1", as_of: "2026-11-06" },
        inputResponses: {
          request_facts: {
            action: "accept",
            content: { received_date: "2026-11-05", in_writing: true, states_foi_act: true, identifies_documents: "yes", has_contact_address: true },
          },
        },
      },
      caps,
    );
    expect(answered.result.structuredContent.validity).toBe("valid");
    const declined = await modern(
      "tools/call",
      { name: "foi_start_request", arguments: { reference: "FOI-1" }, inputResponses: { request_facts: { action: "decline" } } },
      caps,
    );
    expect(declined.result.structuredContent.status).toBe("needs_information");
  });

  it("creates the case file and dates for a valid request", async () => {
    const { result } = await call("foi_start_request", {
      reference: "FOI-2026-0412",
      received_date: "2026-11-05",
      in_writing: true,
      states_foi_act: true,
      identifies_documents: "yes",
      has_contact_address: true,
      third_parties: ["business"],
      as_of: "2026-11-06",
    });
    const sc = result.structuredContent;
    expect(sc.validity).toBe("valid");
    expect(sc.case_file.reference).toBe("FOI-2026-0412");
    expect(sc.timeline.processing.effective_due).toBe("2026-12-07");
    expect(result.content[0].text).toContain("s 27");
  });

  it("flags an invalid request", async () => {
    const { result } = await call("foi_start_request", {
      received_date: "2026-11-05",
      in_writing: true,
      states_foi_act: true,
      identifies_documents: "no",
      has_contact_address: true,
    });
    expect(result.structuredContent.validity).toBe("not_yet_valid");
    expect(result.content[0].text).toContain("s 24AB");
  });

  it("recalculates deadlines from events", async () => {
    const { result } = await call("foi_calculate_deadlines", {
      case_file: { received_date: "2026-11-02", events: [{ type: "extension_s15_6", date: "2026-11-10" }] },
      as_of: "2026-11-11",
    });
    expect(result.structuredContent.timeline.processing.effective_due).toBe("2027-01-01");
  });

  it("rejects a malformed case file with a tool error", async () => {
    const out = await call("foi_calculate_deadlines", { case_file: { received_date: "5 Nov" } });
    expect(JSON.stringify(out)).toMatch(/YYYY-MM-DD/);
  });
});

describe("guidance", () => {
  it("returns a step with quoted sources, tailored for the line area", async () => {
    const { result } = await call("foi_step_guidance", { step: "exemptions.line_area_views", role: "line_area" });
    const text = result.content[0].text;
    expect(text).toContain("For the line area");
    expect(text).toContain("s 11B");
    expect(result.structuredContent.excerpts.length).toBeGreaterThan(0);
  });

  it("has every stage ready, with full guidance for scope and search steps", async () => {
    const map = (await call("foi_process_map", {})).result.structuredContent;
    expect(map.stages.every((s: { status: string }) => s.status === "ready")).toBe(true);
    const { result } = await call("foi_step_guidance", { step: "scope.request_consultation" });
    expect(result.content[0].text).not.toContain("planned");
    expect(result.content[0].text).toContain("14 days");
    const ls = (await call("foi_step_guidance", { step: "search.searches", role: "line_area" })).result.content[0].text;
    expect(ls).toContain("messaging apps");
  });

  it("estimates charges with the free decision hours, deposit and bars", async () => {
    const r = (await call("foi_estimate_charges", { search_hours: 6, decision_hours: 12, photocopy_pages: 100 })).result.structuredContent;
    expect(r.total).toBe(90 + 140 + 10);
    expect(r.deposit_maximum).toBe(60);
    const own = (await call("foi_estimate_charges", { search_hours: 6, case_file: { received_date: "2026-11-02", own_personal_information: true, events: [] } })).result
      .structuredContent;
    expect(own.chargeable).toBe(false);
    expect(own.barred_by).toMatch(/s 7\(1\)/);
  });

  it("estimates practical refusal workload from a sample", async () => {
    const r = (
      await call("foi_estimate_workload", {
        documents_in_scope: 1800,
        sample_documents: 150,
        search_hours: 20,
        sample_examine_minutes: 540,
        sample_documents_needing_consultation: 10,
        consultation_minutes_each: 30,
        decision_and_notification_hours: 8,
      })
    ).result;
    expect(r.structuredContent.total_hours).toBe(20 + 108 + 60 + 8);
    expect(r.structuredContent.evidence_statement).toContain("1800 documents");
    expect(r.content[0].text).toContain("s 24AA(3)");
  });

  it("renders every template", async () => {
    const cf = { reference: "FOI-T", received_date: "2026-11-02", events: [] };
    for (const template of [
      "acknowledgement",
      "s24AB_notice",
      "practical_refusal_decision",
      "s29_charges_notice",
      "charges_contention_decision",
      "search_minute",
      "third_party_consultation",
      "third_party_decision_notice",
      "statement_of_reasons",
    ]) {
      const r = (await call("foi_draft_notice", { template, case_file: cf })).result.structuredContent;
      expect(r.text, template).toContain("FOI-T");
      expect(r.must_include.length, template).toBeGreaterThan(0);
    }
  });

  it("guides an exemption with the Act text", async () => {
    const { result } = await call("foi_exemption_guide", { provision: "s 47C" });
    expect(result.structuredContent.exemption.kind).toBe("conditional");
    expect(result.structuredContent.section_text).toContain("deliberative matter");
    expect(result.content[0].text).toContain("purely factual");
  });

  it("suggests exemptions for a kind of information", async () => {
    const { result } = await call("foi_exemption_guide", { information: "legal advice from AGS" });
    expect(result.structuredContent.candidates[0].provision).toBe("42");
  });

  it("flags irrelevant public interest factors (s 11B(4))", async () => {
    const { result } = await call("foi_public_interest_test", {
      provision: "47C",
      factors_for: ["inform debate on the program's cost"],
      factors_against: ["release would embarrass the Minister", "the briefs could be misunderstood without context", "disclosure would inhibit frank advice"],
    });
    const sc = result.structuredContent;
    expect(sc.irrelevant_flagged).toBe(2);
    expect(sc.checks.find((c: { frankness: boolean }) => c.frankness)).toBeTruthy();
  });

  it("drafts a statement of reasons with mandatory review rights", async () => {
    const { result } = await call("foi_draft_notice", {
      template: "statement_of_reasons",
      case_file: { reference: "FOI-9", received_date: "2026-11-02", events: [] },
      details: { decision_summary: "grant access in part" },
    });
    const sc = result.structuredContent;
    expect(sc.text).toContain("Information Commissioner review");
    expect(sc.text).toContain("grant access in part");
    expect(sc.unfilled.length).toBeGreaterThan(0);
  });
});

describe("search and fetch", () => {
  it("finds passages by keyword (fallback mode in tests)", async () => {
    const { result } = await call("search", { query: "unreasonable disclosure of personal information", limit: 5 });
    expect(result.structuredContent.mode).toBe("keyword");
    expect(result.structuredContent.results.length).toBeGreaterThan(0);
    expect(JSON.parse(result.content[0].text).results[0].url).toMatch(/^https:/);
  });

  it("puts a cited provision first", async () => {
    const { result } = await call("search", { query: "s 24AB consultation" });
    expect(result.structuredContent.results[0].id).toBe("act:s24AB");
  });

  it("fetches whole sections, paragraphs and part outlines by citation", async () => {
    const s4 = (await call("fetch", { id: "s 4" })).result.structuredContent;
    expect(s4.id).toBe("act:s4");
    expect(s4.text.length).toBeGreaterThan(10_000);
    const para = (await call("fetch", { id: "[3.247]" })).result.structuredContent;
    expect(para.text).toContain("calendar days");
    const outline = (await call("fetch", { id: "Part 6" })).result.structuredContent;
    expect(outline.text).toContain("47F");
  });

  it("says when nothing matches", async () => {
    const { result } = await call("fetch", { id: "s 999" });
    expect(result.isError).toBe(true);
  });
});

describe("http", () => {
  it("serves a landing page and health", async () => {
    const page = await worker.fetch(new Request(`${ORIGIN}/`, { headers: { accept: "text/html" } }), env);
    expect(await page.text()).toContain(`${ORIGIN}/mcp`);
    const health = await (await worker.fetch(new Request(`${ORIGIN}/healthz`), env)).json<{ ok: boolean; passages: number }>();
    expect(health.ok).toBe(true);
    expect(health.passages).toBeGreaterThan(2000);
  });

  it("answers CORS preflight", async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/mcp`, { method: "OPTIONS" }), env);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
