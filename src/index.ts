/**
 * FOI Navigator — one Worker:
 *
 *   POST /mcp              MCP (2026-07-28 stateless; 2025-era clients via the legacy lane)
 *   GET  /                 landing page: what this is and how to connect it
 *   GET  /healthz          corpus versions
 *   POST /admin/reindex    embed passages into Vectorize (bearer ADMIN_TOKEN; run after a content load)
 */
import { EMBEDDING_MODEL, type Env, MANIFEST, embeddingText, type PassageRow } from "./corpus.ts";
import { landingPage } from "./landing.ts";
import { mcpHandler } from "./mcp/server.ts";

const json = (body: unknown, status = 200, cache = 0) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache ? `public, max-age=${cache}` : "no-store" },
  });

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, mcp-method, mcp-name, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
};

function withCors(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}

async function reindex(request: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_TOKEN || request.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "unauthorised" }, 401);
  const url = new URL(request.url);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);
  const { results } = await env.DB.prepare("SELECT * FROM passages ORDER BY ord LIMIT ? OFFSET ?").bind(limit, offset).all<PassageRow>();
  if (!results.length) return json({ done: true, offset });
  const out = (await env.AI.run(EMBEDDING_MODEL as keyof AiModels, { text: results.map(embeddingText) } as never)) as unknown as { data: number[][] };
  await env.VECTORS.upsert(
    results.map((r, i) => ({ id: r.id, values: out.data[i], metadata: { source: r.source, part: r.part } })),
  );
  const { total } = (await env.DB.prepare("SELECT count(*) AS total FROM passages").first<{ total: number }>())!;
  return json({ done: offset + results.length >= total, offset, indexed: results.length, next: offset + results.length, total });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      const ip = request.headers.get("cf-connecting-ip") ?? "local";
      const { success } = await env.MCP_LIMIT.limit({ key: ip });
      if (!success) return withCors(json({ error: "Too many requests — slow down and retry shortly." }, 429));
      const response = await mcpHandler(env).fetch(request);
      return withCors(response);
    }

    if (url.pathname === "/healthz") {
      const row = await env.DB.prepare("SELECT count(*) AS n FROM passages").first<{ n: number }>().catch(() => null);
      return json({ ok: !!row?.n, passages: row?.n ?? 0, builtAt: MANIFEST.builtAt, act: MANIFEST.legislation.act.registerId });
    }

    if (url.pathname === "/admin/reindex" && request.method === "POST") return reindex(request, env);

    if (url.pathname === "/" && request.method === "GET") {
      if ((request.headers.get("accept") ?? "").includes("text/html")) {
        return new Response(landingPage(url.origin), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" } });
      }
      return json({ service: "foi-navigator", mcp: `${url.origin}/mcp`, sources: MANIFEST.legislation, guidelines_built: MANIFEST.builtAt }, 200, 3600);
    }

    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
