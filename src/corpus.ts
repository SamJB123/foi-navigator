/**
 * The corpus: FOI Act and Charges Regulations sections, and FOI Guidelines
 * paragraphs, in D1 (rows + FTS5) and Vectorize (one bge-m3 vector per passage).
 *
 * Search is hybrid: FTS5 BM25 and vector similarity ranked separately, then merged by
 * reciprocal rank fusion. If the vector side is unavailable (local dev, an AI error),
 * search falls back to FTS alone and says so. A query that names a provision
 * ("s 47F", "[6.123]") puts that passage first.
 */
import { z } from "zod";
import manifest from "../data/content/manifest.json" with { type: "json" };

export type Env = Cloudflare.Env & { ADMIN_TOKEN?: string };

export const EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const MANIFEST = manifest;

export type GuidelinePart = { title: string; version: string; updated: string; url: string; paragraphs: number };
/** The Guidelines parts by number ("1"…"15"), indexable by any string. */
export const GUIDELINE_PARTS: Record<string, GuidelinePart> = manifest.guidelines;

/** Embed texts with bge-m3; null if the model returned no vectors. */
export async function embed(ai: Ai, text: string[]): Promise<number[][] | null> {
  const out = await ai.run(EMBEDDING_MODEL, { text });
  return "data" in out && out.data?.length ? out.data : null;
}

/** A row of the passages table. D1 rows are untyped, so every query result is parsed with this. */
export const passageRow = z.object({
  id: z.string(),
  source: z.enum(["act", "regs", "guidelines"]),
  ref: z.string(),
  parent: z.string(),
  part: z.string(),
  heading: z.string(),
  title: z.string(),
  text: z.string(),
  url: z.string(),
  ord: z.number(),
});
export const passageRows = z.array(passageRow);
const snippetRows = z.array(passageRow.extend({ snip: z.string() }));
export type PassageRow = z.infer<typeof passageRow>;

export type SearchHit = {
  id: string;
  ref: string;
  source: PassageRow["source"];
  title: string;
  heading: string;
  url: string;
  snippet: string;
  score: number;
  matched_by: ("keyword" | "semantic" | "reference")[];
};

const SOURCE_LABEL: Record<PassageRow["source"], string> = {
  act: "FOI Act 1982",
  regs: "FOI (Charges) Regulations 2019",
  guidelines: "FOI Guidelines",
};
export const sourceLabel = (row: Pick<PassageRow, "source" | "part">) =>
  row.source === "guidelines" ? `${SOURCE_LABEL.guidelines} ${row.part}` : SOURCE_LABEL[row.source];

/** The text to embed for a passage: where it sits, then what it says. */
export function embeddingText(p: Pick<PassageRow, "ref" | "title" | "heading" | "text" | "source" | "part">): string {
  return `${sourceLabel(p)} ${p.ref} — ${p.title}\n${p.heading}\n\n${p.text}`.slice(0, 8000);
}

/**
 * Turn the ways people cite FOI material into passage ids:
 * "s 47F", "section 47F(1)", "47F" → act:s47F; "[6.123]", "6.123", "para 6.123" → gl:6.123;
 * "Charges Regs s 7", "reg 7" → regs:s7; "Sch 3" → act:sch3; "Part 6" → gl:part6.
 * Returns null when the input does not look like a citation.
 */
export function normaliseRef(input: string): string | null {
  const s = input.trim();
  if (/^(act|regs|gl):/.test(s)) return s;
  let m = /^(?:charges\s+regs?|regs?|regulations?)\.?\s*(?:s|section|reg)?\.?\s*(\d+[A-Z]*)/i.exec(s);
  if (m) return `regs:s${m[1].toUpperCase()}`;
  m = /^(?:para(?:graph)?\s*)?\[?\s*(\d{1,2}\.\d{1,3}[A-Z]?)\s*\]?$/i.exec(s);
  if (m) return `gl:${m[1]}`;
  m = /^(?:guidelines\s+)?part\s+(\d{1,2})$/i.exec(s);
  if (m) return `gl:part${m[1]}`;
  m = /^(?:sch(?:edule)?\.?)\s*(\d)$/i.exec(s);
  if (m) return `act:sch${m[1]}`;
  m = /^(?:s(?:ection)?\.?\s*)?(\d{1,3}[A-Z]{0,2})(?:\(.*)?$/i.exec(s);
  if (m) return `act:s${m[1].toUpperCase()}`;
  return null;
}

/** Citations embedded in free text, as passage ids. */
export function refsIn(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(/\[(\d{1,2}\.\d{1,3}[A-Z]?)\]/g)) ids.add(`gl:${m[1]}`);
  for (const m of text.matchAll(/\bs\s?(\d{1,3}[A-Z]{0,2})\b/g)) ids.add(`act:s${m[1]}`);
  return [...ids];
}

