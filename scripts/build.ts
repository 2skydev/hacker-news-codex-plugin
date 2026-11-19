import { cp, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { build as buildReader } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const standalone = process.argv.includes("--standalone");
const output = path.join(root, "dist", standalone ? "standalone" : "hacker-news");
await mkdir(output, { recursive: true });

await Promise.all([
  buildReader({
    configFile: path.join(root, "vite.config.ts"),
    mode: standalone ? "standalone" : "production",
    build: { outDir: output },
  }),
  build({
    absWorkingDir: root,
    entryPoints: [standalone ? "server/http/local-reader.ts" : "server/mcp/reader.ts"],
    outfile: path.join(output, "server.mjs"),
    platform: "node",
    target: "node24",
    format: "esm",
    bundle: true,
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    },
  }),
]);

if (!standalone) {
  await rename(path.join(output, "index.html"), path.join(output, "reader.html"));
  await packagePlugin();
}

async function packagePlugin() {
  const notices = path.join(output, "licenses");
  await mkdir(notices, { recursive: true });
  await Promise.all([
    ...[
      "react",
      "react-dom",
      "scheduler",
      "@base-ui/react",
      "@base-ui/utils",
      "class-variance-authority",
      "cn",
      "esm-env",
      "lucide-react",
      "tailwindcss",
      "tw-animate-css",
    ].map((pkg) =>
      cp(
        path.join(root, "node_modules", pkg, "LICENSE"),
        path.join(notices, `${pkg.replace("/", "-")}-LICENSE`),
      ),
    ),
    ...Object.entries({
      "@number-flow/react": "LICENSE.md",
      "number-flow": "LICENSE.md",
      sonner: "LICENSE.md",
      "next-themes": "license.md",
      shadcn: "LICENSE.md",
      clsx: "license",
    }).map(([pkg, file]) =>
      cp(
        path.join(root, "node_modules", pkg, file),
        path.join(notices, `${pkg.replace("/", "-")}-LICENSE`),
      ),
    ),
    cp(path.join(root, "skills"), path.join(output, "skills"), { recursive: true }),
    cp(path.join(root, "bin"), path.join(output, "bin"), { recursive: true }),
    cp(path.join(root, "assets"), path.join(output, "assets"), { recursive: true }),
    cp(path.join(root, "plugin.json"), path.join(output, "plugin.json")),
    cp(path.join(root, "mcp.json"), path.join(output, "mcp.json")),
  ]);
}
