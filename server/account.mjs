import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { accountStore } from './account-store.mjs'
import { checkResponse, issue, translateTitles } from './account-inference.mjs'

const issuer = 'https://auth.openai.com'
const resource = 'https://api.openai.com/v1'
const tokenUrl = issuer + '/api/accounts/oauth/token'
const sharing = 'chatgpt.tokens.use.direct'
const scope = 'openid profile email offline_access resource.invoke ' + sharing
const jwks = createRemoteJWKSet(new URL(issuer + '/.well-known/jwks.json'))
const terminalGrants = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'])

const disconnected = () => issue('disconnected', 'ChatGPT 계정에 연결하고 플랜 사용을 허용해 주세요.')
const changed = () => issue('account_changed', 'ChatGPT 계정이 변경되었습니다. 다시 시도해 주세요.')
const failedLogin = () => issue('sign_in_failed', 'ChatGPT 로그인을 완료하지 못했습니다. 다시 시도해 주세요.')
const secret = () => randomBytes(32).toString('base64url')
const active = data => data.profiles.find(p => p.clientId === data.active)
function canTranslate(profile) {
  const tokens = profile?.tokens
  return Boolean(tokens?.access && tokens.scopes.includes(sharing) && (tokens.expires > Date.now() || tokens.refresh))
}

export async function verifyIdentity(token, clientId, nonce, date, verificationKey = jwks) {
  const { payload } = await jwtVerify(token, verificationKey, {
    issuer, audience: clientId, algorithms: ['RS256'], currentDate: date,
    requiredClaims: ['sub', 'exp'],
  })
  if (typeof payload.sub !== 'string' || !payload.sub || (nonce && payload.nonce !== nonce) ||
      (payload.azp && payload.azp !== clientId) ||
      (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) throw failedLogin()
  return { subject: payload.sub, label: typeof payload.email === 'string' ? payload.email : 'ChatGPT 계정' }
}

function packTokens(reply, previous = {}, now = Date.now()) {
  if (typeof reply.access_token !== 'string' || !reply.access_token ||
      (previous.refresh && (typeof reply.refresh_token !== 'string' || !reply.refresh_token)) ||
      !Number.isFinite(reply.expires_in) || reply.expires_in <= 0 ||
      (reply.token_type ?? '').toLowerCase() !== 'bearer') throw failedLogin()
  const earliest = typeof reply.earliest_refresh_at === 'number' ? reply.earliest_refresh_at * 1000 : Date.parse(reply.earliest_refresh_at)
  return {
    access: reply.access_token, refresh: reply.refresh_token ?? previous.refresh,
    id: reply.id_token ?? previous.id,
    scopes: typeof reply.scope === 'string' ? reply.scope.split(/\s+/) : (previous.scopes ?? []),
    expires: now + reply.expires_in * 1000, earliest: Number.isFinite(earliest) ? earliest : 0,
  }
}

async function postForm(request, url, params) {
  return request(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), body: new URLSearchParams(params),
  })
}

