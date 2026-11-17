import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'

import type { CredentialEncryption } from 'sign-in-with-chatgpt/packages/local/src/types'

const service = 'dev.2sky.hacker-news.chatgpt'
const account = 'credential-encryption-v1'

function security(args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('/usr/bin/security', args, { timeout: 30000 }, (error, stdout) => {
      // Interactive security errors may include the input. Never propagate its output.
      if (error) reject(Object.assign(new Error('macOS 키체인에 접근하지 못했습니다.'), { code: error.code }))
      else resolve(stdout.trim())
    })
    child.stdin?.on('error', reject)
    child.stdin?.end(input)
  })
}

async function key(create: boolean) {
  const lookup = ['find-generic-password', '-s', service, '-a', account, '-w']
  let value
  try { value = await security(lookup) }
  catch (error) {
    if (!create || !(error instanceof Error && "code" in error && error.code === 44)) throw error
    // Supply the secret on stdin. Without -U a competing creator cannot overwrite an existing key.
    await security(['-i'], `add-generic-password -s ${service} -a ${account} -w ${randomBytes(32).toString('hex')}\n`)
    value = await security(lookup)
  }
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('키체인에 저장된 암호화 키를 확인해 주세요.')
  return Buffer.from(value, 'hex')
}

export const credentialEncryption: CredentialEncryption = {
  id: 'macos-keychain-aes256gcm-v1',
  isAvailable: () => process.platform === 'darwin',
  async encrypt(plaintext) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', await key(true), iv)
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), data])
  },
  async decrypt(bytes) {
    const data = Buffer.from(bytes)
    const cipher = createDecipheriv('aes-256-gcm', await key(false), data.subarray(0, 12))
    cipher.setAuthTag(data.subarray(12, 28))
    return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8')
  },
}
