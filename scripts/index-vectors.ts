/**
 * Embed every passage into Vectorize through the deployed Worker's admin route, in
 * batches (the Worker calls Workers AI and upserts, so no API token is needed here).
 * Run after loading data/d1/content.sql into the remote D1.
 *
 *   FOI_URL=https://foi-navigator.<subdomain>.workers.dev FOI_ADMIN_TOKEN=... node scripts/index-vectors.ts
 */
import { z } from "zod";

const BATCH = z.object({ done: z.boolean(), next: z.number().optional(), total: z.number().optional(), indexed: z.number().optional() });

const base = process.env.FOI_URL ?? "https://foi-navigator.aicolab.workers.dev";
const token = process.env.FOI_ADMIN_TOKEN;
if (!token) throw new Error("Set FOI_ADMIN_TOKEN (the Worker's ADMIN_TOKEN secret).");

let offset = Number(process.env.FOI_OFFSET ?? 0);
for (;;) {
  const res = await fetch(`${base}/admin/reindex?offset=${offset}&limit=40`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${res.status} at offset ${offset}: ${await res.text()}`);
  const body = BATCH.parse(await res.json());
  if (body.indexed) console.log(`indexed ${offset + body.indexed}/${body.total}`);
  if (body.done || body.next === undefined) break;
  offset = body.next;
}
console.log("done");
