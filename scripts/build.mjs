import { cp, mkdir, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { build as buildReader } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist/hacker-news");
await mkdir(output, { recursive: true });

await buildReader({ configFile: path.join(root, "vite.config.mjs") });
await rename(path.join(output, "index.html"), path.join(output, "reader.html"));

const notices = path.join(output, "licenses");
await mkdir(notices, { recursive: true });
await Promise.all([
  ...["react", "react-dom", "scheduler", "@base-ui/react", "@base-ui/utils", "class-variance-authority", "cn", "lucide-react", "tailwindcss", "tw-animate-css"].map(pkg =>
    cp(path.join(root, "node_modules", pkg, "LICENSE"), path.join(notices, pkg.replace("/", "-") + "-LICENSE"))),
  ...Object.entries({ sonner: "LICENSE.md", "next-themes": "license.md", shadcn: "LICENSE.md", clsx: "license" }).map(([pkg, file]) =>
    cp(path.join(root, "node_modules", pkg, file), path.join(notices, pkg + "-LICENSE"))),
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
