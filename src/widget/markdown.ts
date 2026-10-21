/**
 * The small markdown subset the tools write (headings, paragraphs, lists, checklists,
 * tables, quotes, rules, code fences, bold, italic, code and [[slots]]), parsed once
 * into blocks, then rendered to HTML for the FOI view, to plain text for copy and
 * .txt, and to Word paragraphs by docx.ts.
 */

export type Inline = { text: string; bold?: boolean; italic?: boolean; code?: boolean; slot?: boolean };
export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "para"; lines: string[] }
  | { type: "list"; ordered: boolean; items: { text: string; check?: boolean | null }[] }
  | { type: "table"; head: string[] | null; rows: string[][] }
  | { type: "quote"; lines: string[] }
  | { type: "rule" }
  | { type: "code"; text: string };

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
const LIST = /^\s*([-*]|\d+\.)\s+/;
const BREAK = /^(#{1,4}\s|```|>|\||-{3,}\s*$|\s*([-*]|\d+\.)\s+)/;

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) body.push(lines[i]);
      i++;
      out.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      out.push({ type: "heading", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    if (/^-{3,}\s*$/.test(line)) {
      out.push({ type: "rule" });
      i++;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[] = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) rows.push(lines[i]);
      const hasHead = rows.length > 1 && /^\|?\s*:?-{2,}/.test(rows[1].trim());
      out.push({ type: "table", head: hasHead ? cells(rows[0]) : null, rows: (hasHead ? rows.slice(2) : rows).map(cells) });
      continue;
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      for (; i < lines.length && lines[i].startsWith(">"); i++) body.push(lines[i].replace(/^>\s?/, ""));
      out.push({ type: "quote", lines: body });
      continue;
    }
    if (LIST.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: { text: string; check?: boolean | null }[] = [];
      for (; i < lines.length && LIST.test(lines[i]); i++) {
        const text = lines[i].replace(LIST, "");
        const box = /^\[( |x)\]\s+/i.exec(text);
        items.push(box ? { text: text.slice(box[0].length), check: !!box[1].trim() } : { text });
      }
      out.push({ type: "list", ordered, items });
      continue;
    }
    const para: string[] = [line];
    for (i++; i < lines.length && lines[i].trim() && !BREAK.test(lines[i]); i++) para.push(lines[i]);
    out.push({ type: "para", lines: para });
  }
  return out;
}

/** Split a line into runs: **bold**, _italic_, `code` and [[slots]]. */
export function inlineRuns(s: string): Inline[] {
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[\[([^\]]+)\]\]|(^|[\s(])_([^_\n]+)_(?=[\s).,;:]|$)/g;
  const out: Inline[] = [];
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const lead = m[4] ?? "";
    if (m.index + lead.length > last) out.push({ text: s.slice(last, m.index) + lead });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) out.push({ text: m[2], code: true });
    else if (m[3] !== undefined) out.push({ text: `[[${m[3]}]]`, slot: true });
    else out.push({ text: m[5], italic: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out.filter((r) => r.text);
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

export function inlineHtml(s: string): string {
  return inlineRuns(s)
    .map((r) => {
      const t = esc(r.text);
      return r.bold ? `<strong>${t}</strong>` : r.italic ? `<em>${t}</em>` : r.code ? `<code>${t}</code>` : r.slot ? `<mark class="slot">${t}</mark>` : t;
    })
    .join("");
}

export function mdToHtml(md: string): string {
  return parseBlocks(md)
    .map((b) => {
      switch (b.type) {
        case "heading": {
          const l = Math.min(5, b.level + 1);
          return `<h${l}>${inlineHtml(b.text)}</h${l}>`;
        }
        case "para":
          return `<p>${b.lines.map(inlineHtml).join("<br>")}</p>`;
        case "list": {
          const items = b.items
            .map((it) => (it.check !== undefined ? `<li class="check"><span class="box" aria-hidden="true">${it.check ? "☑" : "☐"}</span>${inlineHtml(it.text)}</li>` : `<li>${inlineHtml(it.text)}</li>`))
            .join("");
          return b.ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
        }
        case "table":
          return `<div class="table"><table>${b.head ? `<thead><tr>${b.head.map((c) => `<th>${inlineHtml(c)}</th>`).join("")}</tr></thead>` : ""}<tbody>${b.rows
            .map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table></div>`;
        case "quote":
          return `<blockquote>${b.lines.map(inlineHtml).join("<br>")}</blockquote>`;
        case "rule":
          return "<hr>";
        case "code":
          return `<pre>${esc(b.text)}</pre>`;
      }
    })
    .join("\n");
}

/** Plain text for pasting into a letter or saving as .txt: markup removed, structure kept. */
export function mdToPlain(md: string): string {
  const plain = (s: string) => inlineRuns(s).map((r) => r.text).join("");
  return parseBlocks(md)
    .map((b) => {
      switch (b.type) {
        case "heading":
          return plain(b.text);
        case "para":
          return b.lines.map(plain).join("\n");
        case "list":
          return b.items.map((it, n) => `${it.check !== undefined ? (it.check ? "☑ " : "☐ ") : b.ordered ? `${n + 1}. ` : "• "}${plain(it.text)}`).join("\n");
        case "table":
          return [...(b.head ? [b.head] : []), ...b.rows].map((r) => r.map(plain).join("\t")).join("\n");
        case "quote":
          return b.lines.map((l) => `    ${plain(l)}`).join("\n");
        case "rule":
          return "";
        case "code":
          return b.text;
      }
    })
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
