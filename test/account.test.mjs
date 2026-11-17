import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { generateKeyPair, SignJWT } from 'jose'
import { createAccountService, verifyIdentity } from '../server/account.mjs'
import { accountStore } from '../server/account-store.mjs'
import { readTranslationStream } from '../server/account-inference.mjs'

const scope = 'openid email offline_access resource.invoke chatgpt.tokens.use.direct'
const rows = [{ id: '1', text: 'news' }]
const translations = [{ id: '1', text: '소식' }]
const events = values => new Response(values.map(e => 'data: ' + JSON.stringify(e) + '\r\n\r\n').join(''))
const success = () => events([
  { type: 'response.output_text.delta', delta: JSON.stringify(translations) },
  { type: 'response.completed' },
])
const json = (data, status = 200) => Response.json(data, { status })

async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'hacker-news-account-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const store = accountStore(folder)
  const grant = { access_token: 'test-access', refresh_token: 'test-refresh', token_type: 'bearer', id_token: 'test.id', scope, expires_in: 3600 }
  let authorization, currentResponse = success, refresh = 0, revoked
  const api = []
  const request = async (url, options) => {
    if (url.endsWith('/oauth/token')) {
      if (options.body.get('grant_type') === 'refresh_token') {
        refresh++
        await new Promise(resolve => setTimeout(resolve, 25))
        return json({ ...grant, access_token: 'fresh' })
      }
      assert.equal(createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'), authorization.searchParams.get('code_challenge'))
      return json(grant)
    }
    if (url.endsWith('/revoke')) {
      revoked = options.body.get('token')
      return new Response()
    }
    api.push({ url, options })
    if (url.endsWith('/models')) return json({ models: [
      { visibility: 'hide', slug: 'hidden' },
      { visibility: 'list', slug: 'other' },
      { visibility: 'list', slug: 'gpt-6-luna' },
    ] })
    if (url.endsWith('/responses')) return currentResponse()
    throw new Error('Unexpected fixture URL')
  }
  let subject = 'person'
  const verify = async (token, client, nonce) => {
    assert.equal(token, 'test.id')
    if (nonce) assert.equal(nonce, authorization.searchParams.get('nonce'))
    return { subject, label: 'test@example.com' }
  }
  const service = createAccountService({ store, request, verify })
  async function begin(options) {
    authorization = new URL((await service.beginSignIn(options)).url)
    return new URL(authorization.searchParams.get('redirect_uri'))
  }
  async function login(options) {
    const callback = await begin(options)
    callback.search = new URLSearchParams({ state: authorization.searchParams.get('state'), code: 'abc', client_id: options?.newAccount ? 'oaiapp_2' : 'oaiapp_1' })
    return fetch(callback)
  }
  return { service, begin, login, grant, store, folder, api, setSubject: s => { subject = s }, setResponse: r => { currentResponse = r }, get revoked() { return revoked }, get refresh() { return refresh } }
}

test('OAuth login, plan-approved model choice, stream and disconnect', async t => {
  const f = await fixture(t)
  assert.equal((await f.service.accountStatus()).connected, false)
  assert.equal((await f.login()).status, 200)
  const safe = await f.service.accountStatus()
  assert.equal(safe.connected, true)
  assert.ok(!JSON.stringify(safe).includes('test-access'))
  assert.equal((await stat(join(f.folder, 'account/accounts.json'))).mode & 0o777, 0o600)
  assert.deepEqual(await f.service.translateBatch(rows), translations)
  const body = JSON.parse(f.api[1].options.body)
  assert.equal(body.model, 'gpt-6-luna')
  assert.equal(body.stream, true)
  assert.equal(body.store, false)
  assert.equal(f.api[1].options.headers.Authorization, 'Bearer test-access')
  assert.equal((await f.service.signOut()).connected, false)
  assert.equal(f.revoked, 'test-refresh')
  assert.ok(!(await readFile(join(f.folder, 'account/accounts.json'), 'utf8')).includes('test-access'))
  await assert.rejects(f.service.translateBatch(rows), { code: 'disconnected' })
})

test('callback checks state and cancel prevents using pending registration', async t => {
  const f = await fixture(t)
  const callback = await f.begin()
  callback.search = '?state=fake&code=foo&client_id=foo'
  assert.equal((await fetch(callback)).status, 400)
  assert.equal((await f.service.accountStatus()).pending, true)
  await f.service.signOut()
  assert.equal((await f.service.accountStatus()).pending, false)
})

test('consent, returning identities and isolated registrations', async t => {
  const f = await fixture(t)
  f.grant.scope = 'openid email'
  assert.equal((await f.login()).status, 400)
  assert.equal((await f.service.accountStatus()).connected, false)
  await assert.rejects(f.service.translateBatch(rows), { code: 'disconnected' })
  f.setSubject('another')
  f.grant.scope = scope
  assert.equal((await f.login()).status, 400)
  assert.equal((await f.login({ newAccount: true })).status, 200)
  assert.equal((await f.service.accountStatus()).profiles.length, 2)
})

