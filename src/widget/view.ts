/**
 * The FOI view MCP App: one widget for every tool but the timeline pair and fetch. It
 * renders the tool's structuredContent.view by kind, so what the user must see (a
 * flagged irrelevant factor, a bar on charging, a draft with its unfilled slots) is on
 * screen whatever the model chooses to relay.
 *
 * Every view shows the case file as it stands and fixed caveats. Interactive parts:
 * the public interest factors can be edited and re-checked here (the same check the
 * server runs); exemptions, steps, templates and search results open in place through
 * the host's tool proxy; drafts and reports copy as rich text or export to Word.
 * Anything the officer does here is reported back with ui/update-model-context.
 */
import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { longDate } from "../domain/deadlines.ts";
import { factorList } from "../domain/public-interest.ts";
import { isRecord } from "../guards.ts";
import { type View, viewSchema } from "../mcp/view-schema.ts";
import { base64, markdownToDocx } from "./docx.ts";
import { esc, inlineHtml, mdToHtml, mdToPlain } from "./markdown.ts";

const app = new App({ name: "FOI view", version: "1.0.0" }, {});
const root = document.getElementById("app") ?? document.body;

/** Views opened in this widget, newest last, for "Back". */
const history: View[] = [];
let status = "";
/** Checklist boxes the officer has ticked, kept across re-renders. */
const ticked = new Set<string>();
/** The latest case file seen, passed on when a step or template is opened from here. */
let lastCaseFile: Record<string, unknown> | undefined;

// --- helpers ------------------------------------------------------------------

const aud = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Make "[6.236]" references into links the host opens. Runs on escaped HTML. */
function linkify(html: string, links: Record<string, string>): string {
  return html.replace(/\[(\d{1,2}\.\d{1,3})\]/g, (m) => (links[m] ? `<a href="#" data-url="${esc(links[m])}">${m}</a>` : m));
}
const rich = (s: string, links: Record<string, string>) => linkify(inlineHtml(s), links);
const list = (items: string[], links: Record<string, string>) => `<ul>${items.map((i) => `<li>${rich(i, links)}</li>`).join("")}</ul>`;
const checklist = (items: string[], links: Record<string, string>, name: string) =>
  `<ul class="checks">${items
    .map((i, n) => `<li><label><input type="checkbox" data-check="${esc(`${name}-${n}`)}"${ticked.has(`${name}-${n}`) ? " checked" : ""}> <span>${rich(i, links)}</span></label></li>`)
    .join("")}</ul>`;
const section = (title: string, inner: string, open = false) => (inner ? `<details${open ? " open" : ""}><summary>${esc(title)}</summary>${inner}</details>` : "");

function caseStripHtml(v: View): string {
  const c = v.case;
  if (!c) return "";
  const due = c.decision_due
    ? `<b>${esc(longDate(c.decision_due))}</b>${c.days_remaining !== null && c.days_remaining >= 0 ? ` · ${plural(c.days_remaining, "day")} left` : ""}`
    : c.paused_since
      ? `clock stopped since ${esc(longDate(c.paused_since))}`
      : "—";
  return `<section class="case" aria-label="Case file">
    <div class="case-row">
      <span><span class="k">Request</span> ${esc(c.reference ?? "—")}</span>
      <span><span class="k">Received</span> ${esc(longDate(c.received))}</span>
      <span><span class="k">Decision due</span> ${due}</span>
      <span><span class="k">Status</span> ${esc(c.status)}</span>
      ${c.stage_title ? `<span><span class="k">Step</span> ${esc(c.stage_title)}</span>` : ""}
    </div>
    ${c.events.length ? `<details><summary>Events recorded (${c.events.length})</summary><ul>${c.events.map((e) => `<li>${esc(longDate(e.date))} — ${esc(e.label)}</li>`).join("")}</ul></details>` : `<div class="muted small">No events recorded yet.</div>`}
  </section>`;
}

