import fs from "node:fs";
import path from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The corpus SQL, split into statements on the node side and handed to the workerd
// pool as a binding; test/setup.ts applies it to the test D1 before each file.
const sql = fs.readFileSync(path.join(import.meta.dirname, "data/d1/content.sql"), "utf8");
const statements = sql.split(/;\n(?=INSERT|CREATE|DROP)/).map((s) => s.replace(/;\s*$/, "").trim()).filter(Boolean);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
      miniflare: { bindings: { CONTENT_SQL: statements } },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