test('refresh is serialized across workers', async t => {
  const f = await fixture(t)
  await f.login()
  await f.store.exclusive(async (s, save) => { s.profiles[0].tokens.expires = Date.now(); await save(s) })
  await Promise.all([f.service.translateBatch(rows), f.service.translateBatch(rows)])
  assert.equal(f.refresh, 1)
  assert.ok(f.api.every(r => r.options.headers.Authorization === 'Bearer fresh'))
})

test('a stream can fail after sending deltas; incomplete and mismatched output are rejected', async t => {
  const f = await fixture(t)
  await f.login()
  f.setResponse(() => events([{ type: 'response.output_text.delta', delta: 'partial' }, { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }]))
  await assert.rejects(f.service.translateBatch(rows), { code: 'limited' })
  assert.equal((await f.service.accountStatus()).connected, true)
  await assert.rejects(readTranslationStream(events([{ type: 'response.output_text.delta', delta: 'partial' }])))
  f.setResponse(() => events([{ type: 'response.output_text.delta', delta: '[{"id":"wrong","text":"한글"}]' }, { type: 'response.completed' }]))
  await assert.rejects(f.service.translateBatch(rows), { code: 'translation_error' })
})

test('OpenID identity requires the issuer, intended audience, expiry, signature and nonce', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const { publicKey: otherKey } = await generateKeyPair('RS256')
  const sign = (issuer, expiry) => new SignJWT({ sub: 'subject', nonce: 'challenge' })
    .setProtectedHeader({ alg: 'RS256' }).setIssuer(issuer).setAudience('our-registration').setExpirationTime(expiry).sign(privateKey)
  const valid = await sign('https://auth.openai.com', '1h')
  assert.equal((await verifyIdentity(valid, 'our-registration', 'challenge', undefined, publicKey)).subject, 'subject')
  await assert.rejects(verifyIdentity(valid, 'other-registration', 'challenge', undefined, publicKey))
  await assert.rejects(verifyIdentity(valid, 'our-registration', 'other', undefined, publicKey))
  await assert.rejects(verifyIdentity(valid, 'our-registration', 'challenge', undefined, otherKey))
  await assert.rejects(verifyIdentity(await sign('https://example.invalid', '1h'), 'our-registration', 'challenge', undefined, publicKey))
  await assert.rejects(verifyIdentity(await sign('https://auth.openai.com', 10), 'our-registration', 'challenge', undefined, publicKey))
})

test('rejected access pauses translation until reconnect and retains the session for revocation', async t => {
  const f = await fixture(t)
  await f.login()
  f.setResponse(() => json({}, 503))
  await assert.rejects(f.service.translateBatch(rows), { code: 'translation_error' })
  assert.equal((await f.service.accountStatus()).connected, true)
  f.setResponse(() => json({}, 401))
  await assert.rejects(f.service.translateBatch(rows), { code: 'disconnected' })
  assert.equal((await f.service.accountStatus()).connected, false)
  const calls = f.api.length
  await assert.rejects(f.service.translateBatch(rows), { code: 'disconnected' })
  assert.equal(f.api.length, calls)
  await f.service.signOut()
  assert.equal(f.revoked, 'test-refresh')
  await f.login()
  assert.equal((await f.service.accountStatus()).connected, true)
  await f.store.exclusive(async (state, save) => {
    const { tokens } = state.profiles[0]
    delete tokens.refresh
    tokens.expires = Date.now() - 1000
    await save(state)
  })
  assert.equal((await f.service.accountStatus()).connected, false)
})

test('a delayed 401 cannot disconnect a concurrently refreshed access token', async t => {
  const f = await fixture(t)
  await f.login()
  f.setResponse(async () => {
    await f.store.exclusive(async (state, save) => {
      state.profiles[0].tokens.access = 'fresh'
      await save(state)
    })
    return json({}, 401)
  })
  await assert.rejects(f.service.translateBatch(rows), { code: 'account_changed' })
  assert.equal((await f.service.accountStatus()).connected, true)
  f.setResponse(success)
  assert.deepEqual(await f.service.translateBatch(rows), translations)
  assert.equal(f.api.at(-1).options.headers.Authorization, 'Bearer fresh')
})

test('모델 설정에는 계정이 제공하는 모델만 표시하고 선택한 모델로 번역한다', async t => {
  const f = await fixture(t)
  assert.deepEqual(await f.service.listModels(), [])
  await f.login()
  assert.deepEqual(await f.service.listModels(), ['other', 'gpt-6-luna'])
  await f.service.translateBatch(rows, 'other')
  assert.equal(JSON.parse(f.api.at(-1).options.body).model, 'other')
  await assert.rejects(f.service.translateBatch(rows, 'hidden'), { code: 'no_model' })
})
