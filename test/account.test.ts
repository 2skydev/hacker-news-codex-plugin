import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { readTranslationStream } from "../server/account/account-inference.ts";
import type { AccountKeychain } from "../server/account/account-keychain.ts";
import { createAccountService, verifyIdentity } from "../server/account/account-service.ts";
import { accountStore } from "../server/account/account-store.ts";

const scope = "openid email offline_access resource.invoke chatgpt.tokens.use.direct";
const rows = [{ id: "1", text: "news" }];
const translations = [{ id: "1", text: "소식" }];
const events = (values: unknown[]) =>
  new Response(values.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join(""));
const success = () =>
  events([
    { type: "response.output_text.delta", delta: JSON.stringify({ translations }) },
    { type: "response.completed" },
  ]);
const json = (data: unknown, status = 200) => Response.json(data, { status });

function testKeychain(): AccountKeychain {
  const items = new Map<string, string>();
  return {
    async read(account) {
      return items.get(account);
    },
    async write(account, state) {
      items.set(account, state);
    },
  };
}

async function fixture(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), "hacker-news-account-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const store = accountStore(folder, testKeychain());
  const grant = {
    access_token: "test-access",
    refresh_token: "test-refresh",
    token_type: "bearer",
    id_token: "test.id",
    scope,
    expires_in: 3600,
  };
  let authorization: URL;
  let currentResponse: () => Response | Promise<Response> = success;
  let refresh = 0;
  let revoked: string | null | undefined;
  const api: { url: string; options: RequestInit }[] = [];

  const request = async (url: string, options: RequestInit) => {
    if (url.endsWith("/oauth/token")) {
      const form = options.body;
      assert.ok(form instanceof URLSearchParams);
      if (form.get("grant_type") === "refresh_token") {
        refresh++;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return json({ ...grant, access_token: "fresh" });
      }
      const verifier = form.get("code_verifier");
      assert.ok(verifier);
      assert.equal(
        createHash("sha256").update(verifier).digest("base64url"),
        authorization.searchParams.get("code_challenge"),
      );
      return json(grant);
    }
    if (url.endsWith("/revoke")) {
      assert.ok(options.body instanceof URLSearchParams);
      revoked = options.body.get("token");
      return new Response();
    }
    api.push({ url, options });
    if (url.endsWith("/models"))
      return json({
        models: [
          { visibility: "hide", slug: "hidden" },
          { visibility: "list", slug: "other" },
          { visibility: "list", slug: "gpt-6-luna" },
        ],
      });
    if (url.endsWith("/responses")) return currentResponse();
    throw new Error("Unexpected fixture URL");
  };
  let subject = "person";
  const verify: typeof verifyIdentity = async (token, _client, nonce) => {
    assert.equal(token, grant.id_token);
    if (nonce) assert.equal(nonce, authorization.searchParams.get("nonce"));
    return { subject, label: "test@example.com" };
  };
  const service = createAccountService({ store, request, verify });
  async function begin(options?: Parameters<typeof service.beginSignIn>[0]) {
    authorization = new URL((await service.beginSignIn(options)).url);
    const redirect = authorization.searchParams.get("redirect_uri");
    assert.ok(redirect);
    return new URL(redirect);
  }
  async function login(options?: Parameters<typeof service.beginSignIn>[0]) {
    const callback = await begin(options);
    if (options?.profileId)
      assert.equal(authorization.searchParams.get("client_id"), options.profileId);
    const state = authorization.searchParams.get("state");
    assert.ok(state);
    callback.search = new URLSearchParams({
      state,
      code: "abc",
      client_id: options?.newAccount ? "oaiapp_2" : (options?.profileId ?? "oaiapp_1"),
    }).toString();
    return fetch(callback);
  }
  return {
    service,
    begin,
    login,
    grant,
    store,
    folder,
    api,
    setSubject: (s: string) => {
      subject = s;
    },
    setResponse: (r: typeof currentResponse) => {
      currentResponse = r;
    },
    get revoked() {
      return revoked;
    },
    get refresh() {
      return refresh;
    },
  };
}

