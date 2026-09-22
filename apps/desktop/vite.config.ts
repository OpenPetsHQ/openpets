import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const productionCsp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https://openpets.dev openpets-codex: openpets-installed: openpets-pet-preview: openpets-plugin-asset:; media-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'";
const devCsp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://openpets.dev openpets-codex: openpets-installed: openpets-pet-preview: openpets-plugin-asset:; media-src 'self' blob:; connect-src 'self' http://127.0.0.1:5173 ws://127.0.0.1:5173; base-uri 'none'; form-action 'none'; frame-src 'none'";

export default defineConfig(({ command }) => ({
  root: "src/renderer",
  base: "./",
  plugins: [
    react(),
    command === "serve" && {
      name: "openpets-dev-csp",
      transformIndexHtml(html: string) {
        return html.replace(productionCsp, devCsp);
      },
    },
  ].filter(Boolean),
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "src/renderer/index.html"),
      },
    },
  },
}));
