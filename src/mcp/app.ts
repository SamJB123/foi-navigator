/**
 * The MCP App resources, served as ui:// resources that tools point to:
 *
 *   timeline  the deadline timeline (foi_start_request, foi_calculate_deadlines)
 *   document  a card for a draft or report, with copy and download (foi_draft_notice,
 *             foi_estimate_charges, foi_estimate_workload, foi_public_interest_test)
 *
 * Both are self-contained (no network), so they declare no CSP domains. The document
 * view asks for clipboard write so "Copy" works; it falls back to selecting the text.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { RESOURCE_MIME_TYPE, registerAppResource } from "@modelcontextprotocol/ext-apps/server";
import documentHtml from "../../dist/document.html";
import timelineHtml from "../../dist/timeline.html";

export const TIMELINE_URI = "ui://foi-navigator/timeline.html";
export const DOCUMENT_URI = "ui://foi-navigator/document.html";

export function registerApp(server: McpServer): void {
  const apps = [
    { name: "FOI deadline timeline", uri: TIMELINE_URI, html: timelineHtml, description: "Interactive view of a request's statutory dates, with event recording.", ui: { prefersBorder: true } },
    {
      name: "FOI document",
      uri: DOCUMENT_URI,
      html: documentHtml,
      description: "A draft notice or report: key figures, warnings, slots still to fill, and copy or download.",
      ui: { prefersBorder: true, permissions: { clipboardWrite: {} } },
    },
  ];
  for (const a of apps) {
    registerAppResource(server, a.name, a.uri, { description: a.description, mimeType: RESOURCE_MIME_TYPE, _meta: { ui: a.ui } }, async () => ({
      contents: [{ uri: a.uri, mimeType: RESOURCE_MIME_TYPE, text: a.html, _meta: { ui: a.ui } }],
    }));
  }
}
