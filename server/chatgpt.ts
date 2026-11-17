import { randomUUID } from 'node:crypto'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import lockfile from 'proper-lockfile'
import { createChatGPT } from 'sign-in-with-chatgpt/packages/local/src/index.ts'
import { ConnectionStore } from 'sign-in-with-chatgpt/packages/local/src/storage.ts'
import type { ChatGPTConfig, CredentialEncryption, PendingRegistration, StoredProfile } from 'sign-in-with-chatgpt/packages/local/src/types'
import { credentialEncryption } from './credential-encryption.ts'

interface LegacyTokens { access: string; refresh?: string; expires: number; earliest?: number; scopes: string[]; id?: string }
interface LegacyAccount {
  host?: string; active?: string;
  profiles: { clientId: string; subject?: string; label?: string; tokens?: LegacyTokens;
    rotation?: { tokens: LegacyTokens & { id: string }; newIdentity: boolean; received: number } }[];
}

function credentials(tokens: LegacyTokens) {
  return {
    accessToken: tokens.access, refreshToken: tokens.refresh, expiresAt: tokens.expires,
    ...(tokens.earliest && { earliestRefreshAt: new Date(tokens.earliest).toISOString() }),
  }
}

// 0.3.7 used the same callback and per-installation host ID with a different account file.
export async function migrateAccounts(directory: string, encryption: CredentialEncryption) {
  const file = join(directory, 'accounts.json')
  if (!await stat(file).catch(error => { if (error.code !== 'ENOENT') throw error })) return
  const store = new ConnectionStore(directory, encryption)
  await store.withLock(async () => {
    // Match the old lock path while keeping its in-process owner distinct from the SDK directory lock.
    const unlock = await lockfile.lock(file, { lockfilePath: directory + '.lock', realpath: false, stale: 120000, retries: 5 })
    try {
      const raw = await readFile(file, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error })
      if (!raw) return
      if (!await store.read()) {
        const old: LegacyAccount = JSON.parse(raw)
        if (old.host) {
          const hostFile = join(directory, 'chatgpt-host.json')
          try { await writeFile(hostFile, JSON.stringify({ version: 1, id: old.host }), { mode: 0o600, flag: 'wx' }) }
          catch (error) { if (!(error instanceof Error && "code" in error && error.code === 'EEXIST')) throw error }
          if (await store.getHostId() !== old.host) throw new Error('기존 계정의 설치 식별자가 일치하지 않습니다.')
        }
        const profiles: StoredProfile[] = [], pendingRegistrations: PendingRegistration[] = []
        let activeProfileId
        for (const [index, entry] of old.profiles.entries()) {
          const base = { id: randomUUID(), label: '계정 ' + (index + 1), clientId: entry.clientId, savedAt: new Date().toISOString() }
          if (!entry.subject) { pendingRegistrations.push(base); continue }
          if (entry.clientId === old.active) activeProfileId = base.id
          const rotation = entry.rotation
          const tokens = rotation && !rotation.newIdentity ? rotation.tokens : entry.tokens
          profiles.push({
            ...base, version: 1, subject: entry.subject,
            identity: entry.label?.includes('@') ? { email: entry.label } : { name: entry.label },
            status: tokens?.access ? 'connected' : tokens ? 'reauth_required' : 'disconnected',
            scopes: tokens?.scopes ?? [], profileIdToken: tokens?.id,
            ...(tokens?.access && { credentials: credentials(tokens) }),
            ...(rotation?.newIdentity && { pendingRefresh: {
              credentials: credentials(rotation.tokens), scopes: rotation.tokens.scopes,
              idToken: rotation.tokens.id, receivedAt: rotation.received,
            } }),
          })
        }
        await store.write({ version: 2, profiles, pendingRegistrations, activeProfileId })
        await store.read()
      }
      await rm(file)
    } finally { await unlock() }
  })
}

export async function localClient(openBrowser: ChatGPTConfig["openBrowser"]) {
  const storageDir = resolve(process.env.HN_DATA_DIR || join(homedir(), '.local', 'share', 'hacker-news'), 'account')
  await migrateAccounts(storageDir, credentialEncryption)
  return createChatGPT({
    appName: 'Hacker News', appId: 'hacker-news', redirectPort: 0, sendHostId: true,
    storageDir, credentialEncryption, openBrowser,
  })
}
