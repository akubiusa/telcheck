import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Configuration } from '@/utils/config'
import { Subscription, WebPush } from '@/utils/web-push'
import { ApiRouter } from './api'

const subscription: Subscription = {
  destinationName: 'web',
  endpoint: 'https://push.example.com/abc',
  expirationTime: null,
  keys: { p256dh: 'p256dh', auth: 'auth' },
}

/**
 * 購読 API を、送信結果を固定したモックで呼び出す
 * @param sendResult 確認通知の送信結果 (HTTP ステータスコード)
 * @param body リクエスト body
 */
async function postSubscribe(sendResult: number, body: unknown) {
  const sendNotification = mock.fn(() => Promise.resolve(sendResult))
  const addSubscription = mock.fn()
  const webPush = { sendNotification, addSubscription } as unknown as WebPush
  const config = {
    destinations: [{ type: 'web-push', name: 'web' }],
  } as unknown as Configuration
  const router = new ApiRouter({} as FastifyInstance, config, webPush, '0.0.0')

  const replied: { code?: number } = {}
  const reply = {
    code: (code: number) => {
      replied.code = code
      return reply
    },
    send: () => Promise.resolve(),
  } as unknown as FastifyReply

  await (
    router as unknown as {
      routePostSubscribe(
        request: FastifyRequest,
        reply: FastifyReply
      ): Promise<void>
    }
  ).routePostSubscribe({ body } as FastifyRequest, reply)

  return {
    code: replied.code,
    sent: sendNotification.mock.callCount(),
    saved: addSubscription.mock.callCount(),
  }
}

describe('POST /api/subscribe', () => {
  it('確認通知が 201 で成功した場合は購読を保存し、そのステータスを返す', async () => {
    const result = await postSubscribe(201, subscription)

    assert.deepEqual(result, { code: 201, sent: 1, saved: 1 })
  })

  it('確認通知が 410 (失効) の場合は購読を保存せず 410 を返す', async () => {
    const result = await postSubscribe(410, subscription)

    assert.deepEqual(result, { code: 410, sent: 1, saved: 0 })
  })

  it('確認通知が 404 (失効) の場合は購読を保存しない', async () => {
    const result = await postSubscribe(404, subscription)

    assert.deepEqual(result, { code: 404, sent: 1, saved: 0 })
  })

  it('確認通知が 500 (送信失敗) の場合は購読を保存しない', async () => {
    const result = await postSubscribe(500, subscription)

    assert.deepEqual(result, { code: 500, sent: 1, saved: 0 })
  })

  it('未設定の宛先名は送信も保存もせず 400 を返す', async () => {
    const result = await postSubscribe(201, {
      ...subscription,
      destinationName: 'unknown',
    })

    assert.deepEqual(result, { code: 400, sent: 0, saved: 0 })
  })

  it('keys が欠けた body は送信も保存もせず 400 を返す', async () => {
    const result = await postSubscribe(201, {
      destinationName: 'web',
      endpoint: subscription.endpoint,
    })

    assert.deepEqual(result, { code: 400, sent: 0, saved: 0 })
  })

  it('body が空の場合は 400 を返す', async () => {
    const result = await postSubscribe(201, undefined)

    assert.deepEqual(result, { code: 400, sent: 0, saved: 0 })
  })
})
