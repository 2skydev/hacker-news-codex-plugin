import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist/hacker-news");
await mkdir(output, { recursive: true });

const [template, css, app] = await Promise.all([
  readFile(path.join(root, "ui/index.html"), "utf8"),
  readFile(path.join(root, "ui/style.css"), "utf8"),
  build({
    absWorkingDir: root,
    entryPoints: ["ui/app.js"],
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    write: false,
  }),
]);
const html = template.replace("/*__APP_CSS__*/", () => css)
  .replace("/*__APP_JS__*/", () => app.outputFiles[0].text.replace(/<\/script/gi, "<\\/script"));
await Promise.all([
  writeFile(path.join(output, "reader.html"), html),
  cp(path.join(root, "skills"), path.join(output, "skills"), { recursive: true }),
  cp(path.join(root, "bin"), path.join(output, "bin"), { recursive: true }),
  cp(path.join(root, "assets"), path.join(output, "assets"), { recursive: true }),
  cp(path.join(root, "plugin.json"), path.join(output, "plugin.json")),
  cp(path.join(root, "mcp.json"), path.join(output, "mcp.json")),
  build({
    absWorkingDir: root,
    entryPoints: ["server/reader.mjs"],
    outfile: path.join(output, "server.mjs"),
    platform: "node",
    target: "node24",
    format: "esm",
    bundle: true,
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  }),
]);
