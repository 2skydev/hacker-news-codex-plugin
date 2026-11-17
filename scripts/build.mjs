import { cp, mkdir, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { build as buildReader } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist/hacker-news");
const devkit = path.dirname(fileURLToPath(import.meta.resolve("sign-in-with-chatgpt/package.json")));
await mkdir(output, { recursive: true });

await buildReader({ configFile: path.join(root, "vite.config.mjs") });
await rename(path.join(output, "index.html"), path.join(output, "reader.html"));

const notices = path.join(output, "licenses");
await mkdir(notices, { recursive: true });
await Promise.all([
  ...["LICENSE", "THIRD_PARTY_NOTICES.md", "assets/fonts/inter-OFL.txt", "assets/fonts/open-sans-OFL.txt"].map(file =>
    cp(path.join(devkit, file), path.join(notices, path.basename(file)))),
  ...["react", "react-dom", "scheduler", "openai"].map(pkg =>
    cp(path.join(root, "node_modules", pkg, "LICENSE"), path.join(notices, pkg + "-LICENSE"))),
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
