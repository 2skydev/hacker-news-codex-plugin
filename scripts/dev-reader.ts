import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import type { Plugin } from "vite";

export function devReader(): Plugin {
  return {
    name: "standalone-reader",
    apply: "serve",
    async configureServer(server) {
      const client = new Client({ name: "hacker-news-dev", version: "1" });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(new URL("../dist/hacker-news/server.mjs", import.meta.url))],
        env: process.env.HN_DATA_DIR ? { HN_DATA_DIR: process.env.HN_DATA_DIR } : undefined,
      });
      await client.connect(transport);
      server.httpServer?.once("close", () => client.close());

      server.middlewares.use("/__reader", async (req, res) => {
        const host = req.headers.host;
        if (
          req.method !== "POST" ||
          !/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host ?? "") ||
          req.headers.origin !== `http://${host}` ||
          req.headers["content-type"] !== "application/json"
        ) {
          res.writeHead(403).end();
          return;
        }
        const controller = new AbortController();
        res.once("close", () => controller.abort());
        try {
          let body = "";
          req.setEncoding("utf8");
          for await (const chunk of req) {
            body += chunk;
            if (body.length > 128000) {
              res.writeHead(413).end();
              return;
            }
          }
          const { name, args }: { name?: unknown; args?: Record<string, unknown> } =
            JSON.parse(body);
          if (typeof name !== "string" || !name.startsWith("hn_")) {
            res.writeHead(400).end();
            return;
          }
          const result = await client.callTool({ name, arguments: args }, undefined, {
            signal: controller.signal,
            timeout: 180000,
          });
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(result));
        } catch {
          if (!res.destroyed) res.writeHead(400).end();
        }
      });
    },
  };
}
