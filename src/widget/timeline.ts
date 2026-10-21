/**
 * The deadline timeline MCP App: renders the case file's statutory dates inside hosts
 * that support MCP Apps (Claude, ChatGPT, VS Code, M365 Copilot), and lets the
 * officer record an event and see its effect at once.
 *
 * The recalculation runs here, with the same engine the server uses, so it is instant
 * and works offline; the updated case file is then handed to the model through
 * ui/update-model-context so the conversation stays in step.
 */
import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { type CaseFile, EVENT_LABELS, EVENT_TYPES } from "../domain/case-file.ts";
import { type Timeline, computeTimeline, longDate, todayInCanberra } from "../domain/deadlines.ts";

const app = new App({ name: "FOI deadline timeline", version: "1.0.0" }, {});
const root = document.getElementById("app")!;
let current: { cf: CaseFile; tl: Timeline } | null = null;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const ICON: Record<string, string> = { met: "✓", missed: "✕", upcoming: "•", due_today: "!", overdue: "✕", info: "·" };

function render() {
  if (!current) {
    root.innerHTML = `<p class="muted">Waiting for a case file…</p>`;
    return;
  }
  const { cf, tl } = current;
  const p = tl.processing;
  const tone =
    tl.status === "deemed_refusal" ? "danger" : tl.status === "paused" ? "info" : tl.status === "decided" || tl.status === "withdrawn" ? "success" : (p.days_remaining ?? 99) <= 5 ? "warning" : "neutral";
  const total = p.effective_due ? Math.max(1, (Date.parse(p.effective_due) - Date.parse(tl.received_date)) / 86_400_000) : 1;
  const elapsed = Math.min(total, Math.max(0, (Date.parse(tl.as_of) - Date.parse(tl.received_date)) / 86_400_000));
  const pct = Math.round((elapsed / total) * 100);

  root.innerHTML = `
    <header class="head ${tone}">
      <div>
        <div class="ref">${esc(cf.reference ?? "FOI request")}</div>
        <div class="status">${esc(tl.status_label)}</div>
      </div>
      <div class="due">
        ${
          p.effective_due
            ? `<div class="due-label">Decision due</div><div class="due-date">${esc(longDate(p.effective_due))}</div>
               ${p.days_remaining !== null ? `<div class="due-left">${p.days_remaining > 0 ? `${p.days_remaining} days left` : p.days_remaining === 0 ? "Due today" : ""}</div>` : ""}`
            : p.paused_since
              ? `<div class="due-label">Clock stopped</div><div class="due-date">since ${esc(longDate(p.paused_since))}</div>`
              : ""
        }
      </div>
    </header>
    ${p.effective_due && tl.status === "open" ? `<div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>` : ""}
    <p class="calc">30 days from ${esc(longDate(tl.received_date))}${p.extension_days ? ` + ${p.extension_days} extension` : ""}${p.disregarded_days ? ` + ${p.disregarded_days} disregarded` : ""}${p.rolled_from_weekend ? " → next business day" : ""} · as at ${esc(longDate(tl.as_of))}</p>
    <ol class="dates">
      ${tl.key_dates
        .map(
          (k) => `<li class="k-${k.kind} s-${k.status ?? "info"}">
            <span class="icon" aria-hidden="true">${ICON[k.status ?? "info"]}</span>
            <span class="date">${esc(longDate(k.date))}</span>
            <span class="label">${esc(k.label)}${k.status === "upcoming" && k.days_remaining !== undefined ? ` <em>(${k.days_remaining}d)</em>` : ""}</span>
            <span class="prov">${esc(k.provision)}</span>
          </li>`,
        )
        .join("")}
    </ol>
    ${
      tl.adjustments.length
        ? `<details open><summary>Adjustments (${tl.adjustments.length})</summary><ul>${tl.adjustments
            .map((a) => `<li>${a.applied ? `<b>+${a.days}d</b>` : "<b>not applied</b>"} ${esc(a.label)} <span class="prov">${esc(a.provision)}</span>${a.note ? `<div class="note">${esc(a.note)}</div>` : ""}</li>`)
            .join("")}</ul></details>`
        : ""
    }
    ${tl.next_actions.length ? `<details open><summary>Next</summary><ul>${tl.next_actions.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></details>` : ""}
    ${tl.warnings.length ? `<details><summary>Check (${tl.warnings.length})</summary><ul>${tl.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></details>` : ""}
    <form id="add" class="add">
      <div class="add-title">Record an event</div>
      <select name="type" aria-label="Event type">${EVENT_TYPES.filter((t) => t !== "transferred_in")
        .map((t) => `<option value="${t}">${esc(EVENT_LABELS[t])}</option>`)
        .join("")}</select>
      <input name="date" type="date" value="${todayInCanberra()}" aria-label="Date" required />
      <input name="days" type="number" min="1" max="365" placeholder="days" aria-label="Days (extensions)" />
      <select name="outcome" aria-label="Outcome">
        <option value="">outcome…</option>
        <option value="revised">revised (s 24AB)</option><option value="declined_to_revise">declined to revise</option><option value="withdrawn">withdrawn</option>
        <option value="paid">charge paid</option><option value="deposit_paid">deposit paid</option><option value="not_imposed">charge not imposed</option>
      </select>
      <button type="submit">Add</button>
    </form>
    <div class="actions">
      <button id="ask" type="button">Ask what to do next</button>
    </div>`;

  document.getElementById("add")!.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target as HTMLFormElement);
    const event = {
      type: f.get("type") as CaseFile["events"][number]["type"],
      date: String(f.get("date")),
      ...(f.get("days") ? { days: Number(f.get("days")) } : {}),
      ...(f.get("outcome") ? { outcome: f.get("outcome") as CaseFile["events"][number]["outcome"] } : {}),
    };
    const cf2: CaseFile = { ...current!.cf, events: [...(current!.cf.events ?? []), event] };
    show(cf2);
    void app
      .updateModelContext({
        content: [{ type: "text", text: `The officer recorded "${EVENT_LABELS[event.type]}" on ${event.date} in the deadline timeline. Updated case file:\n${JSON.stringify(cf2)}` }],
        structuredContent: { case_file: cf2 },
      })
      .catch(() => {});
  });
  document.getElementById("ask")!.addEventListener("click", () => {
    void app
      .sendMessage({
        role: "user",
        content: [{ type: "text", text: `Using this case file, what should I do next on this FOI request?\n${JSON.stringify(current!.cf)}` }],
      })
      .catch(() => {});
  });
}

function show(cf: CaseFile, tl?: Timeline) {
  current = { cf, tl: tl ?? computeTimeline(cf, todayInCanberra()) };
  render();
}

function applyHost(ctx: ReturnType<typeof app.getHostContext>) {
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
}

app.ontoolresult = (params) => {
  const sc = params.structuredContent as { case_file?: CaseFile; timeline?: Timeline } | undefined;
  if (sc?.case_file) show(sc.case_file, sc.timeline);
};
app.ontoolinput = (params) => {
  const args = params.arguments as { case_file?: CaseFile } | undefined;
  if (args?.case_file && !current) show(args.case_file);
};
app.onhostcontextchanged = (ctx) => applyHost(ctx);

render();
app
  .connect()
  .then(() => applyHost(app.getHostContext()))
  .catch(() => {
    root.innerHTML = `<p class="muted">This view needs an MCP Apps host.</p>`;
  });
