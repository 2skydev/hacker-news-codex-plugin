import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import lockfile from 'proper-lockfile'

export function accountStore(dir = process.env.HN_DATA_DIR || join(homedir(), '.local', 'share', 'hacker-news')) {
  const folder = join(dir, 'account')
  const path = join(folder, 'accounts.json')

  async function read() {
    try {
      return JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') return { profiles: [], active: null, revision: 0 }
      throw new Error('저장된 ChatGPT 계정을 읽을 수 없습니다.')
    }
  }

  async function write(data) {
    const temp = join(folder, randomUUID() + '.tmp')
    try {
      await writeFile(temp, JSON.stringify(data), { mode: 0o600, flag: 'wx', flush: true })
      await rename(temp, path)
    } finally {
      await rm(temp, { force: true })
    }
  }

  async function exclusive(action) {
    await mkdir(folder, { recursive: true, mode: 0o700 })
    await chmod(folder, 0o700)
    const unlock = await lockfile.lock(folder, {
      stale: 120_000,
      retries: { retries: 70, maxTimeout: 400, minTimeout: 25 },
    })
    try {
      return await action(await read(), write)
    } finally {
      await unlock()
    }
  }
  return { read, exclusive }
}
