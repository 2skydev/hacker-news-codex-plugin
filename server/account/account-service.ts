import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  createRemoteJWKSet,
  decodeJwt,
  type JWTVerifyGetKey,
  jwtVerify,
  type KeyInput,
} from "jose";
import { AUTO_MODEL } from "../../shared/constants/settings.constants.ts";
import type { Account, AccountSignIn } from "../../shared/types/reader.types.ts";
import {
  issuer,
  lunaModel,
  resource,
  scope,
  sharing,
  terminalGrants,
  tokenUrl,
} from "./account.constants.ts";
import type { TranslationEntry } from "./account-inference.ts";
import { checkResponse, issue, translateTitles } from "./account-inference.ts";
import { readAccountPicture } from "./account-picture.ts";
import type { AccountProfile, AccountState, AccountTokens } from "./account-store.ts";
import { accountStore } from "./account-store.ts";

interface SignInAttempt {
  state: string;
  nonce: string;
  verifier: string;
  revision?: number;
  profile?: AccountProfile;
  server?: Server;
  timer?: NodeJS.Timeout;
  redirect?: string;
  url?: string;
  consumed?: boolean;
}

interface ModelCatalog {
  clientId: string;
  model: string;
  models: string[];
  expires: number;
}

interface Grant {
  token: string;
  clientId: string;
  revision: number;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  earliest_refresh_at?: number | string;
  token_type?: string;
  scope?: string;
  error?: string | { code?: string };
}

type AccountRequest = (url: string, options: RequestInit) => Promise<Response>;

const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const disconnected = () =>
  issue("disconnected", "ChatGPT 계정에 연결하고 플랜 사용을 허용해 주세요.");
const changed = () =>
  issue("account_changed", "ChatGPT 계정이 변경되었습니다. 다시 시도해 주세요.");
const failedLogin = () =>
  issue("sign_in_failed", "ChatGPT 로그인을 완료하지 못했습니다. 다시 시도해 주세요.");
const secret = () => randomBytes(32).toString("base64url");
const active = (data: AccountState) => data.profiles.find((p) => p.clientId === data.active);
function canTranslate(tokens?: AccountTokens): tokens is AccountTokens & { access: string } {
  return Boolean(
    tokens?.access &&
      tokens.scopes.includes(sharing) &&
      (tokens.expires > Date.now() || tokens.refresh),
  );
}

function accountPicture(profile?: AccountProfile) {
  if (!profile || !canTranslate(profile.tokens) || !profile.tokens.id) return;
  let claims: ReturnType<typeof decodeJwt>;
  try {
    claims = decodeJwt(profile.tokens.id);
  } catch {
    return;
  }
  if (claims.sub !== profile.subject || typeof claims.picture !== "string") return;
  const url = URL.parse(claims.picture);
  if (url?.protocol === "https:" && !url.username && !url.password) return url.href;
}

export async function verifyIdentity(
  token: string,
  clientId: string,
  nonce?: string,
  date?: Date,
  verificationKey: KeyInput | JWTVerifyGetKey = jwks,
) {
  const { payload } = await jwtVerify(token, verificationKey, {
    issuer,
    audience: clientId,
    algorithms: ["RS256"],
    currentDate: date,
    requiredClaims: ["sub", "exp"],
  });
  if (
    typeof payload.sub !== "string" ||
    !payload.sub ||
    (nonce && payload.nonce !== nonce) ||
    (payload.azp && payload.azp !== clientId) ||
    (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)
  )
    throw failedLogin();
  return {
    subject: payload.sub,
    label: typeof payload.email === "string" ? payload.email : "ChatGPT 계정",
  };
}

function packTokens(
  reply: TokenResponse,
  previous: Partial<AccountTokens> = {},
  now = Date.now(),
): AccountTokens {
  if (
    typeof reply.access_token !== "string" ||
    !reply.access_token ||
    (previous.refresh && (typeof reply.refresh_token !== "string" || !reply.refresh_token)) ||
    typeof reply.expires_in !== "number" ||
    !Number.isFinite(reply.expires_in) ||
    reply.expires_in <= 0 ||
    (reply.token_type ?? "").toLowerCase() !== "bearer"
  )
    throw failedLogin();
  const earliest =
    typeof reply.earliest_refresh_at === "number"
      ? reply.earliest_refresh_at * 1000
      : Date.parse(reply.earliest_refresh_at ?? "");
  return {
    access: reply.access_token,
    refresh: reply.refresh_token ?? previous.refresh,
    id: reply.id_token ?? previous.id,
    scopes: typeof reply.scope === "string" ? reply.scope.split(/\s+/) : (previous.scopes ?? []),
    expires: now + reply.expires_in * 1000,
    earliest: Number.isFinite(earliest) ? earliest : 0,
  };
}

