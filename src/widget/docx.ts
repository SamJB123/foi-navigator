/**
 * A real Word document (.docx) from the tools' markdown, built in the browser with no
 * dependencies: WordprocessingML for the body and a stored (uncompressed) zip around
 * it. Headings use Word's built-in heading styles, so the document's navigation pane
 * and an agency template's styles both work on it; [[slots]] are highlighted yellow.
 */
import { type Inline, esc, inlineRuns, parseBlocks } from "./markdown.ts";

const xml = (s: string) => esc(s);

function runs(text: string, base: Partial<Inline> = {}): string {
  return inlineRuns(text)
    .map((r) => {
      const bold = r.bold || base.bold;
      const italic = r.italic || base.italic;
      const props = [
        bold ? "<w:b/>" : "",
        italic ? "<w:i/>" : "",
        r.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : "",
        r.slot ? '<w:highlight w:val="yellow"/>' : "",
      ].join("");
      return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(r.text)}</w:t></w:r>`;
    })
    .join("");
}

const para = (content: string, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${content}</w:p>`;
const lines = (ls: string[], base: Partial<Inline> = {}) => ls.map((l) => runs(l, base)).join("<w:r><w:br/></w:r>");

function body(md: string, title?: string): string {
  const out: string[] = [];
  if (title) out.push(para(runs(title), '<w:pStyle w:val="Title"/>'));
  for (const b of parseBlocks(md)) {
    switch (b.type) {
      case "heading":
        out.push(para(runs(b.text), `<w:pStyle w:val="Heading${Math.min(3, b.level)}"/>`));
        break;
      case "para":
        out.push(para(lines(b.lines)));
        break;
      case "list":
        b.items.forEach((it, n) => {
          const mark = it.check !== undefined ? (it.check ? "☑" : "☐") : b.ordered ? `${n + 1}.` : "•";
          out.push(para(`<w:r><w:t xml:space="preserve">${mark}\t</w:t></w:r>${runs(it.text)}`, '<w:tabs><w:tab w:val="left" w:pos="360"/></w:tabs><w:ind w:left="360" w:hanging="360"/>'));
        });
        break;
      case "quote":
        out.push(para(lines(b.lines), '<w:ind w:left="720"/>'));
        break;
      case "rule":
        out.push(para("", '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>'));
        break;
      case "code":
        out.push(para(lines(b.text.split("\n"), { code: true })));
        break;
      case "table": {
        const all = [...(b.head ? [b.head] : []), ...b.rows];
        const cols = Math.max(...all.map((r) => r.length));
        const w = Math.floor(9000 / cols);
        const border = '<w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/>';
        const row = (r: string[], head: boolean) =>
          `<w:tr>${Array.from({ length: cols }, (_, c) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>${para(runs(r[c] ?? "", { bold: head }))}</w:tc>`).join("")}</w:tr>`;
        out.push(
          `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${border}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${`<w:gridCol w:w="${w}"/>`.repeat(cols)}</w:tblGrid>${b.head ? row(b.head, true) : ""}${b.rows.map((r) => row(r, false)).join("")}</w:tbl>`,
          para(""),
        );
        break;
      }
    }
  }
  return out.join("");
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const STYLES = `${HEAD}<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-AU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:style>
</w:styles>`;

export function docxFiles(md: string, title?: string): Record<string, string> {
  return {
    "[Content_Types].xml": `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    "_rels/.rels": `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/_rels/document.xml.rels": `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "word/styles.xml": STYLES,
    "word/document.xml": `${HEAD}<w:document ${W}><w:body>${body(md, title)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  };
}

// --- a stored zip ----------------------------------------------------------------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nm = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nm.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(12, 0x21, true); // 1 Jan 1980
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nm.length, true);
    local.set(nm, 30);
    local.set(data, 30 + nm.length);
    const central = new Uint8Array(46 + nm.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nm.length, true);
    cv.setUint32(42, offset, true);
    central.set(nm, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

export const markdownToDocx = (md: string, title?: string) => zip(docxFiles(md, title));

export function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
