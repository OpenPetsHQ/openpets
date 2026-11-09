import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "web/studio/tools/plugin-validator.cjs");
const result = await build({
  absWorkingDir: root,
  entryPoints: ["scripts/marketplace-validator.mjs"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["sharp"],
  legalComments: "none",
  write: false,
  outfile: output,
});
const bytes = result.outputFiles[0].contents;
if (process.argv.includes("--check")) {
  const current = await readFile(output);
  if (!Buffer.from(bytes).equals(current)) throw new Error("Marketplace validator bundle is stale; run pnpm marketplace:validator:build.");
  console.log("Marketplace validator bundle is current.");
} else {
  await writeFile(output, bytes);
  console.log(`Built ${output}`);
}
