import { build } from "esbuild";
import { access, cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const vipsRoot = resolve(dirname(require.resolve("wasm-vips")), "..");
await rm(resolve(root, "dist"), { recursive: true, force: true });
await mkdir(resolve(root, "dist", "media"), { recursive: true });
await mkdir(resolve(root, "dist", "decoder"), { recursive: true });
await Promise.all([
  build({
    entryPoints: [resolve(root, "src/host/scene-worker.ts")],
    outfile: resolve(root, "dist/scene-worker.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
  }),
  ...[
    "vips-node.mjs",
    "vips.wasm",
    "vips-heif.wasm",
    "vips-jxl.wasm",
    "vips-resvg.wasm",
  ].map((file) =>
    cp(resolve(vipsRoot, "lib", file), resolve(root, "dist", "decoder", file)),
  ),
  ...["LICENSE", "THIRD-PARTY-NOTICES.md"].map((file) =>
    cp(resolve(vipsRoot, file), resolve(root, "dist", "decoder", file)),
  ),
]);
await cp(
  resolve(root, "../desktop/assets/default-pet-spritesheet.webp"),
  resolve(root, "dist/media/default-pet-spritesheet.webp"),
);
await Promise.all([
  build({
    entryPoints: [resolve(root, "src/host/validation-worker.ts")],
    outfile: resolve(root, "dist/validation-worker.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
  }),
  build({
    entryPoints: [resolve(root, "src/host/package-validation.ts")],
    outfile: resolve(root, "dist/package-validation.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
  }),
  build({
    entryPoints: [resolve(root, "src/extension.ts")],
    outfile: resolve(root, "dist/extension.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    external: ["vscode"],
  }),
  build({
    entryPoints: [resolve(root, "src/webview/main.tsx")],
    outfile: resolve(root, "dist/webview/main.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
  }),
]);
// A missing renderer stylesheet is a broken build, not an empty-style fallback.
await access(resolve(root, "dist/webview/main.css"));
