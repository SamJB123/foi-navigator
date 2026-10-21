/**
 * Download the primary sources into sources/ (gitignored): the current compilations
 * of the FOI Act and the Charges Regulations from the Federal Register of Legislation
 * API, and each part of the OAIC FOI Guidelines as HTML.
 *
 *   node scripts/fetch-sources.ts
 *
 * Both sources are CC BY 4.0. The Register asks for gentle crawling: this fetches
 * 17 documents, one at a time, with a pause between OAIC pages.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";

const ROOT = join(import.meta.dirname, "..");

/** The fields used from a Federal Register of Legislation version record (others pass through). */
const VERSION = z.looseObject({ registerId: z.string(), compilationNumber: z.coerce.string(), start: z.string(), registeredAt: z.string() });
const OUT = join(ROOT, "sources");
const API = "https://api.prod.legislation.gov.au/v1";
const UA = "foi-navigator-content-build (+https://github.com/aicolab)";

export const LEGISLATION = [
  { key: "act", titleId: "C2004A02562", name: "Freedom of Information Act 1982" },
  { key: "regs", titleId: "F2019L00348", name: "Freedom of Information (Charges) Regulations 2019" },
] as const;

const GUIDELINES_BASE =
  "https://www.oaic.gov.au/freedom-of-information/freedom-of-information-guidance-for-government-agencies/foi-guidelines/";

// Part 8 was superseded and moved into Part 3, so it is not fetched.
export const GUIDELINE_PARTS: Record<number, string> = {
  1: "part-1-introduction-to-the-freedom-of-information-act-1982",
  2: "part-2-scope-of-application-of-the-freedom-of-information-act-1982",
  3: "part-3-processing-and-deciding-on-requests-foi-access",
  4: "part-4-charges-for-providing-access",
  5: "part-5-exemptions",
  6: "part-6-conditional-exemptions",
  7: "part-7-amendment-and-annotation-of-personal-records",
  9: "part-9-internal-agency-review-of-decisions",
  10: "part-10-review-by-the-information-commissioner",
  11: "part-11-investigations-and-complaints",
  12: "part-12-vexatious-applicant-declarations",
  13: "part-13-information-publication-scheme",
  14: "part-14-disclosure-log",
  15: "part-15-reporting",
};

async function get(url: string): Promise<Response> {
  const response = await fetch(url, { headers: { "user-agent": UA } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchLegislation() {
  for (const { key, titleId, name } of LEGISLATION) {
    const version = VERSION.parse(await (await get(`${API}/versions/find(titleId='${titleId}',asAtSpecification='Latest')`)).json());
    const epub = await get(
      `${API}/documents/find(registerId='${version.registerId}',type='Primary',format='Epub',uniqueTypeNumber=0,volumeNumber=0,rectificationVersionNumber=0)`,
    );
    const dir = join(OUT, key);
    await mkdir(dir, { recursive: true });
    const epubPath = join(dir, `${version.registerId}.epub`);
    await writeFile(epubPath, Buffer.from(await epub.arrayBuffer()));
    execFileSync("unzip", ["-o", "-q", epubPath, "-d", join(dir, "epub")]);
    await writeFile(
      join(dir, "version.json"),
      JSON.stringify({ titleId, name, ...version, url: `https://www.legislation.gov.au/${titleId}/latest/text` }, null, 2),
    );
    console.log(`${name}: ${version.registerId} (compilation ${version.compilationNumber}, in force ${version.start.slice(0, 10)})`);
  }
}

async function fetchGuidelines() {
  const dir = join(OUT, "guidelines");
  await mkdir(dir, { recursive: true });
  for (const [part, slug] of Object.entries(GUIDELINE_PARTS)) {
    const html = await (await get(GUIDELINES_BASE + slug)).text();
    await writeFile(join(dir, `part-${part}.html`), html);
    console.log(`Guidelines Part ${part}: ${html.length.toLocaleString()} bytes`);
    await sleep(1500);
  }
}

if (import.meta.main) {
  await fetchLegislation();
  await fetchGuidelines();
}
