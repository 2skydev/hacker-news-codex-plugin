import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
  accountKeychain,
  keychainAccount,
  keychainService,
} from "../server/account/account-keychain.ts";
import type { Tools } from "../shared/types/reader.types.ts";

interface ReaderToolMeta {
  ui?: { visibility?: string[]; resourceUri?: string; csp?: { resourceDomains?: string[] } };
  "openai/ui"?: { entrypoints?: { type: string }[] };
}

test("설치 패키지가 사이드바 화면과 로컬 도구를 제공한다", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "hn-reader-test-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const account = keychainAccount(join(await realpath(dataDir), "account"));
  t.after(async () => {
    if (await accountKeychain.read(account))
      execFileSync(
        "/usr/bin/security",
        ["delete-generic-password", "-s", keychainService, "-a", account],
        { stdio: "ignore" },
      );
  });
  const client = new Client({ name: "reader-test", version: "1.0.0" });
  const root = fileURLToPath(new URL("../dist/hacker-news/", import.meta.url));
  const { mcpServers } = JSON.parse(await readFile(join(root, "mcp.json"), "utf8"));
  const { command, args = [], cwd } = mcpServers["hacker-news"];
  // The desktop's portable plugin loader silently drops absolute commands.
  assert.equal(command, "./bin/start.sh");
  // biome-ignore lint/suspicious/noTemplateCurlyInString: The desktop loader expands this manifest placeholder.
  assert.equal(cwd, "${PLUGIN_ROOT}");
  const transport = new StdioClientTransport({
    command: resolve(root, command),
    args,
    cwd: root,
    env: { HN_DATA_DIR: dataDir, ...(process.env.PATH && { PATH: process.env.PATH }) },
    stderr: "pipe",
  });
  await client.connect(transport);
  t.after(() => client.close());
  async function callTool<Name extends keyof Tools>(name: Name, args?: Tools[Name][0]) {
    const result = await client.callTool({ name, arguments: args ?? {} });
    assert.ok(!result.isError);
    return result.structuredContent as Tools[Name][1];
  }

  const { tools } = await client.listTools();
  assert.equal(client.getServerCapabilities()?.experimental?.["openai/settings"], undefined);
  assert.equal(client.getServerCapabilities()?.extensions?.["openai/settings"], undefined);
  const settings = await callTool("hn_settings_read");
  assert.deepEqual(settings.values, {
    model: "자동",
    realtime: true,
    cacheField: "모든 번역",
    cachePeriod: "전체 기간",
    cacheAutoDelete: true,
    cacheRetentionDays: 7,
  });
  const update = await callTool("hn_settings_update", { set: { realtime: false } });
  assert.equal(update.values.realtime, false);
  assert.equal(
    tools.find((tool) => tool.name === "hn_clear_cache")?.annotations?.destructiveHint,
    true,
  );
  // Seed the temporary cache between host reads to verify the reader settings reflect changes.
  const db = new DatabaseSync(join(dataDir, "translations.sqlite"));
  db.prepare(
    "INSERT INTO translations (id,field,fingerprint,ko,saved_at) VALUES (1,'title','a','뉴스',?)",
  ).run(Date.now());
  db.close();
  const readSettings = () => callTool("hn_settings_read");
  assert.deepEqual((await readSettings()).cache, { count: 1, bytes: 6 });
  await callTool("hn_settings_update", { set: { cacheField: "본문과 댓글" } });
  const clear = async () => {
    const { cacheField, cachePeriod } = (await readSettings()).values;
    return callTool("hn_clear_cache", { cacheField, cachePeriod });
  };
  assert.deepEqual(await clear(), { removed: 0, count: 1, bytes: 6 });
  await callTool("hn_settings_update", { set: { cacheField: "제목", cachePeriod: "최근 7일" } });
  assert.deepEqual(await clear(), { removed: 1, count: 0, bytes: 0 });
  assert.deepEqual((await readSettings()).cache, { count: 0, bytes: 0 });

  await callTool("hn_settings_update", { set: { cacheAutoDelete: false, cacheRetentionDays: 3 } });
  const oldCache = new DatabaseSync(join(dataDir, "translations.sqlite"));
  oldCache
    .prepare(
      "INSERT INTO translations (id,field,fingerprint,ko,saved_at) VALUES (2,'text','b','댓글',?)",
    )
    .run(Date.now() - 4 * 86400000);
  oldCache.close();
  assert.deepEqual((await readSettings()).cache, { count: 1, bytes: 6 });
  const enabled = await callTool("hn_settings_update", { set: { cacheAutoDelete: true } });
  assert.equal(enabled.values.cacheRetentionDays, 3);
  assert.deepEqual(enabled.cache, { count: 0, bytes: 0 });
  const invalid = await client.callTool({
    name: "hn_settings_update",
    arguments: { set: { cacheRetentionDays: 4 } },
  });
  assert.equal(invalid.isError, true);
  const manifest = JSON.parse(await readFile(join(root, "plugin.json"), "utf8"));
  const setup = await readFile(
    join(root, manifest.extensions["com.openai"].onboardingSkill),
    "utf8",
  );
  assert.match(setup, /name: setup/);
  const entry = tools.find((tool) => tool.name === "open_reader");
  assert.ok(entry);
  const entryMeta = entry._meta as ReaderToolMeta | undefined;
  assert.deepEqual(entryMeta?.["openai/ui"]?.entrypoints, [{ type: "global" }]);
  assert.deepEqual(
    entry.icons?.map((icon) => icon.theme),
    ["light", "dark"],
  );
  assert.equal(entry.title, "Hacker News");
  for (const tool of [
    "hn_account",
    "hn_feed",
    "hn_watch",
    "hn_translate",
    "hn_story",
    "hn_connect",
    "hn_disconnect",
    "hn_settings_read",
    "hn_settings_update",
    "hn_clear_cache",
  ]) {
    const meta = tools.find((it) => it.name === tool)?._meta as ReaderToolMeta | undefined;
    assert.deepEqual(meta?.ui?.visibility, ["app"]);
  }
  const uri = entryMeta?.ui?.resourceUri;
  assert.ok(uri);
  const {
    contents: [resource],
  } = await client.readResource({ uri });
  assert.ok(resource && "text" in resource);
  assert.equal(resource.mimeType, "text/html;profile=mcp-app");
  const viewMeta = resource._meta?.["openai/ui"] as { preferredDisplayMode?: string } | undefined;
  assert.equal(viewMeta?.preferredDisplayMode, "fullscreen");
  assert.deepEqual((resource._meta as ReaderToolMeta).ui?.csp?.resourceDomains ?? [], []);
  assert.match(resource.text, /open-settings/);
  assert.match(resource.text, /id="root"/);
  assert.doesNotMatch(resource.text, /url\(["']?\.\/assets\//);
  assert.doesNotMatch(resource.text, /<script[^>]+\bsrc=|<link[^>]+rel="stylesheet"/);
  assert.doesNotMatch(resource.text, /id="notice"|id="message"|id="chatgpt-logo"/);
  assert.doesNotMatch(resource.text, /__APP_(?:JS|CSS)__/);
  assert.equal((await callTool("hn_account")).connected, false);
  const login = await callTool("hn_connect");
  const authorize = new URL(login.url);
  assert.equal(authorize.searchParams.get("agent_name_hint"), "Hacker News");
  assert.equal(authorize.origin, "https://auth.openai.com");
  assert.equal(authorize.searchParams.get("client_id"), "dynamic_agent_client");
  assert.ok(authorize.searchParams.get("scope")?.split(" ").includes("chatgpt.tokens.use.direct"));
  assert.equal((await callTool("hn_account")).pending, true);
  await callTool("hn_disconnect");
  assert.equal((await callTool("hn_account")).pending, false);
  const addAccount = new URL((await callTool("hn_connect", { newAccount: true })).url);
  assert.equal(addAccount.searchParams.get("client_id"), "dynamic_agent_client");
  await callTool("hn_disconnect");
  assert.ok((await client.callTool({ name: "hn_feed", arguments: { sort: "other" } })).isError);
});
