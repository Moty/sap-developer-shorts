import { copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const output = resolve("dist/private-studio");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  entryPoints: ["src/web/private/app.ts"],
  outfile: resolve(output, "app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  sourcemap: false,
});
for (const [source, target] of [
  ["index.html", "index.html"],
  ["app.css", "app.css"],
])
  await copyFile(resolve("src/web/private", source ?? ""), resolve(output, target ?? ""));
console.log(`Private app shell: ${output}`);
