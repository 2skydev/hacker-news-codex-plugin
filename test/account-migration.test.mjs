import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID, webcrypto } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

test('기존 계정과 설치 ID를 SDK 암호화 저장소로 한 번만 이전한다', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'hn-sdk-migration-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const outfile = join(dir, 'sdk.mjs')
  await build({
    stdin: { contents: [
      "export { migrateAccounts } from './server/chatgpt.ts'",
      "export { createChatGPT } from 'sign-in-with-chatgpt/packages/local/src/index.ts'",
    ].join('\n'), resolveDir: process.cwd() },
    outfile, bundle: true, platform: 'node', format: 'esm',
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  })
  const { migrateAccounts, createChatGPT } = await import(pathToFileURL(outfile))
  const host = 'urn:uuid:' + randomUUID()
  const oldFile = join(dir, 'accounts.json')
  await writeFile(oldFile, JSON.stringify({ host, active: 'oaiapp_test', profiles: [{
    clientId: 'oaiapp_test', subject: 'test', label: 'test@example.org',
    tokens: { access: 'fixture-access', refresh: 'fixture-refresh', scopes: ['chatgpt.tokens.use.direct'], expires: Date.now() + 3600000 },
  }] }))
  const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const encryption = {
    id: 'migration-test', isAvailable: () => true,
    async encrypt(text) {
      const iv = webcrypto.getRandomValues(new Uint8Array(12))
      const data = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, Buffer.from(text))
      return Buffer.concat([iv, Buffer.from(data)])
    },
    async decrypt(data) {
      const text = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12) }, key, data.subarray(12))
      return Buffer.from(text).toString('utf8')
    },
  }
  await assert.rejects(migrateAccounts(dir, { ...encryption, isAvailable: () => false }))
  assert.match(await readFile(oldFile, 'utf8'), /fixture-refresh/)
  await Promise.all([migrateAccounts(dir, encryption), migrateAccounts(dir, encryption)])
  const sdk = createChatGPT({ appId: 'test', appName: 'Test', storageDir: dir, credentialEncryption: encryption, redirectPort: 0 })
  const session = await sdk.getSession()
  assert.equal(session.sharing, true)
  assert.equal(session.identity.email, 'test@example.org')
  assert.equal((await sdk.listProfiles()).length, 1)
  assert.equal(JSON.parse(await readFile(join(dir, 'chatgpt-host.json'))).id, host)
  assert.doesNotMatch(await readFile(join(dir, 'chatgpt-auth.json'), 'utf8'), /fixture-|test@example/)
  await assert.rejects(readFile(oldFile), { code: 'ENOENT' })
})
