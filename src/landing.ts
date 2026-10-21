/**
 * The landing page at /: the explainer (src/explainer.html) for people who know FOI but
 * are new to connectors, with the connector URL and source versions filled in at serve time.
 */
import { GUIDELINE_PARTS, MANIFEST } from "./corpus.ts";
import explainer from "./explainer.html";

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ENTITIES[c] ?? c);
const longDate = (iso: string) =>
  /^\d{4}-\d{2}-\d{2}/.test(iso) ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : iso;

export function landingPage(origin: string): string {
  const values: Record<string, string> = {
    __ORIGIN__: origin,
    __MCP_URL__: `${origin}/mcp`,
    __ACT_ID__: MANIFEST.legislation.act.registerId,
    __ACT_IN_FORCE__: longDate(MANIFEST.legislation.act.inForceFrom),
    __REGS_ID__: MANIFEST.legislation.regs.registerId,
    __GUIDELINES__: Object.entries(GUIDELINE_PARTS)
      .map(([n, g]) => `Part ${n} v${g.version}`)
      .join(", "),
    __BUILT_AT__: longDate(MANIFEST.builtAt),
  };
  return explainer.replace(/__[A-Z_]+__/g, (key) => (key in values ? esc(values[key]) : key));
}
