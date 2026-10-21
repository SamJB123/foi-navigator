/**
 * What the document view (the second MCP App) shows for a draft or a report: a card with
 * the headline figures, any warnings, the slots still to fill, and copy and download of
 * the whole document. Tools put it in structuredContent.view; the full text stays in the
 * markdown result for the model and for tools-only clients.
 */

export type DocumentView = {
  kind: "draft" | "report";
  title: string;
  subtitle?: string;
  /** Key figures shown large, e.g. total and deposit. */
  headline?: { label: string; value: string }[];
  /** Warnings the user must see, e.g. s 11B(4) flags or a bar on charging. */
  flags?: string[];
  /** For drafts: what the notice must contain. */
  must_include?: string[];
  /** For drafts: [[slots]] still to fill. */
  unfilled?: string[];
  /** A second thing worth copying on its own, e.g. a draft evidence statement. */
  extract?: { label: string; text: string };
  /** The whole document, as markdown. */
  body: string;
  /** Download name, without extension. */
  filename: string;
};

export const fileSlug = (...parts: (string | undefined)[]) =>
  parts
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "foi-document";
