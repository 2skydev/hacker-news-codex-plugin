import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { PLUGIN_INFO } from "../../shared/constants/plugin.constants.ts";
import { registerReaderTools } from "../reader-tools.ts";
import {
  APP_VISIBILITY,
  READER_MIME_TYPE,
  READER_URI,
  READER_VIEW_META,
} from "./reader.constants.ts";

const html = await readFile(new URL("./reader.html", import.meta.url), "utf8");
const icons = await Promise.all(
  (["light", "dark"] as const).map(async (theme) => {
    const asset = theme === "dark" ? "news-dark.svg" : "news.svg";
    const image = await readFile(new URL(`./assets/${asset}`, import.meta.url), "base64");
    return {
      src: `data:image/svg+xml;base64,${image}`,
      mimeType: "image/svg+xml",
      sizes: ["any"],
      theme,
    };
  }),
);

serveStdio(() => {
  const server = new McpServer({ ...PLUGIN_INFO, title: "Hacker News", icons });
  server.registerResource(
    "Hacker News",
    READER_URI,
    { mimeType: READER_MIME_TYPE, _meta: READER_VIEW_META },
    async () => ({
      contents: [
        { uri: READER_URI, mimeType: READER_MIME_TYPE, text: html, _meta: READER_VIEW_META },
      ],
    }),
  );
  server.registerTool(
    "open_reader",
    {
      title: "Hacker News",
      description: "한국어 Hacker News 피드를 엽니다.",
      inputSchema: z.object({}),
      icons,
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { ...APP_VISIBILITY, resourceUri: READER_URI },
        "openai/ui": { entrypoints: [{ type: "global" }] },
      },
    },
    async () => ({ content: [], structuredContent: {} }),
  );

  registerReaderTools((name, title, schema, readOnly, run, outputSchema, describe) => {
    server.registerTool(
      name,
      {
        title,
        inputSchema: z.object(schema),
        outputSchema,
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: name === "hn_disconnect" || name === "hn_clear_cache",
        },
        _meta: { ui: APP_VISIBILITY },
      },
      async (args) => {
        const data = await run(args);
        return {
          content: describe ? [{ type: "text", text: describe(data) }] : [],
          structuredContent: { ...data },
        };
      },
    );
  });
  return server;
});
