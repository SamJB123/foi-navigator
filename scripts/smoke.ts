/**
 * Smoke test a deployed server over HTTP, as real clients call it: a 2025-era
 * (legacy stateless) client and a 2026-07-28 client, through every tool, plus a few
 * search queries to eyeball hybrid ranking.
 *
 *   node scripts/smoke.ts [https://foi-navigator.aicolab.workers.dev/mcp]
 */
import { z } from "zod";

const URL_ = process.argv[2] ?? "https://foi-navigator.aicolab.workers.dev/mcp";
let id = 1;
let failures = 0;

async function rpc(method: string, params: Record<string, unknown> = {}, era: "legacy" | "modern" = "legacy") {
  const name = typeof params.name === "string" ? params.name : typeof params.uri === "string" ? params.uri : undefined;
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  let body: Record<string, unknown> = { jsonrpc: "2.0", id: id++, method, params };
  if (era === "legacy") headers["mcp-protocol-version"] = "2025-06-18";
  else {
    Object.assign(headers, { "mcp-protocol-version": "2026-07-28", "mcp-method": method, ...(name ? { "mcp-name": name } : {}) });
    body = {
      ...body,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "foi-smoke", version: "0" },
        },
      },
    };
  }
  const res = await fetch(URL_, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  const json = JSON.parse(/^(event|data):/m.test(text.slice(0, 20)) ? (text.split("\n").filter((l) => l.startsWith("data:")).pop() ?? "data:{}").slice(5) : text);
  if (json.error) throw new Error(`${method} ${name ?? ""}: ${JSON.stringify(json.error)}`);
  return json.result;
}

function check(ok: unknown, label: string) {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}`);
  if (!ok) failures++;
}

for (const era of ["legacy", "modern"] as const) {
  console.log(`\n== ${era}`);
  const tools = z.array(z.object({ name: z.string() })).parse((await rpc("tools/list", {}, era)).tools);
  check(tools.length === 11, `tools/list: ${tools.map((t) => t.name).join(", ")}`);
  const ch = await rpc("tools/call", { name: "foi_estimate_charges", arguments: { search_hours: 6, decision_hours: 12 } }, era);
  check(ch.structuredContent?.total === 230 && ch.structuredContent?.deposit_maximum === 57.5, "foi_estimate_charges → $230, deposit $57.50");
  const wl = await rpc(
    "tools/call",
    { name: "foi_estimate_workload", arguments: { documents_in_scope: 1800, sample_documents: 150, search_hours: 20, sample_examine_minutes: 540 } },
    era,
  );
  check(wl.structuredContent?.total_hours === 128, "foi_estimate_workload → 128 h");
  const pr = await rpc("tools/call", { name: "foi_step_guidance", arguments: { step: "scope.practical_refusal" } }, era);
  check(pr.content[0].text.includes("[3.208]") && !pr.content[0].text.includes("planned"), "stage 2 guidance is full");
  const start = await rpc(
    "tools/call",
    {
      name: "foi_start_request",
      arguments: { reference: "SMOKE-1", received_date: "2026-11-05", in_writing: true, states_foi_act: true, identifies_documents: "yes", has_contact_address: true, as_of: "2026-11-06" },
    },
    era,
  );
  check(start.structuredContent?.timeline?.processing?.effective_due === "2026-12-07", "foi_start_request → due 7 Dec 2026");
  const cf = start.structuredContent.case_file;
  cf.events.push({ type: "extension_s15AA", date: "2026-11-20", days: 14 });
  const dl = await rpc("tools/call", { name: "foi_calculate_deadlines", arguments: { case_file: cf, as_of: "2026-11-21" } }, era);
  check(dl.structuredContent?.timeline?.processing?.effective_due === "2026-12-21", "s 15AA +14 → 21 Dec 2026");
  const step = await rpc("tools/call", { name: "foi_step_guidance", arguments: { step: "decision.statement_of_reasons", case_file: cf } }, era);
  check(step.content[0].text.includes("s 26"), "foi_step_guidance");
  const ex = await rpc("tools/call", { name: "foi_exemption_guide", arguments: { provision: "47E" } }, era);
  check(ex.structuredContent?.exemption?.provision === "47E", "foi_exemption_guide");
  const pi = await rpc("tools/call", { name: "foi_public_interest_test", arguments: { provision: "47F", factors_against: ["media interest would be embarrassing"] } }, era);
  check(pi.structuredContent?.irrelevant_factors?.length === 4 && pi.structuredContent?.factors?.length === 1, "foi_public_interest_test sets factors beside s 11B(4)");
  const draft = await rpc("tools/call", { name: "foi_draft_notice", arguments: { template: "acknowledgement", case_file: cf } }, era);
  check(draft.structuredContent?.text?.includes("21 Dec 2026"), "foi_draft_notice uses the case file's due date");
  const f = await rpc("tools/call", { name: "fetch", arguments: { id: "s 15AA" } }, era);
  check(f.structuredContent?.text?.includes("30 days"), "fetch s 15AA");
  const ui = await rpc("resources/read", { uri: "ui://foi-navigator/timeline.html" }, era);
  check(ui.contents?.[0]?.mimeType === "text/html;profile=mcp-app", "MCP App resource");
}

console.log("\n== search (hybrid)");
for (const query of [
  "can we redact the names of junior public servants",
  "applicant has not paid the deposit, is the clock still running",
  "what if the documents cannot be found",
  "frank and fearless advice chilling effect",
  "how long does a third party have to seek review before we release",
]) {
  const r = (await rpc("tools/call", { name: "search", arguments: { query, limit: 5 } })).structuredContent;
  console.log(`[${r.mode}] ${query}`);
  for (const h of r.results) console.log(`   ${h.id.padEnd(12)} ${h.matched_by.join("+").padEnd(17)} ${h.title.slice(0, 80)}`);
  check(r.mode === "hybrid", "hybrid mode");
}

console.log(failures ? `\n${failures} failure(s)` : "\nall ok");
process.exit(failures ? 1 : 0);
