import assert from 'node:assert/strict'
import test from 'node:test'
import { createAccountService } from '../server/account.ts'

const entries = [{ id: '1', text: 'News' }]
const output = [{ id: '1', text: '소식' }]

function fixture() {
  const session = { status: 'connected', sharing: true, profileId: 'one', identity: { email: 'reader@example.org' } }
  const requests = []
  const sdk = {
    getSession: async () => structuredClone(session),
    listModels: async () => [{ slug: 'other' }, { slug: 'gpt-6-luna' }],
    streamResponse: async request => { requests.push(request); return { text: JSON.stringify(output) } },
    disconnect: async () => { session.status = 'disconnected'; session.sharing = false },
  }
  return { service: createAccountService(async () => sdk), sdk, requests, session }
}

test('SDK 세션과 플랜 권한을 사용하고 선택한 모델로 번역한다', async () => {
  const { service, requests } = fixture()
  assert.deepEqual((await service.accountStatus()).identity, { email: 'reader@example.org' })
  assert.deepEqual(await service.listModels(), ['other', 'gpt-6-luna'])
  assert.deepEqual(await service.translateBatch(entries), output)
  assert.equal(requests[0].model, 'gpt-6-luna')
  assert.equal(requests[0].input, JSON.stringify(entries))
  await service.translateBatch(entries, 'other')
  assert.equal(requests[1].model, 'other')
  await assert.rejects(service.translateBatch(entries, 'hidden'))
  assert.equal((await service.signOut()).connected, false)
  assert.deepEqual(await service.listModels(), [])
  await assert.rejects(service.translateBatch(entries), { code: 'disconnected' })
})

test('SDK 사용 한도, 잘못된 응답, 도중 계정 변경을 구분한다', async () => {
  const { service, sdk, session } = fixture()
  sdk.streamResponse = async () => { throw Object.assign(new Error(), { code: 'subscription_sharing_usage_limit_exceeded' }) }
  await assert.rejects(service.translateBatch(entries), { code: 'limited' })
  sdk.streamResponse = async () => ({ text: '[{"id":"2","text":"뉴스"}]' })
  await assert.rejects(service.translateBatch(entries), /글 번호/)
  sdk.streamResponse = async () => { session.profileId = 'two'; return { text: JSON.stringify(output) } }
  await assert.rejects(service.translateBatch(entries), /계정이 변경/)
})
