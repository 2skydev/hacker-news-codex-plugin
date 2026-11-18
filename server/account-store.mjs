import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import lockfile from 'proper-lockfile'
import { credentialEncryption } from './credential-encryption.ts'

function sdkAccount(state, host) {
  if (state.version !== 2) throw new Error('저장된 계정 형식을 확인해 주세요.')
  const tokens = (credentials, scopes, id) => ({
    access: credentials.accessToken, refresh: credentials.refreshToken, expires: credentials.expiresAt,
    earliest: typeof credentials.earliestRefreshAt === 'number' ? credentials.earliestRefreshAt * 1000 : Date.parse(credentials.earliestRefreshAt) || 0,
    scopes, ...(id && { id }),
  })
  const profiles = state.profiles.map(profile => ({
    clientId: profile.clientId, subject: profile.subject, label: profile.identity?.email || profile.identity?.name || profile.label,
    ...(profile.credentials && { tokens: tokens(profile.credentials, profile.scopes, profile.profileIdToken) }),
    ...(profile.pendingRefresh && { rotation: {
      tokens: tokens(profile.pendingRefresh.credentials, profile.pendingRefresh.scopes, profile.pendingRefresh.idToken),
      newIdentity: true, received: profile.pendingRefresh.receivedAt,
    } }),
  }))
  return { host, revision: 0, profiles: [...profiles, ...state.pendingRegistrations.map(({ clientId }) => ({ clientId }))],
    active: state.profiles.find(profile => profile.id === state.activeProfileId)?.clientId ?? state.pendingRegistrations[0]?.clientId ?? null }
}

async function jsonFile(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}

export function accountStore(dir = process.env.HN_DATA_DIR || join(homedir(), '.local', 'share', 'hacker-news'), encryption = credentialEncryption) {
  const folder = join(dir, 'account')
  const path = join(folder, 'accounts.json')

  async function unpack(value) {
    if (value.version !== 3 || value.provider !== encryption.id) throw new Error('저장된 계정의 암호화 형식을 확인해 주세요.')
    return JSON.parse(await encryption.decrypt(Buffer.from(value.ciphertext, 'base64')))
  }

  async function load() {
    const saved = await jsonFile(path)
    if (saved?.version === 3) return unpack(saved)
    if (saved) {
      if (saved.profiles.length) await write(saved)
      return saved
    }
    const host = (await jsonFile(join(folder, 'chatgpt-host.json')))?.id
    const sdkPath = join(folder, 'chatgpt-auth.json')
    const previous = await jsonFile(sdkPath)
    if (!previous) return { host, profiles: [], active: null, revision: 0 }
    const converted = sdkAccount(await unpack(previous), host)
    await write(converted)
    await rm(sdkPath)
    return converted
  }

  async function write(data) {
    const temp = join(folder, randomUUID() + '.tmp')
    try {
      const record = data.profiles.length ? {
        version: 3, provider: encryption.id, ciphertext: Buffer.from(await encryption.encrypt(JSON.stringify(data))).toString('base64'),
      } : data
      await writeFile(temp, JSON.stringify(record), { mode: 0o600, flag: 'wx', flush: true })
      await rename(temp, path)
    } finally {
      await rm(temp, { force: true })
    }
  }

  async function exclusive(action) {
    await mkdir(folder, { recursive: true, mode: 0o700 })
    await chmod(folder, 0o700)
    const options = { stale: 120_000, retries: { retries: 70, maxTimeout: 400, minTimeout: 25 } }
    const unlockSdk = await lockfile.lock(path, { ...options, realpath: false, lockfilePath: join(folder, '.chatgpt-auth.lock') })
    try {
      const unlock = await lockfile.lock(folder, options)
      try { return await action(await load(), write) }
      finally { await unlock() }
    } finally { await unlockSdk() }
  }
  return { read: () => exclusive(data => data), exclusive }
}
