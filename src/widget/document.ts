/**
 * The document view MCP App: a card for a draft notice or a report (charges, workload,
 * public interest worksheet) inside hosts that support MCP Apps. It complements the
 * assistant's reply rather than repeating it: the headline figures and warnings, the
 * slots still to fill, a collapsed preview, and copy (rich text for Word and Outlook)
 * and download of the whole document.
 */
import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import type { DocumentView } from "../mcp/document-view.ts";
import { mdToHtml, mdToPlain } from "./markdown.ts";

const app = new App({ name: "FOI document", version: "1.0.0" }, {});
const root = document.getElementById("app")!;
let view: DocumentView | null = null;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function render() {
  if (!view) {
    root.innerHTML = `<p class="muted">Preparing the document…</p>`;
    return;
  }
  const v = view;
  const canDownload = !!app.getHostCapabilities()?.downloadFile;
  root.innerHTML = `
    <header class="head">
      <div class="kind">${v.kind === "draft" ? "Draft" : "Report"}</div>
      <h1>${esc(v.title)}</h1>
      ${v.subtitle ? `<div class="sub">${esc(v.subtitle)}</div>` : ""}
    </header>
    ${v.headline?.length ? `<div class="figures">${v.headline.map((h) => `<div class="fig"><div class="fig-label">${esc(h.label)}</div><div class="fig-value">${esc(h.value)}</div></div>`).join("")}</div>` : ""}
    ${v.flags?.length ? `<div class="flags" role="alert">${v.flags.map((f) => `<p>${mdToHtml(f).replace(/^<p>|<\/p>$/g, "")}</p>`).join("")}</div>` : ""}
    ${
      v.kind === "draft"
        ? v.unfilled?.length
          ? `<div class="slots"><div class="slots-title">Still to fill (${v.unfilled.length})</div>${v.unfilled.map((u) => `<span class="slot">${esc(u)}</span>`).join("")}</div>`
          : `<div class="done">All slots filled. Review before sending.</div>`
        : ""
    }
    ${v.must_include?.length ? `<details><summary>Must include (${v.must_include.length})</summary><ul>${v.must_include.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></details>` : ""}
    <details class="preview"><summary>Preview the ${v.kind === "draft" ? "draft" : "report"}</summary><div class="doc">${mdToHtml(v.body)}</div></details>
    <div class="actions">
      <button id="copy" type="button" class="primary">Copy ${v.kind === "draft" ? "draft" : "report"}</button>
      ${v.extract ? `<button id="copyExtract" type="button">Copy ${esc(v.extract.label)}</button>` : ""}
      ${canDownload ? `<button id="download" type="button">Download .txt</button>` : ""}
      ${v.kind === "draft" && v.unfilled?.length ? `<button id="fill" type="button">Fill the gaps with me</button>` : ""}
      <span id="status" class="muted" aria-live="polite"></span>
    </div>`;

  const status = document.getElementById("status")!;
  const say = (s: string) => {
    status.textContent = s;
    setTimeout(() => (status.textContent = ""), 2500);
  };
  document.getElementById("copy")!.addEventListener("click", () => void copy(v.body, say));
  document.getElementById("copyExtract")?.addEventListener("click", () => void copy(v.extract!.text, say));
  document.getElementById("download")?.addEventListener("click", () => {
    void app
      .downloadFile({ contents: [{ type: "resource", resource: { uri: `file:///${v.filename}.txt`, mimeType: "text/plain", text: mdToPlain(v.body) } }] })
      .then((r) => say(r.isError ? "Download cancelled" : "Downloaded"))
      .catch(() => say("Download isn't available here"));
  });
  document.getElementById("fill")?.addEventListener("click", () => {
    void app
      .sendMessage({
        role: "user",
        content: [{ type: "text", text: `Help me fill the remaining slots in the "${v.title}" draft, one at a time: ${v.unfilled!.join("; ")}. Then show me the completed draft in full.` }],
      })
      .catch(() => say("Ask in the chat to fill the gaps"));
  });
}

/** Rich text where the host allows it (pastes formatted into Word and Outlook), else plain. */
async function copy(md: string, say: (s: string) => void) {
  const plain = mdToPlain(md);
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": new Blob([mdToHtml(md)], { type: "text/html" }), "text/plain": new Blob([plain], { type: "text/plain" }) }),
      ]);
    } else await navigator.clipboard.writeText(plain);
    say("Copied");
  } catch {
    // Clipboard blocked by the host's sandbox: open the preview and select it instead.
    const preview = root.querySelector<HTMLDetailsElement>("details.preview");
    if (preview) preview.open = true;
    const doc = root.querySelector(".doc");
    if (doc) {
      const range = document.createRange();
      range.selectNodeContents(doc);
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    say("Selected: press Ctrl+C (⌘C on a Mac)");
  }
}

function applyHost(ctx: ReturnType<typeof app.getHostContext>) {
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
}

app.ontoolresult = (params) => {
  const sc = params.structuredContent as { view?: DocumentView } | undefined;
  if (sc?.view) {
    view = sc.view;
    render();
  }
};
app.onhostcontextchanged = (ctx) => applyHost(ctx);

render();
app
  .connect()
  .then(() => {
    applyHost(app.getHostContext());
    render(); // host capabilities (download) are known now
  })
  .catch(() => {
    root.innerHTML = `<p class="muted">This view needs an MCP Apps host.</p>`;
  });
