import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "pet-preload.cjs"),
      formats: ["cjs"],
      fileName: () => "pet-preload.cjs",
    },
    rollupOptions: {
      external: ["electron"],
    },
    sourcemap: false,
    minify: false,
  },
});
