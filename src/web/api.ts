import { FastifyReply, FastifyRequest } from 'fastify'
import { BaseRouter } from './base-router'
import { WebPushError } from 'web-push'
import { Subscription } from '@/utils/web-push'

export class ApiRouter extends BaseRouter {
  async init(): Promise<void> {
    await this.fastify.register(
      (fastify, _, done) => {
        fastify
          .get('/', this.routeGet.bind(this))
          .addHook('onRequest', fastify.basicAuth)
        fastify
          .get('/vapidPublicKey', this.routeGetVapidPublicKey.bind(this))
          .addHook('onRequest', fastify.basicAuth)
        fastify
          .get('/destinations', this.routeGetDestinations.bind(this))
          .addHook('onRequest', fastify.basicAuth)
        fastify
          .post('/subscribe', this.routePostSubscribe.bind(this))
          .addHook('onRequest', fastify.basicAuth)
        fastify
          .delete('/subscribe', this.routeDeleteSubscribe.bind(this))
          .addHook('onRequest', fastify.basicAuth)
        done()
      },
      { prefix: '/api' }
    )
  }

  private routeGet() {
    return {
      message: 'telcheck API',
    }
  }

  private routeGetVapidPublicKey() {
    return {
      public_key: this.webPush.getBase64PublicKey(),
    }
  }

  private routeGetDestinations() {
    const destinations = this.config.destinations
      .filter((d) => d.type === 'web-push')
      .map((d) => d.name)
    return {
      destinations,
    }
  }

  /**
   * 購読リクエストの body が登録可能な形か検証する
   * @param body リクエスト body (信頼できない入力)
   * @returns 宛先が設定済みの web-push 宛先で、必須項目がすべて空でない文字列なら true
   */
  private isValidSubscribeBody(
    body: Partial<Subscription> | undefined | null
  ): body is Subscription {
    const isNonEmpty = (value: unknown): boolean =>
      typeof value === 'string' && value.length > 0
    return (
      isNonEmpty(body?.destinationName) &&
      isNonEmpty(body?.endpoint) &&
      isNonEmpty(body?.keys?.p256dh) &&
      isNonEmpty(body?.keys?.auth) &&
      this.config.destinations.some(
        (d) => d.type === 'web-push' && d.name === body?.destinationName
      )
    )
  }

  private async routePostSubscribe(
    request: FastifyRequest<{
      Body: {
        destinationName: string
        endpoint: string
        expirationTime: number | null
        keys: {
          p256dh: string
          auth: string
        }
      }
    }>,
    reply: FastifyReply
  ) {
    const subscription = request.body

    if (!this.isValidSubscribeBody(subscription)) {
      await reply.code(400).send({
        message: `Invalid subscription: destinationName must be a configured web-push destination, and endpoint, keys.p256dh and keys.auth must be non-empty strings (destinationName: ${String((subscription as Partial<Subscription> | undefined)?.destinationName)})`,
      })
      return
    }

    try {
      const statusCode = await this.webPush.sendNotification(
        subscription,
        JSON.stringify({
          title: '購読完了',
          body: `購読が完了しました。${subscription.destinationName} の通知をお届けします。`,
        })
      )

      // 404・410 (失効) と 500 (送信失敗) は 2xx ではないため保存しない
      if (statusCode >= 200 && statusCode < 300) {
        this.webPush.addSubscription(subscription)
      }

      await reply.code(statusCode).send()
    } catch (error) {
      if (error instanceof WebPushError) {
        await reply.code(500).send({
          message: error.message,
          statusCode: error.statusCode,
          headers: error.headers,
          body: error.body,
          endpoint: error.endpoint,
        })
        return
      }
      await reply.code(500).send({
        message: (error as Error).message,
      })
    }
  }

  private async routeDeleteSubscribe(
    request: FastifyRequest<{
      Body: {
        destinationName: string
        endpoint: string
        expirationTime: number | null
        keys: {
          p256dh: string
          auth: string
        }
      }
    }>,
    reply: FastifyReply
  ) {
    const subscription = request.body
    const result = this.webPush.removeSubscription(subscription)
    await reply.code(result ? 200 : 404).send()
  }
}
