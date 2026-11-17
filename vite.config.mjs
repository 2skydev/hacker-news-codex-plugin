import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

const devkit = path.dirname(fileURLToPath(import.meta.resolve("sign-in-with-chatgpt/package.json")));
export default defineConfig({
  root: "ui",
  base: "./",
  plugins: [
    {
      name: "siwc-source-assets",
      enforce: "pre",
      async load(id) {
        if (!id.endsWith("/packages/react/src/styles.css")) return;
        const dir = path.dirname(id);
        const css = await readFile(id, "utf8");
        let tokens = await readFile(path.join(dir, "tokens.css"), "utf8");
        for (const [url, file] of tokens.matchAll(/url\("\.\/(assets\/fonts\/[^"]+)"\)/g)) {
          const bytes = await readFile(path.join(devkit, file), "base64");
          tokens = tokens.replace(url, 'url("data:font/woff2;base64,' + bytes + '")');
        }
        return css.replace('@import "./tokens.css";', () => tokens);
      },
      transform(code, id) {
        if (id.endsWith("/packages/react/src/shared.tsx"))
          return code.replaceAll("./assets/", "../../../assets/");
      },
    },
    react(),
    viteSingleFile(),
  ],
  resolve: { alias: { "@siwc/react": path.join(devkit, "packages/react/src") } },
  optimizeDeps: { exclude: ["@siwc/react"] },
  build: { outDir: "../dist/hacker-news", emptyOutDir: false, reportCompressedSize: false, target: "es2022" },
});
