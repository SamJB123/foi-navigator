/**
 * Turn the downloaded sources into the server's corpus:
 *
 *   data/content/manifest.json   versions, as-at dates, licences (bundled into the Worker)
 *   data/content/passages.json   every searchable passage (Act/Regs sections, Guideline paragraphs)
 *   data/d1/content.sql          the same passages as D1 rows + an FTS5 index
 *
 *   node scripts/build-content.ts
 *
 * Legislation is split by section (long sections into chunks of subsections); the
 * Guidelines by numbered paragraph, carrying the heading trail and any footnotes the
 * paragraph cites, so every passage is citable on its own: "s 47F(2)", "[6.123]".
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HTMLElement, parse } from "node-html-parser";
import { must } from "../src/guards.ts";
import { GUIDELINE_PARTS, LEGISLATION } from "./fetch-sources.ts";

const ROOT = join(import.meta.dirname, "..");
const SOURCES = join(ROOT, "sources");
const GUIDELINES_BASE =
  "https://www.oaic.gov.au/freedom-of-information/freedom-of-information-guidance-for-government-agencies/foi-guidelines/";

/** Longest passage stored as one search unit; longer sections split at subsections. */
const MAX_CHUNK = 3500;

export type Passage = {
  id: string; // act:s47F, act:s4~2, regs:s7, gl:6.123
  source: "act" | "regs" | "guidelines";
  ref: string; // "s 47F", "reg 7", "[6.123]"
  parent: string; // the citable unit a chunk belongs to (act:s4 for act:s4~2)
  part: string; // "Part IV", "Part 6"
  heading: string; // trail: "Part IV—Exempt documents > Division 3—..." or Guideline headings
  title: string; // section title / nearest Guideline heading
  text: string;
  url: string;
  ord: number;
};

const clean = (s: string) =>
  s
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .trim();

const textOf = (el: HTMLElement) => clean(el.text.replace(/\s+/g, " "));

// ---------------------------------------------------------------------------
// Legislation (EPUB XHTML from the Federal Register of Legislation)
// ---------------------------------------------------------------------------

const INDENT: Record<string, string> = {
  subsection: "",
  subsection2: "",
  paragraph: "  ",
  paragraphsub: "    ",
  "paragraphsub-sub": "      ",
  Definition: "",
  notetext: "  ",
  notepara: "    ",
  Penalty: "  ",
  SubsectionHead: "",
};

/** An element's child elements (skipping text and comment nodes). */
const elementsIn = (n: HTMLElement): HTMLElement[] => n.childNodes.filter((c): c is HTMLElement => c instanceof HTMLElement);

function flatten(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  (function walk(n: HTMLElement) {
    for (const c of elementsIn(n)) {
      if (c.tagName === "P" || c.tagName === "TABLE") out.push(c);
      else walk(c);
    }
  })(root);
  return out;
}

function tableText(table: HTMLElement): string {
  return table
    .querySelectorAll("tr")
    .map((tr) => tr.querySelectorAll("td,th").map((td) => textOf(td)).join(" | "))
    .filter((row) => row.replace(/[| ]/g, ""))
    .join("\n");
}

function chunkLines(lines: string[]): string[] {
  if (lines.join("\n").length <= MAX_CHUNK) return [lines.join("\n")];
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const line of lines) {
    // Prefer a subsection, subheading or definition boundary, so a chunk rarely starts
    // mid-list; a run with no boundary (a schedule's list of Acts) splits where it must.
    const boundary = /^\(\d+[A-Z]*\) |^#### |^\S.* means:?|^\S.* has the (same )?meaning/.test(line);
    if ((boundary && size > MAX_CHUNK * 0.6) || size > MAX_CHUNK) {
      chunks.push(current.join("\n"));
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length;
  }
  if (current.length) chunks.push(current.join("\n"));
  return chunks;
}