async function postForm(request: AccountRequest, url: string, params: Record<string, string>) {
  return request(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams(params),
  });
}

export function createAccountService({
  store = accountStore(),
  request = fetch,
  verify = verifyIdentity,
  readPicture = readAccountPicture,
}: {
  store?: ReturnType<typeof accountStore>;
  request?: AccountRequest;
  verify?: typeof verifyIdentity;
  readPicture?: typeof readAccountPicture;
} = {}) {
  let pending: SignInAttempt | undefined;
  let lastError: string | undefined;
  let catalog: ModelCatalog | undefined;
  let cachedPicture:
    | { url: string; profileId?: string; expires: number; data: Promise<string | undefined> }
    | undefined;
  let requests = new AbortController();

  function invalidate() {
    requests.abort();
    requests = new AbortController();
    catalog = undefined;
    cachedPicture = undefined;
  }

  async function accountStatus(): Promise<
    Account & { profiles: { id: string; label?: string }[]; model?: string }
  > {
    const data = await store.read();
    const profile = active(data);
    return {
      connected: canTranslate(profile?.tokens),
      pending: Boolean(pending),
      profileId: profile?.clientId,
      ...(pending?.url && { url: pending.url }),
      ...(profile?.label && { label: profile.label }),
      picture: accountPicture(profile),
      ...(profile?.clientId === catalog?.clientId && catalog && { model: catalog.model }),
      ...(lastError && { error: lastError }),
      profiles: data.profiles
        .filter((p) => p.subject)
        .map((p) => ({ id: p.clientId, label: p.label })),
    };
  }

  async function readerAccount() {
    const status = await accountStatus();
    const { picture, profileId } = status;
    if (!picture) return status;

    if (
      cachedPicture?.url !== picture ||
      cachedPicture.profileId !== profileId ||
      cachedPicture.expires < Date.now()
    ) {
      const data = readPicture(picture).catch(() => undefined);
      cachedPicture = { url: picture, profileId, expires: Date.now() + 5 * 60_000, data };
    }
    const cached = cachedPicture;
    const data = await cached.data;
    if (!data && cachedPicture === cached) cachedPicture = undefined;
    return { ...status, picture: data };
  }

  async function finish(attempt: SignInAttempt, params: URLSearchParams, redirect: string) {
    const code = params.get("code");
    if (params.has("error") || !code) throw failedLogin();
    const returned = params.get("client_id");
    const clientId = returned || attempt.profile?.clientId;
    if (
      !clientId ||
      clientId === "dynamic_agent_client" ||
      (attempt.profile && returned && clientId !== attempt.profile.clientId)
    )
      throw failedLogin();
    const assertUnchanged = (data: AccountState) => {
      if (pending !== attempt || data.revision !== attempt.revision) throw changed();
    };
    // Retain the issued registration even when a one-time code expires before exchange.
    await store.exclusive(async (data, write) => {
      assertUnchanged(data);
      if (!attempt.profile) {
        if (data.profiles.some((p) => p.clientId === clientId)) throw changed();
        data.profiles.push({ clientId });
        if (!data.active) data.active = clientId;
        await write(data);
      }
    });
    const response = await postForm(request, tokenUrl, {
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirect,
      code_verifier: attempt.verifier,
      resource,
    });
    if (!response.ok) throw failedLogin();
    const reply: TokenResponse = await response.json();
    if (!reply.id_token) throw failedLogin();
    const identity = await verify(reply.id_token, clientId, attempt.nonce);
    const tokens = packTokens(reply);
    await store.exclusive(async (data, write) => {
      assertUnchanged(data);
      const profile = data.profiles.find((p) => p.clientId === clientId);
      if (!profile || (profile.subject && profile.subject !== identity.subject)) throw changed();
      Object.assign(profile, identity, { tokens });
      delete profile.rotation;
      data.active = clientId;
      data.revision++;
      await write(data);
      invalidate();
    });
    if (!tokens.scopes.includes(sharing)) throw disconnected();
  }

  async function beginSignIn({ newAccount = false, profileId }: AccountSignIn = {}) {
    if (pending) throw issue("sign_in_pending", "이미 ChatGPT 로그인을 진행하고 있습니다.");
    const attempt: SignInAttempt = { state: secret(), nonce: secret(), verifier: secret() };
    pending = attempt;
    lastError = undefined;
    try {
      const host = await store.exclusive(async (data, write) => {
        if (!data.host) {
          data.host = `urn:uuid:${randomUUID()}`;
          await write(data);
        }
        attempt.revision = data.revision;
        attempt.profile = newAccount
          ? undefined
          : data.profiles.find((p) => p.clientId === (profileId ?? data.active));
        if (profileId && !attempt.profile) throw changed();
        return data.host;
      });
      const server = createServer(async (req, res) => {
        const respond = (status: number, message: string) => {
          res.writeHead(status, {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          });
          res.end(message);
        };
        if (
          !attempt.redirect ||
          !req.url ||
          req.method !== "GET" ||
          req.headers.host !== new URL(attempt.redirect).host ||
          !req.url.startsWith("/") ||
          req.url.startsWith("//")
        )
          return respond(400, "잘못된 요청입니다.");
        const url = URL.parse(req.url, attempt.redirect);
        if (!url || url.origin !== new URL(attempt.redirect).origin)
          return respond(400, "잘못된 요청입니다.");
        if (url.pathname !== "/auth/callback") return respond(404, "");
        if (
          url.searchParams.get("state") !== attempt.state ||
          pending !== attempt ||
          attempt.consumed
        )
          return respond(400, "유효하지 않은 로그인 요청입니다.");
        attempt.consumed = true;
        try {
          await finish(attempt, url.searchParams, attempt.redirect);
          respond(200, "Hacker News에 ChatGPT 계정을 연결했습니다. 창을 닫고 리더로 돌아가세요.");
        } catch (err) {
          if (pending === attempt)
            lastError =
              err instanceof Error && "code" in err && err.code === "disconnected"
                ? err.message
                : failedLogin().message;
          respond(400, "ChatGPT 연결을 완료하지 못했습니다. 리더에서 다시 시도해 주세요.");
        } finally {
          endAttempt(attempt);
        }
      });
      attempt.server = server;
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      if (pending !== attempt) throw changed();
      const address = server.address();
      if (!address || typeof address === "string") throw failedLogin();
      attempt.redirect = `http://127.0.0.1:${address.port}/auth/callback`;
      attempt.timer = setTimeout(() => {
        lastError = "ChatGPT 로그인 시간이 만료되었습니다. 다시 연결해 주세요.";
        endAttempt(attempt);
      }, 5 * 60_000).unref();
      server.unref();
      const url = new URL("/api/accounts/authorize", issuer);
      url.search = new URLSearchParams({
        client_id: attempt.profile?.clientId || "dynamic_agent_client",
        ...(attempt.profile ? {} : { agent_name_hint: "Hacker News" }),
        ext_agent_host_id: host,
        response_type: "code",
        redirect_uri: attempt.redirect,
        scope,
        resource,
        state: attempt.state,
        nonce: attempt.nonce,
        code_challenge_method: "S256",
        code_challenge: createHash("sha256").update(attempt.verifier).digest("base64url"),
        ...(attempt.profile?.tokens &&
          !attempt.profile.tokens.scopes.includes(sharing) && { prompt: "consent" }),
      }).toString();
      attempt.url = url.href;
      return { url: attempt.url };
    } catch (err) {
      endAttempt(attempt);
      throw err;
    }
  }

  function endAttempt(attempt: SignInAttempt) {
    clearTimeout(attempt.timer);
    attempt.server?.close();
    if (pending === attempt) pending = undefined;
  }

  async function signOut() {
    if (pending) {
      endAttempt(pending);
      return readerAccount();
    }
    invalidate();
    lastError = undefined;
    await store.exclusive(async (data, write) => {
      const profile = active(data);
      const refresh = profile?.rotation?.tokens.refresh ?? profile?.tokens?.refresh;
      if (profile) {
        delete profile.tokens;
        delete profile.rotation;
      }
      data.revision++;
      await write(data);
      if (!profile || !refresh) return;
      // Clear locally first so a failed network request cannot leave the account connected.
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await postForm(request, `${issuer}/api/accounts/oauth/revoke`, {
          client_id: profile.clientId,
          token_type_hint: "refresh_token",
          token: refresh,
        }).catch(() => null);
        if (response?.ok) return;
        if (response && response.status < 500) break;
        if (!attempt) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      lastError = "로컬 연결을 해제했습니다. 원격 해제 여부는 ChatGPT 설정에서 확인해 주세요.";
    });
    return readerAccount();
  }

  async function credentials() {
    return store.exclusive(async (data, write) => {
      const profile = active(data);
      const activeTokens = profile?.tokens;
      if (!profile || !canTranslate(activeTokens)) throw disconnected();
      let tokens: AccountTokens = activeTokens;
      if (
        !profile.rotation &&
        tokens.expires < Date.now() + 60_000 &&
        tokens.refresh &&
        Date.now() >= tokens.earliest
      ) {
        const res = await postForm(request, tokenUrl, {
          client_id: profile.clientId,
          grant_type: "refresh_token",
          refresh_token: tokens.refresh,
          resource,
        });
        const reply: TokenResponse = await res.json().catch(() => ({}));
        if (!res.ok) {
          const errorCode = typeof reply.error === "string" ? reply.error : reply.error?.code;
          if (errorCode && terminalGrants.has(errorCode)) {
            delete profile.tokens;
            data.revision++;
            await write(data);
            throw disconnected();
          }
          throw issue(
            "refresh_unavailable",
            "ChatGPT 연결을 갱신할 수 없습니다. 잠시 후 다시 시도해 주세요.",
          );
        }
        profile.rotation = {
          tokens: packTokens(reply, tokens),
          newIdentity: Boolean(reply.id_token),
          received: Date.now(),
        };
        await write(data);
      }
      if (profile.rotation) {
        const rotation = profile.rotation;
        if (rotation.newIdentity) {
          const id = rotation.tokens.id;
          if (!id) throw failedLogin();
          const identity = await verify(
            id,
            profile.clientId,
            undefined,
            new Date(rotation.received),
          );
          if (identity.subject !== profile.subject) {
            delete profile.rotation;
            delete profile.tokens;
            data.revision++;
            await write(data);
            throw disconnected();
          }
        }
        tokens = rotation.tokens;
        profile.tokens = tokens;
        delete profile.rotation;
        await write(data);
      }
      if (!tokens.access || tokens.expires <= Date.now() || !tokens.scopes.includes(sharing))
        throw disconnected();
      return { token: tokens.access, clientId: profile.clientId, revision: data.revision };
    });
  }

  async function loadCatalog({ token, clientId }: Grant, signal: AbortSignal) {
    if (!catalog || catalog.clientId !== clientId || catalog.expires < Date.now()) {
      const res = await request(`${resource}/models`, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal,
      });
      await checkResponse(res);
      const { models }: { models?: { visibility?: string; slug: string }[] } = await res.json();
      const available = (models ?? []).filter(
        (m) => m.visibility === "list" && typeof m.slug === "string",
      );
      const preferred = available.find((m) => m.slug === lunaModel) ?? available[0];
      if (!preferred)
        throw issue("no_model", "연결한 ChatGPT 계정에서 사용할 번역 모델을 찾지 못했습니다.");
      catalog = {
        clientId,
        model: preferred.slug,
        models: available.map((m) => m.slug),
        expires: Date.now() + 60 * 60_000,
      };
    }
    return catalog;
  }

  async function listModels() {
    if (!(await accountStatus()).connected) return [];
    const grant = await credentials();
    const result = await loadCatalog(
      grant,
      AbortSignal.any([requests.signal, AbortSignal.timeout(12000)]),
    );
    if ((await store.read()).revision !== grant.revision) throw changed();
    return result.models;
  }

  async function translate(
    entries: TranslationEntry[],
    grant: Grant,
    signal: AbortSignal,
    selection: string,
  ) {
    const { token, revision } = grant;
    const available = await loadCatalog(grant, signal);
    const model = selection === AUTO_MODEL ? available.model : selection;
    if (!available.models.includes(model))
      throw issue(
        "no_model",
        "선택한 모델을 사용할 수 없습니다. 설정에서 다른 모델을 선택해 주세요.",
      );
    if ((await store.read()).revision !== revision) throw changed();
    const translated = await translateTitles(request, token, model, entries, signal);
    if ((await store.read()).revision !== revision) throw changed();
    return translated;
  }

  async function translateBatch(entries: TranslationEntry[], selection: string = AUTO_MODEL) {
    if (!entries.length) return [];
    const signal = AbortSignal.any([requests.signal, AbortSignal.timeout(120_000)]);
    const grant = await credentials();
    try {
      return await translate(entries, grant, signal, selection);
    } catch (err) {
      if (
        err instanceof Error &&
        "status" in err &&
        err.status === 401 &&
        "code" in err &&
        err.code === "disconnected"
      ) {
        await store.exclusive(async (data, write) => {
          const profile = active(data);
          if (
            data.revision !== grant.revision ||
            profile?.clientId !== grant.clientId ||
            profile.tokens?.access !== grant.token ||
            profile.rotation
          )
            throw changed();
          // A rejected access token cannot power the feed. Retain the renewable session for explicit sign-out.
          delete profile.tokens.access;
          data.revision++;
          await write(data);
          invalidate();
        });
      }
      throw err;
    }
  }

  return { accountStatus, readerAccount, beginSignIn, signOut, translateBatch, listModels };
}

export const { readerAccount, beginSignIn, signOut, translateBatch, listModels } =
  createAccountService();
