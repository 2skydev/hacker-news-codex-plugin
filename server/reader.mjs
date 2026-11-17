import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { accountStatus, beginSignIn, listModels, signOut } from "./account.mjs";
import { feed, service, story, translate, watch } from "./news.mjs";

const version = "0.3.7";
const uri = "ui://hacker-news/reader-v1";
const mimeType = "text/html;profile=mcp-app";
const html = await readFile(new URL("./reader.html", import.meta.url), "utf8");
const icons = await Promise.all(["light", "dark"].map(async theme => {
  const asset = theme === "dark" ? "news-dark.svg" : "news.svg";
  const image = await readFile(new URL("./assets/" + asset, import.meta.url), "base64");
  return { src: "data:image/svg+xml;base64," + image, mimeType: "image/svg+xml", sizes: ["any"], theme };
}));
const settingsCapability = { readTool: "hn_settings_read", updateTool: "hn_settings_update" };
const fields = { "모든 번역": "all", "제목": "title", "본문과 댓글": "text" };
const periods = { "전체 기간": 0, "최근 24시간": 1, "최근 7일": 7, "최근 30일": 30 };
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
  const server = new McpServer({ name: "hacker-news", title: "Hacker News", version, icons }, {
    capabilities: { experimental: { "openai/settings": settingsCapability }, extensions: { "openai/settings": settingsCapability } },
  });
  server.registerResource("Hacker News", uri, { mimeType, _meta: viewMeta }, async () => ({
    contents: [{ uri, mimeType, text: html, _meta: viewMeta }],
  }));
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
  tool("hn_account", "ChatGPT 연결 상태", {}, true, async () => {
    const { connected, pending, model, error } = await accountStatus();
    return { connected, pending, model, error };
  });
  tool("hn_connect", "ChatGPT 연결", {}, false, () => beginSignIn());
  tool("hn_disconnect", "ChatGPT 연결 해제", {}, false, async () => {
    const result = await signOut();
    return { connected: false, ...(result?.error ? { warning: result.error } : {}) };
  });
  const preferences = () => service().preferences;
  tool("hn_preferences", "리더 설정 읽기", {}, true, () => preferences().values());
  server.registerTool("hn_clear_cache", {
    title: "선택한 캐시 비우기", inputSchema: z.object({}), annotations: { readOnlyHint: false, destructiveHint: true },
    _meta: { ui: uiOnly },
  }, async () => {
    const db = preferences();
    const { cacheField, cachePeriod } = db.values();
    const result = db.clear(fields[cacheField], periods[cachePeriod], Date.now());
    return { content: [{ type: "text", text: result.removed + "개 삭제했습니다. 남은 번역 " + cacheSize(result) }], structuredContent: result };
  });

  tool("hn_settings_read", "Hacker News 설정", {}, true, async () => {
    const values = preferences().values();
    let models = [], modelError = "";
    try { models = await listModels(); }
    catch { modelError = "모델 목록을 가져오지 못했습니다. 설정을 다시 열어 주세요."; }
    const account = await accountStatus();
    const choices = [...new Set(["자동", ...models, values.model])];
    return {
      schema: { type: "object", properties: {
        model: { type: "string", title: "번역 모델", enum: choices,
          description: modelError || (models.length ? "새 번역부터 적용합니다." : "ChatGPT를 연결하면 사용할 모델을 선택할 수 있습니다.") },
        realtime: { type: "boolean", title: "실시간 갱신", description: "끄면 새 글과 순위 변경 안내를 눌러 반영합니다." },
        cacheField: { type: "string", title: "삭제 대상", enum: Object.keys(fields) },
        cachePeriod: { type: "string", title: "저장 기간", enum: Object.keys(periods) },
      } },
      values,
      layout: [{ kind: "group", title: "리더 설정", items: [
        { kind: "property", property: "model" }, { kind: "property", property: "realtime" },
      ] }, { kind: "group", title: "번역 캐시 " + cacheSize(preferences().stats()), items: [
        { kind: "property", property: "cacheField" }, { kind: "property", property: "cachePeriod" },
        { kind: "tool", tool: "hn_clear_cache" },
      ] }, { kind: "group", title: account.connected ? "ChatGPT 연결됨" : "ChatGPT 계정", items: [
        account.connected || account.pending
          ? { kind: "tool", tool: "hn_disconnect", description: "플랜 연결을 해제하거나 로그인을 취소합니다." }
          : { kind: "tool", tool: "open_reader", description: "리더에서 ChatGPT로 계속하기를 눌러 연결합니다." },
      ] }],
    };
  }, z.object({ schema: z.record(z.string(), z.unknown()), values: settingsValues, layout: z.array(z.record(z.string(), z.unknown())) }));
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