async function buildLegislation(key: "act" | "regs") {
  const version = JSON.parse(await readFile(join(SOURCES, key, "version.json"), "utf8"));
  const dir = join(SOURCES, key, "epub", "OEBPS");
  const docDir = must((await readdir(dir)).find((d) => d.startsWith("document_")), `document_* folder in ${dir}`);
  const file = must((await readdir(join(dir, docDir))).find((f) => f.endsWith(".html")), `HTML file in ${docDir}`);
  const root = parse(await readFile(join(dir, docDir, file), "utf8"));
  const nodes = flatten(must(root.querySelector("body"), `<body> in ${file}`));

  type Unit = { ref: string; num: string; title: string; trail: string[]; part: string; lines: string[] };
  const units: Unit[] = [];
  const trail: string[] = ["", "", "", ""]; // ActHead1..4
  let current: Unit | null = null;
  let inBody = false;
  // Act sections cite bare ("s 47F"); the Regulations' carry their name ("Charges Regs s 7").
  const prefix = key === "act" ? "" : "Charges Regs ";

  for (const node of nodes) {
    const cls = node.getAttribute("class") ?? "";
    // Endnotes are amendment history, and ActHead6+ marks amending schedules: not law to cite.
    if (/^ENotesHeading1/.test(cls) || /^ActHead[6-9]$/.test(cls)) break;
    if (/^TOC/.test(cls)) continue;
    const head = /^ActHead(\d)$/.exec(cls);
    if (head) {
      inBody = true;
      const level = Number(head[1]);
      const text = textOf(node).replace(/‑/g, "-");
      if (level === 5 && current?.num.startsWith("sch")) {
        current.lines.push(`#### ${text}`); // a clause inside a schedule
        continue;
      }
      if (level <= 4) {
        trail[level - 1] = text;
        for (let i = level; i < 4; i++) trail[i] = "";
        if (level === 1 && /^Schedule/.test(text)) {
          // A schedule is one unit; its internal Parts/Divisions become subheadings.
          const num = /^Schedule (\d+)/.exec(text)?.[1] ?? text;
          current = { ref: `${prefix}Sch ${num}`, num: `sch${num}`, title: text, trail: [], part: text, lines: [] };
          units.push(current);
        } else if (current?.num.startsWith("sch")) {
          current.lines.push(`#### ${text}`);
        }
        continue;
      }
      // ActHead5: a section. "47F Public interest conditional exemptions—personal privacy"
      const m = /^(\d+[A-Z]*)\s+(.*)$/.exec(text);
      if (!m) continue;
      current = {
        ref: `${prefix}s ${m[1]}`,
        num: m[1],
        title: m[2],
        trail: trail.filter(Boolean),
        part: trail[1] || trail[0],
        lines: [],
      };
      units.push(current);
      continue;
    }
    if (!inBody || !current) continue;
    if (node.tagName === "TABLE") {
      const t = tableText(node);
      if (t) current.lines.push(t);
      continue;
    }
    // Skip paragraphs that live inside tables (already captured) and empty spacers.
    if (node.closest("table")) continue;
    const text = textOf(node);
    if (!text) continue;
    if (cls === "SubsectionHead") current.lines.push(`#### ${text}`);
    else current.lines.push((INDENT[cls] ?? "") + text);
  }

  const passages: Passage[] = [];
  const url = (_num: string) => `https://www.legislation.gov.au/${version.titleId}/latest/text`;
  let ord = 0;
  for (const u of units) {
    const parent = `${key}:${u.num.startsWith("sch") ? u.num : "s" + u.num}`;
    const chunks = chunkLines(u.lines);
    chunks.forEach((text, i) => {
      passages.push({
        id: chunks.length > 1 ? `${parent}~${i + 1}` : parent,
        source: key,
        ref: u.ref,
        parent,
        part: u.part.replace(/—.*/, ""),
        heading: u.trail.join(" > "),
        title: u.title,
        text,
        url: url(u.num),
        ord: ord++,
      });
    });
  }
  return { version, passages, sections: units.length };
}

// ---------------------------------------------------------------------------
// OAIC FOI Guidelines (HTML pages with numbered paragraphs)
// ---------------------------------------------------------------------------

const isFootnote = (block: HTMLElement) =>
  !block.classList.contains("gov-is-numbered-paragraph") && /^\[\d+\]/.test(textOf(block));

function listText(list: HTMLElement, depth = 0): string {
  const items = elementsIn(list).filter((n) => n.tagName === "LI");
  return items
    .map((li, i) => {
      const nested = elementsIn(li).filter((n) => n.tagName === "UL" || n.tagName === "OL");
      const own = must(parse(li.outerHTML).querySelector("li"), "list item");
      for (const n of own.querySelectorAll("ul,ol")) n.remove();
      const bullet = `${"  ".repeat(depth)}${list.tagName === "OL" ? `${i + 1}.` : "-"} ${textOf(own)}`;
      return [bullet, ...nested.map((n) => listText(n, depth + 1))].join("\n");
    })
    .join("\n");
}

function blockText(el: HTMLElement): string {
  if (el.tagName === "UL" || el.tagName === "OL") return listText(el);
  if (el.tagName === "TABLE") return tableText(el);
  return textOf(el);
}

