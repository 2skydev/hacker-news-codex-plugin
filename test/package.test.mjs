import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("설치 패키지가 사이드바 화면과 로컬 도구를 제공한다", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "hn-reader-test-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const client = new Client({ name: "reader-test", version: "1.0.0" });
  const root = fileURLToPath(new URL("../dist/hacker-news/", import.meta.url));
  const { mcpServers } = JSON.parse(await readFile(join(root, "mcp.json"), "utf8"));
  const { command, args = [], cwd } = mcpServers["hacker-news"];
  // The desktop's portable plugin loader silently drops absolute commands.
  assert.equal(command, "./bin/start.sh");
  assert.equal(cwd, "${PLUGIN_ROOT}");
  const transport = new StdioClientTransport({
    command: resolve(root, command), args, cwd: root,
    env: { HN_DATA_DIR: dataDir, PATH: process.env.PATH }, stderr: "pipe",
  });
  await client.connect(transport);
  t.after(() => client.close());
  const { tools } = await client.listTools();
  const caps = client.getServerCapabilities().experimental["openai/settings"];
  assert.equal(caps.readTool, "hn_settings_read");
  const settings = await client.callTool({ name: caps.readTool, arguments: {} });
  assert.deepEqual(settings.structuredContent.values, { model: "자동", realtime: true, cacheField: "모든 번역", cachePeriod: "전체 기간" });
  const update = await client.callTool({ name: caps.updateTool, arguments: { set: { realtime: false } } });
  assert.equal(update.structuredContent.values.realtime, false);
  assert.equal(tools.find(tool => tool.name === "hn_clear_cache").annotations.destructiveHint, true);
  // Seed the temporary cache between host reads to verify the native settings actually change.
  const db = new DatabaseSync(join(dataDir, "translations.sqlite"));
  db.prepare("INSERT INTO translations (id,field,fingerprint,ko,saved_at) VALUES (1,'title','a','뉴스',?)").run(Date.now());
  db.close();
  const readSettings = async () => (await client.callTool({ name: caps.readTool, arguments: {} })).structuredContent;
  assert.ok((await readSettings()).layout.some(group => group.title === "번역 캐시 1개 (6 B)"));
  await client.callTool({ name: caps.updateTool, arguments: { set: { cacheField: "본문과 댓글" } } });
  const clear = async () => (await client.callTool({ name: "hn_clear_cache", arguments: {} })).structuredContent;
  assert.equal((await clear()).removed, 0);
  await client.callTool({ name: caps.updateTool, arguments: { set: { cacheField: "제목", cachePeriod: "최근 7일" } } });
  assert.equal((await clear()).removed, 1);
  assert.ok((await readSettings()).layout.some(group => group.title === "번역 캐시 0개 (0 B)"));
  const manifest = JSON.parse(await readFile(join(root, "plugin.json"), "utf8"));
  const setup = await readFile(join(root, manifest.extensions["com.openai"].onboardingSkill), "utf8");
  assert.match(setup, /name: setup/);
  const entry = tools.find(tool => tool.name === "open_reader");
  assert.deepEqual(entry._meta["openai/ui"].entrypoints, [{ type: "global" }]);
  assert.deepEqual(entry.icons.map(icon => icon.theme), ["light", "dark"]);
  assert.equal(entry.title, "Hacker News");
  for (const tool of ["hn_account", "hn_feed", "hn_watch", "hn_translate", "hn_story", "hn_connect", "hn_disconnect"]) {
    assert.deepEqual(tools.find(it => it.name === tool)._meta.ui.visibility, ["app"]);
  }
  const { contents } = await client.readResource({ uri: entry._meta.ui.resourceUri });
  assert.equal(contents[0].mimeType, "text/html;profile=mcp-app");
  assert.equal(contents[0]._meta["openai/ui"].preferredDisplayMode, "fullscreen");
  assert.match(contents[0].text, /lang="ko"/);
  assert.doesNotMatch(contents[0].text, /__APP_(?:JS|CSS)__/);
  assert.equal((await client.callTool({ name: "hn_account", arguments: {} })).structuredContent.connected, false);
  const login = await client.callTool({ name: "hn_connect", arguments: {} });
  const authorize = new URL(login.structuredContent.url);
  assert.equal(authorize.searchParams.get("agent_name_hint"), "Hacker News");
  assert.equal(authorize.origin, "https://auth.openai.com");
  assert.equal(authorize.searchParams.get("client_id"), "dynamic_agent_client");
  assert.ok(authorize.searchParams.get("scope").split(" ").includes("chatgpt.tokens.use.direct"));
  assert.equal((await client.callTool({ name: "hn_account", arguments: {} })).structuredContent.pending, true);
  await client.callTool({ name: "hn_disconnect", arguments: {} });
  assert.equal((await client.callTool({ name: "hn_account", arguments: {} })).structuredContent.pending, false);
  assert.ok((await client.callTool({ name: "hn_feed", arguments: { sort: "other" } })).isError);
});
