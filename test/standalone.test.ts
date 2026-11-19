import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import {
  accountKeychain,
  keychainAccount,
  keychainService,
} from "../server/account/account-keychain.ts";
import { READER_API_PATH } from "../shared/constants/reader.constants.ts";

test("독립 실행 빌드가 로컬 브라우저에 화면과 리더 API를 제공한다", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "hn-standalone-test-"));
  const app = join(directory, "app");
  const dataDir = join(await realpath(directory), "data");
  const keychainId = keychainAccount(join(dataDir, "account"));
  await cp(new URL("../dist/standalone/", import.meta.url), app, { recursive: true });
  const child = spawn(process.execPath, [join(app, "server.mjs")], {
    env: { HN_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const exit = once(child, "close");
  t.after(async () => {
    child.kill();
    await exit;
    await rm(directory, { recursive: true, force: true });
    if (await accountKeychain.read(keychainId))
      execFileSync(
        "/usr/bin/security",
        ["delete-generic-password", "-s", keychainService, "-a", keychainId],
        { stdio: "ignore" },
      );
  });

  const output = createInterface({ input: child.stdout });
  const [origin] = await Promise.race([
    once(output, "line", { signal: AbortSignal.timeout(10_000) }),
    exit.then(([code]) => assert.fail(`독립 실행 서버가 종료되었습니다. 종료 코드 ${code}`)),
  ]);
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);

  const home = await fetch(origin);
  assert.equal(home.status, 200);
  assert.equal(home.headers.get("x-frame-options"), "DENY");
  assert.match(await home.text(), /id="root"/);

  const endpoint = new URL(READER_API_PATH, origin);
  const call = (name: string, args?: object, requestOrigin = origin) =>
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: requestOrigin },
      body: JSON.stringify({ name, args }),
    });

  const account = await call("hn_account");
  assert.equal(account.status, 200);
  assert.equal((await account.json()).structuredContent.connected, false);
  assert.equal((await call("open_reader")).status, 400);
  assert.equal((await call("hn_feed", { sort: "other" })).status, 400);

  const change = { set: { realtime: false } };
  assert.equal((await call("hn_settings_update", change, "https://example.invalid")).status, 403);
  assert.equal((await (await call("hn_preferences")).json()).structuredContent.realtime, true);
  assert.equal((await call("hn_settings_update", change)).status, 200);
  assert.equal((await (await call("hn_preferences")).json()).structuredContent.realtime, false);

  const login = await (await call("hn_connect")).json();
  const authorize = new URL(login.structuredContent.url);
  assert.equal(authorize.origin, "https://auth.openai.com");
  assert.match(authorize.searchParams.get("redirect_uri") ?? "", /^http:\/\/127\.0\.0\.1:\d+\//);
  assert.equal((await (await call("hn_account")).json()).structuredContent.pending, true);
  assert.equal((await (await call("hn_disconnect")).json()).structuredContent.pending, false);
});