const ftsQuery = (words: string[], op: "AND" | "OR") => words.map((w) => `"${w.replace(/"/g, "")}"`).join(` ${op} `);

export class Corpus {
  private env: Env;
  constructor(env: Env) {
    this.env = env;
  }

  async get(id: string): Promise<PassageRow | null> {
    return passageRow.nullable().parse(await this.env.DB.prepare("SELECT * FROM passages WHERE id = ?").bind(id).first());
  }

  async many(ids: string[]): Promise<PassageRow[]> {
    if (!ids.length) return [];
    const { results } = await this.env.DB.prepare(
      `SELECT * FROM passages WHERE id IN (${ids.map(() => "?").join(",")})`,
    )
      .bind(...ids)
      .all();
    const byId = new Map(passageRows.parse(results).map((r) => [r.id, r]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  async children(parent: string): Promise<PassageRow[]> {
    const { results } = await this.env.DB.prepare("SELECT * FROM passages WHERE parent = ? ORDER BY ord").bind(parent).all();
    return passageRows.parse(results);
  }

  /** Guidelines paragraphs from one to another, inclusive, in order. */
  async range(fromId: string, toId: string, limit = 80): Promise<PassageRow[]> {
    const { results } = await this.env.DB.prepare(
      `SELECT * FROM passages WHERE ord BETWEEN (SELECT ord FROM passages WHERE id = ?) AND (SELECT ord FROM passages WHERE id = ?) ORDER BY ord LIMIT ?`,
    )
      .bind(fromId, toId, limit)
      .all();
    return passageRows.parse(results);
  }

  /**
   * A citable unit: a whole Act section (its chunks joined), one Guidelines paragraph,
   * or a Guidelines Part's outline.
   */
  async unit(idOrRef: string): Promise<
    | { kind: "passage"; id: string; ref: string; title: string; heading: string; source: PassageRow["source"]; part: string; url: string; text: string }
    | { kind: "outline"; id: string; title: string; part: string; url: string; sections: { heading: string; from: string; to: string; paragraphs: number }[] }
    | null
  > {
    const id = normaliseRef(idOrRef) ?? idOrRef;
    const partMatch = /^gl:part(\d+)$/.exec(id);
    if (partMatch) {
      const rows = await this.children(id);
      if (!rows.length) return null;
      const sections: { heading: string; from: string; to: string; paragraphs: number }[] = [];
      for (const r of rows) {
        const h = r.heading.split(" > ").slice(0, 2).join(" > ") || r.title;
        const last = sections.at(-1);
        if (last && last.heading === h) {
          last.to = r.ref;
          last.paragraphs++;
        } else sections.push({ heading: h, from: r.ref, to: r.ref, paragraphs: 1 });
      }
      const meta = GUIDELINE_PARTS[partMatch[1]];
      return { kind: "outline", id, title: meta?.title ?? `Part ${partMatch[1]}`, part: `Part ${partMatch[1]}`, url: meta?.url ?? rows[0].url, sections };
    }
    const direct = await this.get(id);
    if (direct && direct.parent === direct.id) return { kind: "passage", ...direct };
    if (direct && direct.source === "guidelines") return { kind: "passage", ...direct };
    // A chunk id (act:s4~2) or a parent id (act:s4): return the whole section.
    const parent = direct?.parent ?? id;
    const rows = await this.children(parent);
    if (!rows.length) return null;
    const first = rows[0];
    return {
      kind: "passage",
      id: parent,
      ref: first.ref,
      title: first.title,
      heading: first.heading,
      source: first.source,
      part: first.part,
      url: first.url,
      text: rows.map((r) => r.text).join("\n"),
    };
  }

  async search(
    query: string,
    opts: { source?: PassageRow["source"]; part?: string; limit?: number } = {},
  ): Promise<{ hits: SearchHit[]; mode: "hybrid" | "keyword" }> {
    const limit = Math.min(Math.max(opts.limit ?? 8, 1), 25);
    const pool = Math.max(limit * 3, 24);
    const filters: string[] = [];
    const binds: (string | number)[] = [];
    if (opts.source) {
      filters.push("p.source = ?");
      binds.push(opts.source);
    }
    if (opts.part) {
      filters.push("p.part = ?");
      binds.push(opts.part);
    }
    const where = filters.length ? `AND ${filters.join(" AND ")}` : "";

    const keyword = async (): Promise<(PassageRow & { snip: string })[]> => {
      const words = query.toLowerCase().match(/[a-z0-9]+(?:\.[0-9]+)?/g)?.filter((w) => w.length > 1) ?? [];
      if (!words.length) return [];
      const run = async (match: string) =>
        snippetRows.parse(
          (
            await this.env.DB.prepare(
              `SELECT p.*, snippet(passages_fts, 3, '**', '**', ' … ', 24) AS snip
               FROM passages_fts JOIN passages p ON p.rowid = passages_fts.rowid
               WHERE passages_fts MATCH ? ${where}
               ORDER BY bm25(passages_fts, 6.0, 3.0, 2.0, 1.0) LIMIT ?`,
            )
              .bind(match, ...binds, pool)
              .all()
          ).results,
        );
      const all = await run(ftsQuery(words, "AND"));
      if (all.length >= limit) return all;
      const any = await run(ftsQuery(words, "OR"));
      const seen = new Set(all.map((r) => r.id));
      return [...all, ...any.filter((r) => !seen.has(r.id))];
    };

    const semantic = async (): Promise<string[] | null> => {
      try {
        const vector = (await embed(this.env.AI, [query]))?.[0];
        if (!vector) return null;
        const filter: VectorizeVectorMetadataFilter = {};
        if (opts.source) filter.source = opts.source;
        const res = await this.env.VECTORS.query(vector, { topK: Math.min(pool, 50), filter: opts.source ? filter : undefined });
        let ids = res.matches.map((m) => m.id);
        if (opts.part) {
          const rows = await this.many(ids);
          const keep = new Set(rows.filter((r) => r.part === opts.part).map((r) => r.id));
          ids = ids.filter((id) => keep.has(id));
        }
        return ids;
      } catch {
        return null;
      }
    };

    const [kw, sem] = await Promise.all([keyword(), semantic()]);

    // Reciprocal rank fusion (k = 60).
    const scores = new Map<string, { score: number; by: Set<SearchHit["matched_by"][number]> }>();
    const add = (id: string, rank: number, by: SearchHit["matched_by"][number], weight = 1) => {
      const entry = scores.get(id) ?? { score: 0, by: new Set() };
      entry.score += weight / (60 + rank);
      entry.by.add(by);
      scores.set(id, entry);
    };
    kw.forEach((r, i) => add(r.id, i, "keyword"));
    sem?.forEach((id, i) => add(id, i, "semantic"));

    // A cited provision or paragraph goes first.
    const cited = [normaliseRef(query), ...refsIn(query)].filter((x): x is string => !!x);
    const citedRows = cited.length ? await this.many([...new Set(cited)]) : [];
    for (const r of citedRows) add(r.id, 0, "reference", 10);
    for (const c of cited.filter((c) => !citedRows.some((r) => r.id === c))) {
      const kids = await this.children(c);
      if (kids[0]) add(kids[0].id, 0, "reference", 10);
    }

    const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, limit);
    const kwById = new Map(kw.map((r) => [r.id, r]));
    const missing = ranked.map(([id]) => id).filter((id) => !kwById.has(id));
    const fetched = new Map((await this.many(missing)).map((r) => [r.id, r]));
    const hits: SearchHit[] = [];
    for (const [id, { score, by }] of ranked) {
      const row = kwById.get(id) ?? fetched.get(id);
      if (!row) continue;
      if (opts.source && row.source !== opts.source) continue;
      const snippet = (kwById.get(id)?.snip ?? row.text.slice(0, 280)).replace(/\s+/g, " ").trim();
      hits.push({
        id: row.id,
        ref: row.ref,
        source: row.source,
        title: row.title,
        heading: row.heading,
        url: row.url,
        snippet,
        score: Math.round(score * 10000) / 10000,
        matched_by: [...by],
      });
    }
    return { hits, mode: sem ? "hybrid" : "keyword" };
  }
}
