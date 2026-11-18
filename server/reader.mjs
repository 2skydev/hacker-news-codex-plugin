import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { accountStatus, beginSignIn, listModels, signOut } from "./account.mjs";
import { feed, service, story, translate, watch } from "./news.mjs";

const version = "0.3.9";
const uri = "ui://hacker-news/reader-v1";
const mimeType = "text/html;profile=mcp-app";
const html = await readFile(new URL("./reader.html", import.meta.url), "utf8");
const icons = await Promise.all(["light", "dark"].map(async theme => {
  const asset = theme === "dark" ? "news-dark.svg" : "news.svg";
  const image = await readFile(new URL("./assets/" + asset, import.meta.url), "base64");
  return { src: "data:image/svg+xml;base64," + image, mimeType: "image/svg+xml", sizes: ["any"], theme };
}));
const fields = { "모든 번역": "all", "제목": "title", "본문과 댓글": "text" };
const periods = { "전체 기간": 0, "최근 24시간": 1, "최근 7일": 7, "최근 30일": 30, "24시간보다 오래됨": -1, "7일보다 오래됨": -7, "30일보다 오래됨": -30 };
const settingsValues = z.object({
  model: z.string().min(1), realtime: z.boolean(), cacheField: z.enum(Object.keys(fields)), cachePeriod: z.enum(Object.keys(periods)),
});
function cacheSize({ count, bytes }) {
  const [scale, unit] = bytes >= 1048576 ? [1048576, "MB"] : bytes >= 1024 ? [1024, "KB"] : [1, "B"];
  return count.toLocaleString("ko") + "개 (" + Number((bytes / scale).toFixed(1)).toLocaleString("ko") + " " + unit + ")";
}
const viewMeta = {
  ui: { csp: { connectDomains: [], resourceDomains: [] } },
  "openai/ui": { preferredDisplayMode: "fullscreen", availableDisplayModes: ["fullscreen"] },
};
const uiOnly = { visibility: ["app"] };
const id = z.int().positive();
const page = {
  offset: z.int().nonnegative().optional(),
  limit: z.int().positive().max(50).optional(),
};

serveStdio(() => {
  const server = new McpServer({ name: "hacker-news", title: "Hacker News", version, icons });
  server.registerResource("Hacker News", uri, { mimeType, _meta: viewMeta }, async () => {
    const { picture } = await accountStatus().catch(() => ({}));
    const resourceDomains = ["https://lh3.googleusercontent.com", "https://cdn.openai.com"];
    if (picture) resourceDomains.push(new URL(picture).origin);
    const meta = { ...viewMeta, ui: { csp: { connectDomains: [], resourceDomains: [...new Set(resourceDomains)] } } };
    return { contents: [{ uri, mimeType, text: html, _meta: meta }] };
  });
  server.registerTool("open_reader", {
    title: "Hacker News",
    description: "한국어 Hacker News 피드를 엽니다.",
    inputSchema: z.object({}),
    icons,
    annotations: { readOnlyHint: true },
    _meta: {
      ui: { ...uiOnly, resourceUri: uri },
      "openai/ui": { entrypoints: [{ type: "global" }] },
    },
  }, async () => ({ content: [], structuredContent: {} }));

  function tool(name, title, schema, readOnly, run, outputSchema) {
    server.registerTool(name, {
      title,
      inputSchema: z.object(schema), outputSchema,
      annotations: { readOnlyHint: readOnly, destructiveHint: ["hn_disconnect", "hn_clear_cache"].includes(name) },
      _meta: { ui: uiOnly },
    }, async (args) => {
      const data = await run(args);
      return { content: [], structuredContent: data };
    });
  }
  tool("hn_feed", "피드 읽기", { sort: z.enum(["top", "new"]), ...page }, true, feed);
  tool("hn_preview", "저장된 번역 먼저 읽기", {
    sort: z.enum(["top", "new"]).optional(), id: id.optional(), offset: page.offset, limit: z.int().positive().max(50),
    titles: z.array(z.object({ id, title: z.string().max(2000) })).max(20).optional(),
  }, true, args => service().preview(args));
  tool("hn_watch", "새 글 기다리기", {
    sort: z.enum(["top", "new"]), revision: z.string().regex(/^[0-9a-f]{64}$/),
  }, true, watch);
  tool("hn_story", "글과 댓글 읽기", { id, ...page }, true, story);
  tool("hn_translate", "ChatGPT 구독으로 번역", {
    ids: z.array(id).min(1).max(50),
    field: z.enum(["title", "text"]),
  }, false, translate);
  tool("hn_account", "ChatGPT 연결 상태", {}, true, accountStatus);
  tool("hn_connect", "ChatGPT 연결", {}, false, beginSignIn);
  tool("hn_disconnect", "ChatGPT 연결 해제", {}, false, signOut);
  const preferences = () => service().preferences;
  tool("hn_preferences", "리더 설정 읽기", {}, true, () => preferences().values());
  server.registerTool("hn_clear_cache", {
    title: "선택한 캐시 비우기", inputSchema: settingsValues.pick({ cacheField: true, cachePeriod: true }), annotations: { readOnlyHint: false, destructiveHint: true },
    _meta: { ui: uiOnly },
  }, async ({ cacheField, cachePeriod }) => {
    const db = preferences();
    const result = db.clear(fields[cacheField], periods[cachePeriod], Date.now());
    return { content: [{ type: "text", text: result.removed + "개 삭제했습니다. 남은 번역 " + cacheSize(result) }], structuredContent: result };
  });

  tool("hn_settings_read", "Hacker News 설정", {}, true, async () => {
    const values = preferences().values();
    let models = [], modelError = "";
    try { models = await listModels(); }
    catch { modelError = "모델 목록을 가져오지 못했습니다. 설정을 다시 열어 주세요."; }
    return {
      values, models: [...new Set(["자동", ...models, values.model])], modelError,
      cacheFields: Object.keys(fields), cachePeriods: Object.keys(periods), cacheSize: cacheSize(preferences().stats()),
    };
  });
  tool("hn_settings_update", "Hacker News 설정 저장", {
    set: settingsValues.partial().strict().refine(values => Object.keys(values).length > 0),
  }, false, async ({ set }) => {
    if (set.model && set.model !== "자동" && !(await listModels()).includes(set.model))
      throw new Error("연결한 계정에서 사용할 수 있는 모델을 선택해 주세요.");
    preferences().update(set);
    return { values: preferences().values() };
  }, z.object({ values: settingsValues }));
  return server;
});