async function buildGuidelines() {
  const passages: Passage[] = [];
  const parts: Record<string, { title: string; version: string; updated: string; url: string; paragraphs: number }> = {};
  let ord = 0;
  for (const [part, slug] of Object.entries(GUIDELINE_PARTS)) {
    const root = parse(await readFile(join(SOURCES, "guidelines", `part-${part}.html`), "utf8"));
    const title = textOf(must(root.querySelector("h1"), `<h1> in Guidelines Part ${part}`));
    const pageText = root.text.replace(/\s+/g, " ");
    // Pages state their version as a download label ("Part 4 - Charges - v 1.9") or a
    // line ("Version 1.6, May 2024"), and their date as "Updated:" or "Published date:".
    const version =
      new RegExp(`Part ${part}\\b[^()]{0,120}?[-–] v ?(\\d+\\.\\d+)`).exec(pageText)?.[1] ??
      /Version (\d+\.\d+)/.exec(pageText)?.[1] ??
      "unknown";
    const updated =
      /Updated: ([0-9A-Za-z ]+?\d{4})/.exec(pageText)?.[1] ??
      /Published date: ([0-9A-Za-z ]+?\d{4})/.exec(pageText)?.[1] ??
      /Version \d+\.\d+,? ([A-Za-z]+ \d{4})/.exec(pageText)?.[1] ??
      "unknown";
    const url = GUIDELINES_BASE + slug;
    // Long parts are split across several numbered-paragraph components on the page.
    const containers = root.querySelectorAll(".gov-numbered-paragraphs");
    if (!containers.length) throw new Error(`Part ${part}: no numbered paragraphs found`);

    // Footnotes first, so each paragraph can carry the ones it cites.
    // A footnote is a block that opens with its own "[n]" link: a div#ftnN on most
    // pages, a bare <p> on some (Part 5, whose in-text and back links are also swapped).
    const footnotes = new Map<string, string>();
    for (const a of root.querySelectorAll('a[href^="#_ftn"]')) {
      const n = /#_ftn(?:ref)?(\d+)/.exec(a.getAttribute("href") ?? "")?.[1];
      const block = a.closest('div[id^="ftn"]') ?? a.closest("p");
      if (n && block && isFootnote(block)) footnotes.set(n, textOf(block).replace(/^\[\d+\]\s*/, ""));
    }

    const headings: string[] = [];
    type Para = { num: string; blocks: string[]; notes: Set<string>; heading: string; title: string };
    const paras: Para[] = [];
    // The paragraph that following lists and tables belong to (a holder, so closures narrow it).
    const open: { para: Para | null } = { para: null };

    const noteRefs = (el: HTMLElement, into: Set<string>) => {
      for (const a of el.querySelectorAll('a[href^="#_ftn"]')) {
        const n = /#_ftn(?:ref)?(\d+)/.exec(a.getAttribute("href") ?? "")?.[1];
        if (n) into.add(n);
      }
    };

    const walk = (n: HTMLElement) => {
      for (const c of elementsIn(n)) {
        if (c.tagName === "DIV" && /^ftn\d+/.test(c.id)) continue;
        if (c.tagName === "P" && isFootnote(c)) continue;
        const h =/^H([1-6])$/.exec(c.tagName);
        if (h) {
          const level = Number(h[1]);
          headings.length = Math.max(0, level - 2);
          headings[level - 2] = textOf(c);
          open.para = null; // a heading closes the paragraph
          continue;
        }
        if (c.tagName === "P" && c.classList.contains("gov-is-numbered-paragraph")) {
          // The number is usually the first <span>; a few paragraphs carry it as bare text.
          const clone = must(parse(c.outerHTML).querySelector("p"), "numbered paragraph");
          const span = clone.querySelector("span");
          let num = span ? textOf(span) : "";
          if (span && /^\d+\.\d+[A-Z]?$/.test(num)) span.remove();
          else {
            num = /^(\d+\.\d+[A-Z]?)\b/.exec(textOf(c))?.[1] ?? "";
            if (num) clone.set_content(clone.innerHTML.replace(num, ""));
          }
          if (!num) {
            // Styled as numbered but carrying no number: a bold-only line is a minor
            // heading ("Prejudice") for the paragraphs after it — and, as in Part 6's
            // factor lists, may also title a list that belongs to the open paragraph.
            const bold = c.querySelectorAll("b,strong").map(textOf).join(" ");
            if (bold && bold === textOf(c)) {
              headings.length = 5;
              headings[5] = bold;
              open.para?.blocks.push(`**${bold}**`);
            } else if (open.para) {
              noteRefs(c, open.para.notes);
              open.para.blocks.push(textOf(c));
            }
            continue;
          }
          const para: Para = {
            num,
            blocks: [],
            notes: new Set(),
            heading: headings.filter(Boolean).join(" > "),
            title: headings.filter(Boolean).at(-1) ?? title,
          };
          noteRefs(c, para.notes);
          for (const sup of clone.querySelectorAll("sup")) sup.replaceWith(`[^${textOf(sup).replace(/\D/g, "")}]`);
          para.blocks.push(textOf(clone));
          paras.push(para);
          open.para = para;
          continue;
        }
        if (["P", "UL", "OL", "TABLE", "BLOCKQUOTE"].includes(c.tagName)) {
          // Some lists wrap the next numbered paragraph inside an item: walk into those.
          if (c.querySelector("p.gov-is-numbered-paragraph")) {
            walk(c);
            continue;
          }
          if (open.para) {
            noteRefs(c, open.para.notes);
            const t = blockText(c);
            if (t) open.para.blocks.push(t);
          }
          continue;
        }
        walk(c);
      }
    };
    for (const container of containers) walk(container);

    for (const p of paras) {
      const notes = [...p.notes]
        .filter((n) => footnotes.has(n))
        .map((n) => `[^${n}]: ${footnotes.get(n)}`);
      passages.push({
        id: `gl:${p.num}`,
        source: "guidelines",
        ref: `[${p.num}]`,
        parent: `gl:part${part}`,
        part: `Part ${part}`,
        heading: p.heading,
        title: p.title,
        text: [...p.blocks, ...(notes.length ? ["", ...notes] : [])].join("\n"),
        url: `${url}#:~:text=${encodeURIComponent(p.num)}`,
        ord: ord++,
      });
    }
    parts[part] = { title, version, updated, url, paragraphs: paras.length };
    console.log(`Guidelines Part ${part} v${version} (${updated}): ${paras.length} paragraphs`);
  }
  return { parts, passages };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const sql = (v: string | number) => (typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`);

function toSql(passages: Passage[]): string {
  const lines = [
    "DROP TABLE IF EXISTS passages_fts;",
    "DROP TABLE IF EXISTS passages;",
    `CREATE TABLE passages (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, ref TEXT NOT NULL, parent TEXT NOT NULL,
  part TEXT NOT NULL, heading TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL,
  url TEXT NOT NULL, ord INTEGER NOT NULL);`,
    "CREATE INDEX passages_parent ON passages(parent, ord);",
    // External-content FTS5 over the same rows; porter stemming so 'consulting' finds 'consultation'.
    "CREATE VIRTUAL TABLE passages_fts USING fts5(ref, title, heading, text, content='passages', content_rowid='rowid', tokenize='porter unicode61');",
  ];
  for (const p of passages) {
    lines.push(
      `INSERT INTO passages (id, source, ref, parent, part, heading, title, text, url, ord) VALUES (${[
        p.id, p.source, p.ref, p.parent, p.part, p.heading, p.title, p.text, p.url, p.ord,
      ].map(sql).join(", ")});`,
    );
  }
  lines.push("INSERT INTO passages_fts(passages_fts) VALUES ('rebuild');");
  return lines.join("\n") + "\n";
}

if (import.meta.main) {
  const act = await buildLegislation("act");
  const regs = await buildLegislation("regs");
  const guidelines = await buildGuidelines();
  console.log(`FOI Act ${act.version.registerId}: ${act.sections} sections → ${act.passages.length} passages`);
  console.log(`Charges Regulations ${regs.version.registerId}: ${regs.sections} sections → ${regs.passages.length} passages`);

  // One numbering across sources keeps ord meaningful for "next/previous" reading.
  const passages = [...act.passages, ...regs.passages, ...guidelines.passages].map((p, i) => ({ ...p, ord: i }));
  const ids = new Set<string>();
  for (const p of passages) {
    if (ids.has(p.id)) throw new Error(`duplicate passage id ${p.id}`);
    ids.add(p.id);
  }

  const builtAt = new Date().toISOString().slice(0, 10);
  const manifest = {
    builtAt,
    legislation: Object.fromEntries(
      [act, regs].map(({ version }) => [
        must(LEGISLATION.find((l) => l.titleId === version.titleId), `legislation entry for ${version.titleId}`).key,
        {
          name: version.name,
          titleId: version.titleId,
          registerId: version.registerId,
          compilation: version.compilationNumber,
          inForceFrom: version.start.slice(0, 10),
          url: version.url,
        },
      ]),
    ),
    guidelines: guidelines.parts,
    passages: passages.length,
    licence: {
      legislation:
        `Based on content from the Federal Register of Legislation at ${builtAt}. For the latest information on Australian Government legislation please go to https://www.legislation.gov.au. Licensed CC BY 4.0.`,
      guidelines:
        "Includes material from the Office of the Australian Information Commissioner website (www.oaic.gov.au), © Commonwealth of Australia, licensed CC BY 4.0. Reformatted into passages; not endorsed by the OAIC.",
    },
  };

  await mkdir(join(ROOT, "data", "content"), { recursive: true });
  await mkdir(join(ROOT, "data", "d1"), { recursive: true });
  await writeFile(join(ROOT, "data", "content", "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(join(ROOT, "data", "content", "passages.json"), JSON.stringify(passages));
  await writeFile(join(ROOT, "data", "d1", "content.sql"), toSql(passages));
  console.log(`${passages.length} passages written.`);
}