function shell(v: View, kindLabel: string, inner: string, actions: string): string {
  return `
    ${history.length > 1 ? `<button type="button" class="back" data-action="back">← Back</button>` : ""}
    <header class="head"><div class="kind">${esc(kindLabel)}</div><h1>${esc(v.title)}</h1>${v.subtitle ? `<div class="sub">${esc(v.subtitle)}</div>` : ""}</header>
    ${caseStripHtml(v)}
    ${inner}
    <div class="actions">${actions}<span class="status" aria-live="polite">${esc(status)}</span></div>
    <footer class="caveats">${v.caveats.map((c) => `<p>${rich(c, v.links)}</p>`).join("")}</footer>`;
}

const canDownload = () => !!app.getHostCapabilities()?.downloadFile;
const canCallTools = () => !!app.getHostCapabilities()?.serverTools;
const exportButtons = (label: string) =>
  `<button type="button" class="primary" data-action="copy">Copy ${esc(label)}</button>${canDownload() ? `<button type="button" data-action="docx">Word (.docx)</button><button type="button" data-action="txt">Text (.txt)</button>` : ""}`;

// --- renderers by kind ----------------------------------------------------------

function renderDraft(v: Extract<View, { kind: "draft" }>): string {
  let doc = linkify(mdToHtml(v.body), v.links);
  for (const c of v.calculated) doc = doc.split(esc(c.text)).join(`<span class="calc" title="${esc(c.label)}">${esc(c.text)}</span>`);
  const inner = `
    ${
      v.unfilled.length
        ? `<div class="banner warn"><b>${plural(v.unfilled.length, "slot")} still to fill</b> — nothing should go out with a [[placeholder]] in it.<div class="chips">${v.unfilled.map((u) => `<span class="slot">${esc(u)}</span>`).join("")}</div></div>`
        : `<div class="banner ok">All slots filled. Review before sending.</div>`
    }
    ${v.calculated.length ? `<p class="small muted"><span class="calc">Underlined dates</span> come from the case file and the deadline engine.</p>` : ""}
    <article class="doc">${doc}</article>
    ${section(`Must include (${v.must_include.length})`, checklist(v.must_include, v.links, `must-${v.template}`))}`;
  return shell(v, `Draft · for the ${v.audience.replace("_", " ")}`, inner, `${exportButtons("draft")}${v.unfilled.length ? `<button type="button" data-action="fill">Fill the gaps with me</button>` : ""}`);
}

