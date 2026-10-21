import { env } from "cloudflare:workers";
import { beforeAll } from "vitest";

declare global {
  namespace Cloudflare {
    interface Env {
      CONTENT_SQL: string[];
    }
  }
}

beforeAll(async () => {
  const loaded = await env.DB.prepare("SELECT count(*) AS n FROM passages")
    .first<{ n: number }>()
    .catch(() => null);
  if (loaded?.n) return;
  const statements = env.CONTENT_SQL;
  for (let i = 0; i < statements.length; i += 200) {
    await env.DB.batch(statements.slice(i, i + 200).map((s) => env.DB.prepare(s)));
  }
});