export function createAccountService({ store = accountStore(), request = fetch, verify = verifyIdentity } = {}) {
  let pending
  let lastError
  let catalog
  let requests = new AbortController()

  function invalidate() {
    requests.abort()
    requests = new AbortController()
    catalog = undefined
  }

  async function accountStatus() {
    const data = await store.read()
    const profile = active(data)
    return {
      connected: canTranslate(profile), pending: Boolean(pending),
      ...(profile?.label && { label: profile.label }),
      ...(profile?.clientId === catalog?.clientId && catalog && { model: catalog.model }),
      ...(lastError && { error: lastError }),
      profiles: data.profiles.filter(p => p.subject).map(p => ({ id: p.clientId, label: p.label })),
    }
  }

  async function finish(attempt, params) {
    if (params.has('error') || !params.get('code')) throw failedLogin()
    const returned = params.get('client_id')
    const clientId = returned || attempt.profile?.clientId
    if (!clientId || clientId === 'dynamic_agent_client' || (attempt.profile && returned && clientId !== attempt.profile.clientId)) throw failedLogin()
    const assertUnchanged = data => {
      if (pending !== attempt || data.revision !== attempt.revision) throw changed()
    }
    // Retain the issued registration even when a one-time code expires before exchange.
    await store.exclusive(async (data, write) => {
      assertUnchanged(data)
      if (!attempt.profile) {
        if (data.profiles.some(p => p.clientId === clientId)) throw changed()
        data.profiles.push({ clientId })
        if (!data.active) data.active = clientId
        await write(data)
      }
    })
    const response = await postForm(request, tokenUrl, {
      grant_type: 'authorization_code', client_id: clientId, code: params.get('code'),
      redirect_uri: attempt.redirect, code_verifier: attempt.verifier, resource,
    })
    if (!response.ok) throw failedLogin()
    const reply = await response.json()
    const identity = await verify(reply.id_token, clientId, attempt.nonce)
    const tokens = packTokens(reply)
    await store.exclusive(async (data, write) => {
      assertUnchanged(data)
      const profile = data.profiles.find(p => p.clientId === clientId)
      if (!profile || (profile.subject && profile.subject !== identity.subject)) throw changed()
      Object.assign(profile, identity, { tokens })
      delete profile.rotation
      data.active = clientId
      data.revision++
      await write(data)
      invalidate()
    })
    if (!tokens.scopes.includes(sharing)) throw disconnected()
  }

  async function beginSignIn({ newAccount = false, profileId } = {}) {
    if (pending) throw issue('sign_in_pending', '이미 ChatGPT 로그인을 진행하고 있습니다.')
    const attempt = { state: secret(), nonce: secret(), verifier: secret() }
    pending = attempt
    lastError = undefined
    try {
      await store.exclusive(async (data, write) => {
        if (!data.host) {
          data.host = 'urn:uuid:' + randomUUID()
          await write(data)
        }
        attempt.host = data.host
        attempt.revision = data.revision
        attempt.profile = newAccount ? undefined : data.profiles.find(p => p.clientId === (profileId ?? data.active))
        if (profileId && !attempt.profile) throw changed()
      })
      const server = createServer(async (req, res) => {
        const respond = (status, message) => {
          res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
          res.end(message)
        }
        if (!attempt.redirect || req.method !== 'GET' || req.headers.host !== new URL(attempt.redirect).host ||
            !req.url.startsWith('/') || req.url.startsWith('//')) return respond(400, '잘못된 요청입니다.')
        const url = URL.parse(req.url, attempt.redirect)
        if (!url || url.origin !== new URL(attempt.redirect).origin) return respond(400, '잘못된 요청입니다.')
        if (url.pathname !== '/auth/callback') return respond(404, '')
        if (url.searchParams.get('state') !== attempt.state || pending !== attempt || attempt.consumed) return respond(400, '유효하지 않은 로그인 요청입니다.')
        attempt.consumed = true
        try {
          await finish(attempt, url.searchParams)
          respond(200, 'Hacker News에 ChatGPT 계정을 연결했습니다. 창을 닫고 Codex로 돌아가세요.')
        } catch (err) {
          if (pending === attempt) lastError = err.code === 'disconnected' ? err.message : failedLogin().message
          respond(400, 'ChatGPT 연결을 완료하지 못했습니다. Codex에서 다시 시도해 주세요.')
        } finally {
          endAttempt(attempt)
        }
      })
      attempt.server = server
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      if (pending !== attempt) throw changed()
      attempt.redirect = 'http://127.0.0.1:' + server.address().port + '/auth/callback'
      attempt.timer = setTimeout(() => {
        lastError = 'ChatGPT 로그인 시간이 만료되었습니다. 다시 연결해 주세요.'
        endAttempt(attempt)
      }, 5 * 60_000).unref()
      server.unref()
      const url = new URL('/api/accounts/authorize', issuer)
      url.search = new URLSearchParams({
        client_id: attempt.profile?.clientId || 'dynamic_agent_client',
        ...(attempt.profile ? {} : { agent_name_hint: 'Hacker News' }),
        ext_agent_host_id: attempt.host, response_type: 'code', redirect_uri: attempt.redirect,
        scope, resource, state: attempt.state, nonce: attempt.nonce,
        code_challenge_method: 'S256', code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url'),
        ...(attempt.profile?.tokens && !attempt.profile.tokens.scopes.includes(sharing) && { prompt: 'consent' }),
      })
      return { url: url.href }
    } catch (err) {
      endAttempt(attempt)
      throw err
    }
  }

  function endAttempt(attempt) {
    clearTimeout(attempt.timer)
    attempt.server?.close()
    if (pending === attempt) pending = undefined
  }

  async function signOut() {
    if (pending) endAttempt(pending)
    invalidate()
    lastError = undefined
    await store.exclusive(async (data, write) => {
      const profile = active(data)
      const refresh = profile?.rotation?.tokens.refresh ?? profile?.tokens?.refresh
      if (profile) {
        delete profile.tokens
        delete profile.rotation
      }
      data.revision++
      await write(data)
      if (!refresh) return
      // Clear locally first so a failed network request cannot leave the account connected.
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await postForm(request, issuer + '/api/accounts/oauth/revoke', {
          client_id: profile.clientId, token_type_hint: 'refresh_token', token: refresh,
        }).catch(() => null)
        if (response?.ok) return
        if (response && response.status < 500) break
        if (!attempt) await new Promise(resolve => setTimeout(resolve, 250))
      }
      lastError = '로컬 연결을 해제했습니다. 원격 해제 여부는 ChatGPT 설정에서 확인해 주세요.'
    })
    return accountStatus()
  }

  async function credentials() {
    return store.exclusive(async (data, write) => {
      const profile = active(data)
      if (!canTranslate(profile)) throw disconnected()
      let tokens = profile.tokens
      if (!profile.rotation && tokens.expires < Date.now() + 60_000 && tokens.refresh && Date.now() >= tokens.earliest) {
        const res = await postForm(request, tokenUrl, { client_id: profile.clientId, grant_type: 'refresh_token', refresh_token: tokens.refresh, resource })
        const reply = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (terminalGrants.has(typeof reply.error === 'string' ? reply.error : reply.error?.code)) {
            delete profile.tokens
            data.revision++
            await write(data)
            throw disconnected()
          }
          throw issue('refresh_unavailable', 'ChatGPT 연결을 갱신할 수 없습니다. 잠시 후 다시 시도해 주세요.')
        }
        profile.rotation = { tokens: packTokens(reply, tokens), newIdentity: Boolean(reply.id_token), received: Date.now() }
        await write(data)
      }
      if (profile.rotation) {
        const rotation = profile.rotation
        if (rotation.newIdentity) {
          const identity = await verify(rotation.tokens.id, profile.clientId, undefined, new Date(rotation.received))
          if (identity.subject !== profile.subject) {
            delete profile.rotation
            delete profile.tokens
            data.revision++
            await write(data)
            throw disconnected()
          }
        }
        tokens = rotation.tokens
        profile.tokens = tokens
        delete profile.rotation
        await write(data)
      }
      if (tokens.expires <= Date.now() || !tokens.scopes.includes(sharing)) throw disconnected()
      return { token: tokens.access, clientId: profile.clientId, revision: data.revision }
    })
  }

  async function loadCatalog({ token, clientId }, signal) {
    if (!catalog || catalog.clientId !== clientId || catalog.expires < Date.now()) {
      const res = await request(resource + '/models', { headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal })
      await checkResponse(res)
      const { models } = await res.json()
      const available = (models ?? []).filter(m => m.visibility === 'list' && typeof m.slug === 'string')
      const preferred = available.find(m => m.slug === 'gpt-6-luna') ?? available[0]
      if (!preferred) throw issue('no_model', '연결한 ChatGPT 계정에서 사용할 번역 모델을 찾지 못했습니다.')
      catalog = { clientId, model: preferred.slug, models: available.map(m => m.slug), expires: Date.now() + 60 * 60_000 }
    }
    return catalog
  }

  async function listModels() {
    if (!(await accountStatus()).connected) return []
    const grant = await credentials()
    const result = await loadCatalog(grant, AbortSignal.any([requests.signal, AbortSignal.timeout(12000)]))
    if ((await store.read()).revision !== grant.revision) throw changed()
    return result.models
  }

  async function translate(entries, grant, signal, selection) {
    const { token, revision } = grant
    const available = await loadCatalog(grant, signal)
    const model = selection === '자동' ? available.model : selection
    if (!available.models.includes(model)) throw issue('no_model', '선택한 모델을 사용할 수 없습니다. 설정에서 다른 모델을 선택해 주세요.')
    if ((await store.read()).revision !== revision) throw changed()
    const translated = await translateTitles(request, token, model, entries, signal)
    if ((await store.read()).revision !== revision) throw changed()
    return translated
  }

  async function translateBatch(entries, selection = '자동') {
    if (!entries.length) return []
    const signal = AbortSignal.any([requests.signal, AbortSignal.timeout(120_000)])
    const grant = await credentials()
    try {
      return await translate(entries, grant, signal, selection)
    } catch (err) {
      if (err.status === 401 && err.code === 'disconnected') {
        await store.exclusive(async (data, write) => {
          const profile = active(data)
          if (data.revision !== grant.revision || profile?.clientId !== grant.clientId ||
              profile.tokens?.access !== grant.token || profile.rotation) throw changed()
          // A rejected access token cannot power the feed. Retain the renewable session for explicit sign-out.
          delete profile.tokens.access
          data.revision++
          await write(data)
          invalidate()
        })
      }
      throw err
    }
  }

  return { accountStatus, beginSignIn, signOut, translateBatch, listModels }
}

export const { accountStatus, beginSignIn, signOut, translateBatch, listModels } = createAccountService()
