import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// SINGLE=1 builds one self-contained HTML file (for a preview page). The normal build is a static site with a service worker.
const single = process.env.SINGLE === "1";
export default defineConfig({
  base: "./",
  plugins: [react(), ...(single ? [viteSingleFile()] : [])],
  define: { __SINGLE__: JSON.stringify(single) },
  // The normal build has two pages: Album itself and the check page anyone can use.
  build: single
    ? { outDir: "dist-single" }
    : { outDir: "dist", rollupOptions: { input: { main: "index.html", check: "check.html" } } },
});
