import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve("apps/desktop/renderer"),
  plugins: [react()],
  base: "./",
  build: { outDir: path.resolve("dist-renderer"), emptyOutDir: true },
  server: { port: 5173, strictPort: true }
});
