import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { devReader } from "./scripts/dev-reader.mjs";

export default defineConfig({
  root: "ui",
  base: "./",
  plugins: [react(), tailwind(), viteSingleFile(), devReader()],
  server: { host: "127.0.0.1" },
  resolve: { alias: { "@": fileURLToPath(new URL("./ui/kit", import.meta.url)) } },
  build: { outDir: "../dist/hacker-news", emptyOutDir: false, reportCompressedSize: false, target: "es2022" },
});