function renderCharges(v: Extract<View, { kind: "charges" }>): string {
  const inner = `
    ${v.barred_by ? `<div class="banner stop" role="alert"><b>Bar on charging: Charges Regs s 7.</b> ${rich(v.barred_by, v.links)}</div>` : ""}
    <div class="figures">
      <div class="fig"><div class="fig-label">Total charge</div><div class="fig-value${v.barred_by ? " struck" : ""}">${aud(v.total)}</div></div>
      <div class="fig"><div class="fig-label">Maximum deposit</div><div class="fig-value">${aud(v.deposit_maximum)}</div><div class="small muted">${esc(v.deposit_rule)}</div></div>
    </div>
    <div class="table"><table>
      <thead><tr><th>Item</th><th>Schedule 1</th><th>Quantity</th><th>Rate</th><th class="num">Amount</th></tr></thead>
      <tbody>${v.lines.map((l) => `<tr${l.amount < 0 ? ' class="deduct"' : ""}><td>${esc(l.item)}</td><td>${esc(l.provision)}</td><td>${esc(l.quantity)}</td><td>${esc(l.rate)}</td><td class="num">${aud(l.amount)}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">No chargeable items</td></tr>`}</tbody>
      <tfoot><tr><th colspan="4">Total${v.barred_by ? " (not payable)" : ""}</th><th class="num">${aud(v.total)}</th></tr></tfoot>
    </table></div>
    ${section("Check before charging", list(v.notes, v.links))}
    ${section("If the applicant contests the charge (s 29(4)–(5))", list(v.waiver, v.links))}`;
  return shell(v, "Charges", inner, exportButtons("assessment"));
}

function renderWorkload(v: Extract<View, { kind: "workload" }>): string {
  const inner = `
    <div class="banner info"><b>Not a threshold test.</b> There is no number of hours that makes a request a practical refusal. The decision-maker must be satisfied the work would substantially and unreasonably divert resources.</div>
    <div class="figures">
      <div class="fig"><div class="fig-label">Estimated work</div><div class="fig-value">${v.total_hours} h</div></div>
      <div class="fig"><div class="fig-label">Working days</div><div class="fig-value">${v.total_days}</div></div>
      ${v.fte_weeks !== undefined ? `<div class="fig"><div class="fig-label">Weeks of FOI team capacity</div><div class="fig-value">${v.fte_weeks}</div></div>` : ""}
    </div>
    <p class="small muted">${esc(v.sample)}</p>
    <div class="table"><table>
      <thead><tr><th>Activity (s 24AA(2))</th><th>Provision</th><th class="num">Hours</th><th>Basis</th></tr></thead>
      <tbody>${v.lines.map((l) => `<tr><td>${esc(l.activity)}</td><td>${esc(l.provision)}</td><td class="num">${l.hours}</td><td class="small">${rich(l.basis, v.links)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><th colspan="2">Total</th><th class="num">${v.total_hours}</th><th></th></tr></tfoot>
    </table></div>
    <div class="block">
      <div class="block-head"><b>Draft evidence statement</b> <span class="small muted">for the s 24AB notice; the decision-maker completes the reasoning</span></div>
      <blockquote>${rich(v.evidence_statement, v.links)}</blockquote>
      <button type="button" data-action="copy-evidence">Copy evidence statement</button>
    </div>
    ${section(`Cautions (${v.cautions.length})`, list(v.cautions, v.links), true)}
    ${section("Must consider", list(v.must_consider, v.links))}
    ${section("Must not consider", list(v.must_not_consider, v.links))}
    ${section("May also consider", list(v.may_consider, v.links))}
    ${section("Ways the applicant could revise the request", list(v.revision_suggestions, v.links))}`;
  return shell(v, "Practical refusal", inner, exportButtons("estimate"));
}

function renderPublicInterest(v: Extract<View, { kind: "public_interest" }>): string {
  const rows = v.factors
    .map(
      (f, n) => `<tr>
        <td><select data-factor-side="${n}" aria-label="Side"><option value="for"${f.side === "for" ? " selected" : ""}>For access</option><option value="against"${f.side === "against" ? " selected" : ""}>Against access</option></select></td>
        <td><input type="text" data-factor-text="${n}" value="${esc(f.factor)}" aria-label="Factor"></td>
        <td><button type="button" class="link" data-remove-factor="${n}" aria-label="Remove factor">✕</button></td>
      </tr>`,
    )
    .join("");
  const inner = `
    <h2>Your factors</h2>
    <div class="table"><table class="factors">
      <thead><tr><th>Side</th><th>Factor</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3" class="muted">No factors yet. Add the factors for and against access.</td></tr>`}</tbody>
    </table></div>
    <div class="row"><button type="button" data-action="add-factor">Add factor</button><button type="button" class="primary" data-action="save-factors">Update factors</button></div>
    <div class="banner warn">
      <b>Irrelevant factors: s 11B(4)</b>
      <p>These must not be taken into account in deciding whether access would, on balance, be contrary to the public interest:</p>
      ${list(v.irrelevant.map((i) => `**${i.id}** ${i.text}`), v.links)}
    </div>
    ${v.frankness ? `<p class="small">${rich(v.frankness, v.links)}</p>` : ""}
    <h2>Factors favouring access: s 11B(3)</h2>
    <p class="small muted">These must be considered if relevant (${linkify("[6.229]", v.links)}). Tick each once you have considered it.</p>
    ${checklist(
      v.statutory_for.map((f) => `**${f.id}** ${f.text}`),
      v.links,
      `s11B3-${v.provision}`,
    )}
    ${section("Other factors favouring access (Guidelines [6.231], non-exhaustive)", list(v.guidelines_for, v.links))}
    ${section("Factors against access (Guidelines [6.233], non-exhaustive; the Act lists none)", `<p class="small">Where disclosure could reasonably be expected to:</p>${list(v.guidelines_against, v.links)}`)}
    ${section("Weighing the factors", `<ol>${v.weighing_steps.map((s) => `<li>${rich(s, v.links)}</li>`).join("")}</ol>`)}`;
  return shell(v, `Public interest test · s ${v.provision}`, inner, exportButtons("worksheet"));
}

function renderExemptionList(v: Extract<View, { kind: "exemption_list" }>): string {
  const inner = `
    ${v.information && !v.matched ? `<div class="banner info">No exemption is listed against “${esc(v.information)}”, so this is the full list.</div>` : ""}
    <ul class="rows">${v.candidates
      .map(
        (c) => `<li class="erow">
          <div class="erow-main"><b>s ${esc(c.provision)}</b> ${esc(c.name)} ${c.kind === "conditional" ? `<span class="badge cond">Conditional · public interest test required</span>` : `<span class="badge">Exemption</span>`}<div class="small muted">${esc(c.summary)}</div></div>
          <div class="erow-actions"><button type="button" data-open-exemption="${esc(c.provision)}">Open</button>${c.kind === "conditional" ? `<button type="button" data-open-pit="${esc(c.provision)}">Public interest test</button>` : ""}</div>
        </li>`,
      )
      .join("")}</ul>`;
  return shell(v, "Exemptions", inner, exportButtons("list"));
}

function renderExemption(v: Extract<View, { kind: "exemption" }>): string {
  const e = v.exemption;
  const inner = `
    <div class="banner ${e.kind === "conditional" ? "warn" : "info"}">${
      e.kind === "conditional"
        ? `<b>Conditional exemption.</b> If the elements are met, access must still be given unless it would, on balance, be contrary to the public interest (s 11A(5)). <button type="button" data-open-pit="${esc(e.provision)}">Run the public interest test</button>`
        : "<b>Exemption.</b> No public interest test, but there is still a discretion to release (s 3A)."
    }</div>
    <p>${rich(e.summary, v.links)}</p>
    <h2>Elements: make a finding on each, with evidence</h2>
    ${checklist(e.elements, v.links, `element-${e.provision}`)}
    ${e.harm_test ? `<p><b>Harm threshold:</b> ${rich(e.harm_test, v.links)}</p>` : ""}
    ${section("Carve-outs and limits", e.carve_outs?.length ? list(e.carve_outs, v.links) : "")}
    ${section("Consultation", e.consultation ? `<p>${rich(e.consultation, v.links)}</p>` : "")}
    ${section("Neither confirm nor deny", e.ncnd ? "<p>Available where the existence of the document would itself be exempt (s 25).</p>" : "")}
    ${section(`Common errors (${e.pitfalls.length})`, list(e.pitfalls, v.links))}
    ${section("Questions for the line area", list(e.line_area_questions, v.links))}
    ${section(`The Act: s ${e.provision}`, v.section_text ? `<pre class="act">${esc(v.section_text.slice(0, 6000))}</pre>` : "")}
    ${section(
      "Key Guidelines paragraphs",
      v.key_paragraphs.map((p) => `<div class="cite-card"><a href="#" data-url="${esc(p.url)}"><b>${esc(p.ref)}</b></a> <span class="muted">${esc(p.title)}</span><p>${esc(p.text)}</p></div>`).join(""),
    )}`;
  return shell(v, e.kind === "conditional" ? "Conditional exemption" : "Exemption", inner, exportButtons("guide"));
}

function renderProcess(v: Extract<View, { kind: "process" }>): string {
  const done = new Set(v.completed);
  const stepper = `<ol class="stepper">${v.stages
    .map((s) => {
      const ids = s.steps.map((st) => st.id);
      const state = ids.includes(v.current ?? "") ? "current" : ids.length && ids.every((id) => done.has(id)) ? "done" : "";
      return `<li class="stage ${state}"><div class="stage-title">${esc(s.title)}</div><ul>${s.steps
        .map((st) => {
          const cls = st.id === v.current ? "current" : done.has(st.id) ? "done" : "";
          return `<li><button type="button" class="step ${cls}" data-open-step="${esc(st.id)}" title="${esc(st.purpose)}">${cls === "done" ? "✓ " : cls === "current" ? "● " : ""}${esc(st.title)}</button></li>`;
        })
        .join("")}</ul></li>`;
    })
    .join("")}</ol>`;
  const s = v.step;
  const detail = s
    ? `<section class="step-detail">
        <h2>${esc(s.title)}</h2>
        <p>${rich(s.purpose, v.links)}</p>
        ${s.when ? `<p class="small"><b>When:</b> ${rich(s.when, v.links)}</p>` : ""}
        ${s.tailored.length ? `<div class="banner info"><b>For this request</b>${list(s.tailored, v.links)}</div>` : ""}
        ${s.line_area.length ? `<h3>For the line area</h3>${list(s.line_area, v.links)}` : ""}
        <h3>Checklist</h3>
        ${checklist(s.checklist, v.links, `step-${s.id}`)}
        ${section(`Common errors (${s.pitfalls.length})`, list(s.pitfalls, v.links))}
        ${section(
          "What the sources say",
          s.excerpts.map((x) => `<div class="cite-card"><a href="#" data-url="${esc(x.url)}"><b>${esc(x.label)}</b></a><p>${esc(x.text)}${x.text.length >= 600 ? "…" : ""}</p></div>`).join(""),
        )}
        ${s.templates.length ? `<div class="row"><span class="small muted">Templates:</span>${s.templates.map((t) => `<button type="button" data-open-template="${esc(t)}">${esc(t.replace(/_/g, " "))}</button>`).join("")}</div>` : ""}
        ${s.next.length ? `<div class="row"><span class="small muted">Next:</span>${s.next.map((n) => `<button type="button" data-open-step="${esc(n)}">${esc(n)}</button>`).join("")}</div>` : ""}
      </section>`
    : `<p class="small muted">Select a step to open its guidance.</p>`;
  return shell(v, v.role === "line_area" ? "FOI process · line area" : "FOI process", stepper + detail, s ? exportButtons("guidance") : "");
}

function renderSearch(v: Extract<View, { kind: "search" }>): string {
  const label: Record<string, string> = { act: "FOI Act", regs: "Charges Regulations", guidelines: "FOI Guidelines" };
  const inner = `
    <p class="small muted">${plural(v.results.length, "result")} for “${esc(v.query)}”${v.mode === "keyword" ? " (keyword search only)" : ""}.</p>
    ${v.results
      .map(
        (r) => `<div class="cite-card">
          <div><span class="badge">${esc(label[r.source] ?? r.source)}</span> <b>${esc(r.ref)}</b> ${esc(r.title.replace(/^.*? — /, ""))}</div>
          ${r.heading ? `<div class="small muted">${esc(r.heading)}</div>` : ""}
          <p>${inlineHtml(r.snippet)}</p>
          <div class="row"><a href="#" data-url="${esc(r.url)}">Authoritative text</a><button type="button" class="link" data-read="${esc(r.id)}">Read here</button></div>
          <div class="read" data-read-out="${esc(r.id)}"></div>
        </div>`,
      )
      .join("")}`;
  return shell(v, "Search", inner, "");
}

function render() {
  const v = history.at(-1);
  if (!v) {
    root.innerHTML = `<p class="muted">Preparing the view…</p>`;
    return;
  }
  switch (v.kind) {
    case "draft":
      root.innerHTML = renderDraft(v);
      break;
    case "charges":
      root.innerHTML = renderCharges(v);
      break;
    case "workload":
      root.innerHTML = renderWorkload(v);
      break;
    case "public_interest":
      root.innerHTML = renderPublicInterest(v);
      break;
    case "exemption_list":
      root.innerHTML = renderExemptionList(v);
      break;
    case "exemption":
      root.innerHTML = renderExemption(v);
      break;
    case "process":
      root.innerHTML = renderProcess(v);
      break;
    case "search":
      root.innerHTML = renderSearch(v);
      break;
  }
}

// --- actions ---------------------------------------------------------------------

function say(s: string) {
  status = s;
  const el = root.querySelector(".status");
  if (el) el.textContent = s;
  setTimeout(() => {
    status = "";
    const now = root.querySelector(".status");
    if (now) now.textContent = "";
  }, 2500);
}

/** Tell the model what the officer did here, so the conversation stays in step. */
function note(text: string, structured?: Record<string, unknown>) {
  void app.updateModelContext({ content: [{ type: "text", text }], ...(structured ? { structuredContent: structured } : {}) }).catch(() => {});
}

async function copy(md: string) {
  const plain = mdToPlain(md);
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([mdToHtml(md)], { type: "text/html" }), "text/plain": new Blob([plain], { type: "text/plain" }) })]);
    } else await navigator.clipboard.writeText(plain);
    say("Copied");
  } catch {
    // Clipboard blocked by the host's sandbox: select the document instead.
    const target = root.querySelector(".doc") ?? root;
    const range = document.createRange();
    range.selectNodeContents(target);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    say("Selected: press Ctrl+C (⌘C on a Mac)");
  }
}

async function download(v: View, kind: "docx" | "txt") {
  const resource =
    kind === "docx"
      ? { uri: `file:///${v.filename}.docx`, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", blob: base64(markdownToDocx(v.body, v.kind === "draft" ? undefined : v.title)) }
      : { uri: `file:///${v.filename}.txt`, mimeType: "text/plain", text: mdToPlain(v.body) };
  try {
    const r = await app.downloadFile({ contents: [{ type: "resource", resource }] });
    say(r.isError ? "Download cancelled" : "Downloaded");
  } catch {
    say("Download isn't available here");
  }
}

/** Open another tool's result in this view, through the host; or ask in the chat if it can't. */
async function open(name: string, args: Record<string, unknown>, fallback: string) {
  if (!canCallTools()) {
    void app.sendMessage({ role: "user", content: [{ type: "text", text: fallback }] }).catch(() => say("Ask in the chat"));
    return;
  }
  say("Opening…");
  try {
    const res = await app.callServerTool({ name, arguments: args });
    const parsed = viewSchema.safeParse(isRecord(res.structuredContent) ? res.structuredContent.view : undefined);
    if (!parsed.success) {
      const msg = res.content.find((c) => c.type === "text");
      say(msg && msg.type === "text" ? msg.text.slice(0, 160) : "Couldn't open that here");
      return;
    }
    history.push(parsed.data);
    status = "";
    render();
    window.scrollTo(0, 0);
    note(`The officer opened "${parsed.data.title}" in the FOI view (${name}).`);
  } catch {
    say("Couldn't open that here");
  }
}


/** Read the public interest factor rows as edited. */
function editedFactors(): { factors_for: string[]; factors_against: string[] } {
  const out: { factors_for: string[]; factors_against: string[] } = { factors_for: [], factors_against: [] };
  for (const input of root.querySelectorAll("[data-factor-text]")) {
    if (!(input instanceof HTMLInputElement)) continue;
    const n = input.dataset.factorText;
    const side = root.querySelector(`[data-factor-side="${n}"]`);
    const text = input.value.trim();
    if (!text) continue;
    if (side instanceof HTMLSelectElement && side.value === "for") out.factors_for.push(text);
    else out.factors_against.push(text);
  }
  return out;
}

/** Keep the officer's edited factors in the view, and tell the model what they now are. */
function saveFactors(v: Extract<View, { kind: "public_interest" }>, edited: { factors_for: string[]; factors_against: string[] }) {
  const factors = factorList(edited.factors_for, edited.factors_against);
  history[history.length - 1] = { ...v, factors };
  render();
  const considered = v.statutory_for.filter((_, n) => ticked.has(`s11B3-${v.provision}-${n}`)).length;
  note(
    `The officer updated the public interest factors for s ${v.provision} in the FOI view. For access: ${JSON.stringify(edited.factors_for)}. Against access: ${JSON.stringify(edited.factors_against)}. ` +
      `s 11B(3) factors ticked as considered: ${considered} of ${v.statutory_for.length}.`,
    { provision: v.provision, factors },
  );
  say("Factors updated");
}

root.addEventListener("click", (ev) => {
  const target = ev.target instanceof Element ? ev.target : null;
  const v = history.at(-1);
  if (!target || !v) return;
  const link = target.closest("a[data-url]");
  if (link instanceof HTMLElement && link.dataset.url) {
    ev.preventDefault();
    void app.openLink({ url: link.dataset.url }).catch(() => say("Links can't open here"));
    return;
  }
  const el = target.closest("button");
  if (!(el instanceof HTMLButtonElement)) return;
  const d = el.dataset;
  if (d.action === "back") {
    history.pop();
    render();
  } else if (d.action === "copy") void copy(v.body);
  else if (d.action === "docx") void download(v, "docx");
  else if (d.action === "txt") void download(v, "txt");
  else if (d.action === "copy-evidence" && v.kind === "workload") void copy(v.evidence_statement);
  else if (d.action === "fill" && v.kind === "draft")
    void app
      .sendMessage({ role: "user", content: [{ type: "text", text: `Help me fill the remaining slots in the "${v.title}" draft, one at a time: ${v.unfilled.join("; ")}.` }] })
      .catch(() => say("Ask in the chat to fill the gaps"));
  else if (d.action === "add-factor" && v.kind === "public_interest") {
    const edited = editedFactors();
    history[history.length - 1] = { ...v, factors: [...factorList(edited.factors_for, edited.factors_against), { factor: "", side: "against" }] };
    render();
    const inputs = [...root.querySelectorAll("[data-factor-text]")];
    const last = inputs.at(-1);
    if (last instanceof HTMLInputElement) last.focus();
  } else if (d.action === "save-factors" && v.kind === "public_interest") saveFactors(v, editedFactors());
  else if (d.removeFactor !== undefined && v.kind === "public_interest") {
    const row = el.closest("tr");
    row?.remove();
    saveFactors(v, editedFactors());
  } else if (d.openExemption) void open("foi_exemption_guide", { provision: d.openExemption }, `Open s ${d.openExemption} in the exemption guide.`);
  else if (d.openPit) void open("foi_public_interest_test", { provision: d.openPit }, `Run the public interest test for s ${d.openPit}.`);
  else if (d.openStep) {
    const role = v.kind === "process" ? v.role : "officer";
    void open("foi_step_guidance", { step: d.openStep, role, ...(lastCaseFile ? { case_file: lastCaseFile } : {}) }, `Open the FOI step ${d.openStep}.`);
  } else if (d.openTemplate) void open("foi_draft_notice", { template: d.openTemplate, ...(lastCaseFile ? { case_file: lastCaseFile } : {}) }, `Draft the ${d.openTemplate} notice.`);
  else if (d.read) void readHere(d.read);
});

root.addEventListener("change", (ev) => {
  const box = ev.target;
  if (!(box instanceof HTMLInputElement) || !box.dataset.check) return;
  if (box.checked) ticked.add(box.dataset.check);
  else ticked.delete(box.dataset.check);
});

async function readHere(id: string) {
  const out = [...root.querySelectorAll("[data-read-out]")].find((n) => n instanceof HTMLElement && n.dataset.readOut === id);
  if (!(out instanceof HTMLElement)) return;
  if (out.innerHTML) {
    out.innerHTML = "";
    return;
  }
  if (!canCallTools()) {
    say("Open the authoritative text instead");
    return;
  }
  try {
    const res = await app.callServerTool({ name: "fetch", arguments: { id } });
    const sc = res.structuredContent;
    out.innerHTML = isRecord(sc) && typeof sc.text === "string" ? `<pre class="act">${esc(sc.text.slice(0, 8000))}</pre>` : `<p class="muted">Couldn't load it.</p>`;
  } catch {
    out.innerHTML = `<p class="muted">Couldn't load it.</p>`;
  }
}

function applyHost(ctx: ReturnType<typeof app.getHostContext>) {
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
}

app.ontoolinput = (params) => {
  const cf = params.arguments?.case_file;
  if (isRecord(cf)) lastCaseFile = cf;
};
app.ontoolresult = (params) => {
  const sc = params.structuredContent;
  if (isRecord(sc) && isRecord(sc.case_file)) lastCaseFile = sc.case_file;
  const parsed = viewSchema.safeParse(isRecord(sc) ? sc.view : undefined);
  if (!parsed.success) {
    // Show the result's own text rather than nothing (e.g. a cached widget older than the server).
    const text = params.content?.find((c) => c.type === "text");
    root.innerHTML = text && text.type === "text" ? `<article class="doc">${mdToHtml(text.text)}</article>` : `<p class="muted">The result is in the chat.</p>`;
    return;
  }
  history.length = 0;
  history.push(parsed.data);
  render();
};
app.onhostcontextchanged = (ctx) => applyHost(ctx);

render();
app
  .connect()
  .then(() => {
    applyHost(app.getHostContext());
    render(); // host capabilities (download, tool calls) are known now
  })
  .catch(() => {
    root.innerHTML = `<p class="muted">This view needs an MCP Apps host.</p>`;
  });
