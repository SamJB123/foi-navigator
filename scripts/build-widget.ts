/**
 * Bundle the MCP Apps (src/widget/timeline.ts, src/widget/document.ts) and inline each
 * into one self-contained HTML file in dist/, which the Worker imports as text and
 * serves as a ui:// resource. Hosts render them in a sandboxed iframe with no network
 * by default, so nothing may load from outside the file.
 *
 *   node scripts/build-widget.ts
 */
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
await mkdir(join(ROOT, "dist"), { recursive: true });

for (const name of ["timeline", "document"]) {
  const out = await build({
    entryPoints: [join(ROOT, `src/widget/${name}.ts`)],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
    write: false,
    legalComments: "none",
  });
  const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const html = (await readFile(join(ROOT, `src/widget/${name}.html`), "utf8")).replace("/*__WIDGET_JS__*/", () => js);
  await writeFile(join(ROOT, `dist/${name}.html`), html);
  console.log(`dist/${name}.html: ${(html.length / 1024).toFixed(1)} KB`);
}