test("OAuth login, plan-approved model choice, stream and disconnect", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.service.accountStatus()).connected, false);
  assert.equal((await f.login()).status, 200);
  const safe = await f.service.accountStatus();
  assert.equal(safe.connected, true);
  assert.equal((await f.store.read()).profiles[0].tokens?.refresh, "test-refresh");
  assert.ok(!JSON.stringify(safe).includes("test-access"));
  await assert.rejects(stat(join(f.folder, "account/accounts.json")), { code: "ENOENT" });
  assert.deepEqual(await f.service.translateBatch(rows), translations);
  const body = JSON.parse(String(f.api[1].options.body));
  assert.equal(body.model, "gpt-6-luna");
  assert.deepEqual(body.reasoning, { effort: "low" });
  assert.equal(body.stream, true);
  assert.equal(body.store, false);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.schema.properties.translations.type, "array");
  assert.equal(new Headers(f.api[1].options.headers).get("Authorization"), "Bearer test-access");
  assert.equal((await f.service.signOut()).connected, false);
  assert.equal(f.revoked, "test-refresh");
  assert.equal((await f.store.read()).profiles[0].tokens, undefined);
  await assert.rejects(f.service.translateBatch(rows), { code: "disconnected" });
});

test("이전 계정 파일이 있어도 키체인의 연결 정보만 사용한다", async (t) => {
  const f = await fixture(t);
  const folder = join(f.folder, "account");
  await mkdir(folder);
  const previous = join(folder, "accounts.json");
  const contents = "legacy data";
  await writeFile(previous, contents);

  assert.equal((await f.service.accountStatus()).connected, false);
  assert.equal((await f.login()).status, 200);
  assert.equal((await f.service.accountStatus()).connected, true);
  assert.equal(await readFile(previous, "utf8"), contents);
});

test("프로필 사진이 있는 계정도 리더에 계정 이름만 표시용으로 전달한다", async (t) => {
  const picture = "https://profile-images.example.org/avatar.png";
  const f = await fixture(t);
  const { privateKey } = await generateKeyPair("RS256");
  f.grant.id_token = await new SignJWT({ sub: "person", picture })
    .setProtectedHeader({ alg: "RS256" })
    .sign(privateKey);
  assert.equal((await f.login()).status, 200);

  const status = await f.service.accountStatus();
  assert.equal(status.connected, true);
  assert.equal(status.label, "test@example.com");
  assert.equal(Object.hasOwn(status, "picture"), false);
  assert.ok(!JSON.stringify(status).includes(f.grant.id_token));
});

test("callback checks state and cancel prevents using pending registration", async (t) => {
  const f = await fixture(t);
  const callback = await f.begin();
  callback.search = "?state=fake&code=foo&client_id=foo";
  assert.equal((await fetch(callback)).status, 400);
  assert.equal((await f.service.accountStatus()).pending, true);
  await f.service.signOut();
  assert.equal((await f.service.accountStatus()).pending, false);
});

test("consent, returning identities and isolated registrations", async (t) => {
  const f = await fixture(t);
  f.grant.scope = "openid email";
  assert.equal((await f.login()).status, 400);
  assert.equal((await f.service.accountStatus()).connected, false);
  await assert.rejects(f.service.translateBatch(rows), { code: "disconnected" });
  f.setSubject("another");
  f.grant.scope = scope;
  assert.equal((await f.login()).status, 400);
  assert.equal((await f.login({ newAccount: true })).status, 200);
  assert.equal((await f.service.accountStatus()).profiles.length, 2);
});

test("연결 해제 후 신규 계정의 등록을 기존 계정과 분리한다", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.login()).status, 200);
  assert.equal((await f.service.signOut()).connected, false);
  assert.equal((await f.service.accountStatus()).profileId, "oaiapp_1");
  assert.equal((await f.login()).status, 200);
  assert.equal((await f.service.accountStatus()).profileId, "oaiapp_1");
  assert.equal((await f.service.signOut()).connected, false);

  f.setSubject("another");
  assert.equal((await f.login({ newAccount: true })).status, 200);
  const status = await f.service.accountStatus();
  assert.equal(status.connected, true);
  assert.equal(status.profileId, "oaiapp_2");
  assert.deepEqual(
    status.profiles.map(({ id }) => id),
    ["oaiapp_1", "oaiapp_2"],
  );

  assert.equal((await f.service.signOut()).connected, false);
  f.setSubject("person");
  assert.equal((await f.login({ profileId: "oaiapp_1" })).status, 200);
  assert.equal((await f.service.accountStatus()).profileId, "oaiapp_1");
});

test("refresh is serialized across workers", async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.store.exclusive(async (s, save) => {
    const { tokens } = s.profiles[0];
    assert.ok(tokens);
    tokens.expires = Date.now();
    await save(s);
  });
  await Promise.all([f.service.translateBatch(rows), f.service.translateBatch(rows)]);
  assert.equal(f.refresh, 1);
  assert.ok(
    f.api.every((r) => new Headers(r.options.headers).get("Authorization") === "Bearer fresh"),
  );
});

