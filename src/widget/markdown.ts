/**
 * The small markdown subset the tools write (headings, paragraphs, lists, checklists,
 * tables, quotes, rules, code fences, bold, italic, code and [[slots]]), rendered to
 * HTML for the document view and flattened to plain text for copy and download.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:]|$)/g, "$1<em>$2</em>")
    .replace(/\[\[([^\]]+)\]\]/g, '<mark class="slot">[[$1]]</mark>');
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
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
      out.push(`<pre>${esc(body.join("\n"))}</pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(4, h[1].length + 1);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^-{3,}\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[] = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) rows.push(lines[i]);
      const hasHead = rows.length > 1 && /^\|?\s*:?-{2,}/.test(rows[1].trim());
      const head = hasHead ? `<thead><tr>${cells(rows[0]).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>` : "";
      const body = (hasHead ? rows.slice(2) : rows).map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("");
      out.push(`<div class="table"><table>${head}<tbody>${body}</tbody></table></div>`);
      continue;
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      for (; i < lines.length && lines[i].startsWith(">"); i++) body.push(lines[i].replace(/^>\s?/, ""));
      out.push(`<blockquote>${body.map(inline).join("<br>")}</blockquote>`);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]); i++) {
        const text = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, "");
        const box = /^\[( |x)\]\s+/i.exec(text);
        items.push(box ? `<li class="check"><span class="box" aria-hidden="true">${box[1].trim() ? "☑" : "☐"}</span>${inline(text.slice(box[0].length))}</li>` : `<li>${inline(text)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }
    const para: string[] = [];
    for (; i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\||-{3,}\s*$|\s*([-*]|\d+\.)\s+)/.test(lines[i]); i++) para.push(lines[i]);
    if (!para.length) {
      out.push(`<p>${inline(line)}</p>`);
      i++;
    } else out.push(`<p>${para.map(inline).join("<br>")}</p>`);
  }
  return out.join("\n");
}

/** Plain text for pasting into a letter or saving as .txt: markup removed, structure kept. */
export function mdToPlain(md: string): string {
  return md
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => !l.startsWith("```"))
    .map((l) =>
      l
        .replace(/^#{1,4}\s+/, "")
        .replace(/^-{3,}\s*$/, "")
        .replace(/^>\s?/, "    ")
        .replace(/^(\s*)[-*]\s+\[( |x)\]\s+/i, "$1☐ ")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:]|$)/g, "$1$2")
        .replace(/`([^`]+)`/g, "$1"),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
