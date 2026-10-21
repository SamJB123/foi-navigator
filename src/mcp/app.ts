/**
 * The MCP App resources, served as ui:// resources that tools point to:
 *
 *   timeline  the deadline timeline (foi_start_request, foi_calculate_deadlines)
 *   view      the FOI view for every other tool but fetch: drafts, charges, workload,
 *             the public interest worksheet, exemptions, the process stepper and
 *             search results, each with the case file and fixed caveats
 *
 * Both are self-contained (no network), so they declare no CSP domains. The FOI view
 * asks for clipboard write so "Copy" works; it falls back to selecting the text.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { RESOURCE_MIME_TYPE, registerAppResource } from "@modelcontextprotocol/ext-apps/server";
import timelineHtml from "../../dist/timeline.html";
import viewHtml from "../../dist/view.html";

/** FNV-1a, for a short content version: hosts cache ui:// resources by URI. */
function contentVersion(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

// Each build gets new URIs, so a host can never pair a cached older widget with newer data.
export const TIMELINE_URI = `ui://foi-navigator/timeline-${contentVersion(timelineHtml)}.html`;
export const VIEW_URI = `ui://foi-navigator/view-${contentVersion(viewHtml)}.html`;

export function registerApp(server: McpServer): void {
  const apps = [
    { name: "FOI deadline timeline", uri: TIMELINE_URI, html: timelineHtml, description: "Interactive view of a request's statutory dates, with event recording.", ui: { prefersBorder: true } },
    {
      name: "FOI view",
      uri: VIEW_URI,
      html: viewHtml,
      description: "Drafts, calculations, worksheets, exemptions, the process and search results, with the case file and copy or Word export.",
      ui: { prefersBorder: true, permissions: { clipboardWrite: {} } },
    },
  ];
  for (const a of apps) {
    registerAppResource(server, a.name, a.uri, { description: a.description, mimeType: RESOURCE_MIME_TYPE, _meta: { ui: a.ui } }, async () => ({
      contents: [{ uri: a.uri, mimeType: RESOURCE_MIME_TYPE, text: a.html, _meta: { ui: a.ui } }],
    }));
  }
}