test("a stream can fail after sending deltas; incomplete and mismatched output are rejected", async (t) => {
  const f = await fixture(t);
  await f.login();
  f.setResponse(() =>
    events([
      { type: "response.output_text.delta", delta: "partial" },
      {
        type: "response.failed",
        response: { error: { code: "subscription_sharing_usage_limit_exceeded" } },
      },
    ]),
  );
  await assert.rejects(f.service.translateBatch(rows), { code: "limited" });
  assert.equal((await f.service.accountStatus()).connected, true);
  await assert.rejects(
    readTranslationStream(events([{ type: "response.output_text.delta", delta: "partial" }])),
  );
  await assert.rejects(
    readTranslationStream(
      events([{ type: "response.refusal.done" }, { type: "response.completed" }]),
    ),
    { code: "translation_error" },
  );
  f.setResponse(() =>
    events([
      {
        type: "response.output_text.delta",
        delta: '{"translations":[{"id":"wrong","text":"한글"}]}',
      },
      { type: "response.completed" },
    ]),
  );
  await assert.rejects(f.service.translateBatch(rows), { code: "translation_error" });
});

test("OpenID identity requires the issuer, intended audience, expiry, signature and nonce", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const { publicKey: otherKey } = await generateKeyPair("RS256");
  const sign = (issuer: string, expiry: string | number) =>
    new SignJWT({ sub: "subject", nonce: "challenge" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(issuer)
      .setAudience("our-registration")
      .setExpirationTime(expiry)
      .sign(privateKey);
  const valid = await sign("https://auth.openai.com", "1h");
  assert.equal(
    (await verifyIdentity(valid, "our-registration", "challenge", undefined, publicKey)).subject,
    "subject",
  );
  await assert.rejects(
    verifyIdentity(valid, "other-registration", "challenge", undefined, publicKey),
  );
  await assert.rejects(verifyIdentity(valid, "our-registration", "other", undefined, publicKey));
  await assert.rejects(verifyIdentity(valid, "our-registration", "challenge", undefined, otherKey));
  await assert.rejects(
    verifyIdentity(
      await sign("https://example.invalid", "1h"),
      "our-registration",
      "challenge",
      undefined,
      publicKey,
    ),
  );
  await assert.rejects(
    verifyIdentity(
      await sign("https://auth.openai.com", 10),
      "our-registration",
      "challenge",
      undefined,
      publicKey,
    ),
  );
});

test("rejected access pauses translation until reconnect and retains the session for revocation", async (t) => {
  const f = await fixture(t);
  await f.login();
  f.setResponse(() => json({}, 503));
  await assert.rejects(f.service.translateBatch(rows), { code: "translation_error" });
  assert.equal((await f.service.accountStatus()).connected, true);
  f.setResponse(() => json({}, 401));
  await assert.rejects(f.service.translateBatch(rows), { code: "disconnected" });
  assert.equal((await f.service.accountStatus()).connected, false);
  const calls = f.api.length;
  await assert.rejects(f.service.translateBatch(rows), { code: "disconnected" });
  assert.equal(f.api.length, calls);
  await f.service.signOut();
  assert.equal(f.revoked, "test-refresh");
  await f.login();
  assert.equal((await f.service.accountStatus()).connected, true);
  await f.store.exclusive(async (state, save) => {
    const { tokens } = state.profiles[0];
    assert.ok(tokens);
    delete tokens.refresh;
    tokens.expires = Date.now() - 1000;
    await save(state);
  });
  assert.equal((await f.service.accountStatus()).connected, false);
});

test("a delayed 401 cannot disconnect a concurrently refreshed access token", async (t) => {
  const f = await fixture(t);
  await f.login();
  f.setResponse(async () => {
    await f.store.exclusive(async (state, save) => {
      const { tokens } = state.profiles[0];
      assert.ok(tokens);
      tokens.access = "fresh";
      await save(state);
    });
    return json({}, 401);
  });
  await assert.rejects(f.service.translateBatch(rows), { code: "account_changed" });
  assert.equal((await f.service.accountStatus()).connected, true);
  f.setResponse(success);
  assert.deepEqual(await f.service.translateBatch(rows), translations);
  assert.equal(new Headers(f.api.at(-1)?.options.headers).get("Authorization"), "Bearer fresh");
});

test("모델 설정에는 계정이 제공하는 모델만 표시하고 선택한 모델로 번역한다", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.service.listModels(), []);
  await f.login();
  assert.deepEqual(await f.service.listModels(), ["other", "gpt-6-luna"]);
  await f.service.translateBatch(rows, "other");
  const body = JSON.parse(String(f.api.at(-1)?.options.body));
  assert.equal(body.model, "other");
  assert.equal(body.reasoning, undefined);
  await assert.rejects(f.service.translateBatch(rows, "hidden"), { code: "no_model" });
});
