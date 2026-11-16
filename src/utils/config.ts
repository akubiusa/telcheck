/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import fs from 'node:fs'
import { SyslogCall } from './nvr510'

export const PATH = {
  CONFIG_FILE: process.env.CONFIG_PATH ?? 'data/config.json',
  CHECKED_FILE: process.env.CHECKED_PATH ?? 'data/checked.json',
  DELIVERY_FILE: process.env.DELIVERY_PATH ?? 'data/delivery.json',
  PHONES_FILE: process.env.PHONES_PATH ?? 'data/phones.tsv',
}

interface DestinationDiscordWebhook {
  type: 'discord-webhook'
  /** Discord Webhook URL */
  webhook_url: string
}

interface DestinationDiscordBot {
  type: 'discord-bot'
  /** Discord Bot のトークン */
  token: string
  /** 通知先の Discord チャンネル ID */
  channel_id: string
}

interface DestinationSlack {
  type: 'slack'
  /** Slack Incoming Webhook URL */
  webhook_url: string
}

interface DestinationWebPush {
  type: 'web-push'
}

export interface CallDetail {
  direction: SyslogCall['direction']
  selfNumber: string
  callerNumber: string
  status: SyslogCall['status']
}

type Conditions = {
  [key in keyof CallDetail]: string | undefined
}

export type IDestination = (
  | DestinationDiscordWebhook
  | DestinationDiscordBot
  | DestinationSlack
  | DestinationWebPush
) & {
  /** 宛先名 */
  name: string
  /** この宛先へ通知する条件 (正規表現) */
  condition: Conditions
}

interface Self {
  /** 自分の電話番号の名前 */
  name: string
  /** この名前に該当する条件 (正規表現) */
  condition: Conditions
}

export interface Configuration {
  /**
   * 通知先の一覧
   *
   * LINE Notify は 2025-03-31 に提供が終了したため `line-notify` は使えない。
   * 設定に残っていると起動時にエラーになるので、削除するか Discord / Slack / Web Push へ移行する。
   */
  destinations: IDestination[]
  selfs: Self[]
  router: {
    /** ルーターの IP アドレス */
    ip: string
    /** ルーターのユーザー名 */
    username: string
    /** ルーターのパスワード */
    password: string
  }
  google_search?: {
    /** Google Custom Search の API キー */
    key: string
    /** Google Custom Search の検索エンジン ID (CX) */
    cx: string
  }
  web?: {
    /** Web サーバーの認証設定 */
    auth: {
      /** Web サーバーの認証ユーザー名 */
      username: string
      /** Web サーバーの認証パスワード */
      password: string
    }
  }
}

export const isDestinationDiscordWebhook = (
  destination: any
): destination is DestinationDiscordWebhook => {
  return destination.type === 'discord-webhook' && !!destination.webhook_url
}

export const isDestinationDiscordBot = (
  destination: any
): destination is DestinationDiscordBot => {
  return (
    destination.type === 'discord-bot' &&
    !!destination.token &&
    !!destination.channel_id
  )
}

export const isDestinationSlack = (
  destination: any
): destination is DestinationSlack => {
  return destination.type === 'slack' && !!destination.webhook_url
}

export const isDestinationWebPush = (
  destination: any
): destination is DestinationWebPush => {
  return destination.type === 'web-push'
}

function checkConfig(config: any): Record<string, boolean> {
  const results = {
    'config is object': typeof config === 'object',
    'destinations is exists': !!config.destinations,
    'destinations is array':
      !!config.destinations && Array.isArray(config.destinations),
    'destinations is not empty':
      !!config.destinations && config.destinations.length > 0,
    'destinations is valid':
      !!config.destinations &&
      config.destinations.every((destination: any) => {
        return (
          isDestinationDiscordWebhook(destination) ||
          isDestinationDiscordBot(destination) ||
          isDestinationSlack(destination) ||
          isDestinationWebPush(destination)
        )
      }),
    'selfs is exists': !!config.selfs,
    'selfs is array': !!config.selfs && Array.isArray(config.selfs),
    'selfs is not empty': !!config.selfs && config.selfs.length > 0,
    'selfs is valid':
      !!config.selfs &&
      config.selfs.every((self: any) => {
        return (
          typeof self.name === 'string' && typeof self.condition === 'object'
        )
      }),
    'router is exists': !!config.router,
    'router is object': !!config.router && typeof config.router === 'object',
    'router.ip is exists': !!config.router?.ip,
    'router.ip is string':
      !!config.router?.ip && typeof config.router.ip === 'string',
    'router.username is not undefined': config.router?.username !== undefined,
    'router.password is not undefined': config.router?.password !== undefined,
  }
  return results
}

const isConfig = (config: any): config is Configuration => {
  return Object.values(checkConfig(config)).every(Boolean)
}

/**
 * 提供終了した LINE Notify の宛先が設定に残っていれば、移行案内つきのエラーを投げる
 *
 * 汎用の検証エラーでは原因が分からないため、`isConfig` の前に専用のエラーで拒否する。
 * 宛先名が空または文字列でない宛先は、配列の添字 (`#0` から) で示す。
 *
 * @param config 読み込んだ設定 (未検証)
 * @throws `line-notify` の宛先が 1 つ以上あるとき
 */
function assertNoRetiredLineNotify(config: any): void {
  if (
    typeof config !== 'object' ||
    config === null ||
    !Array.isArray(config.destinations)
  ) {
    return
  }
  const retired = config.destinations.flatMap(
    (destination: any, index: number): string[] => {
      if (
        typeof destination !== 'object' ||
        destination === null ||
        destination.type !== 'line-notify'
      ) {
        return []
      }
      const name: unknown = destination.name
      return [typeof name === 'string' && name !== '' ? name : `#${index}`]
    }
  )
  if (retired.length > 0) {
    throw new Error(
      `LINE Notify destinations are no longer supported because the service ended on 2025-03-31. Remove or replace these destinations: ${retired.join(', ')}`
    )
  }
}

/**
 * 設定ファイルを読み込んで検証する
 *
 * @param configFile 設定ファイルのパス。省略時は `PATH.CONFIG_FILE`
 * @returns 検証済みの設定
 * @throws ファイルがない、または設定が不正なとき
 */
export function loadConfig(
  configFile: string = PATH.CONFIG_FILE
): Configuration {
  if (!fs.existsSync(configFile)) {
    throw new Error('Config file not found')
  }
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  assertNoRetiredLineNotify(config)
  if (!isConfig(config)) {
    const checks = checkConfig(config)
    throw new Error(`Invalid config: ${JSON.stringify(checks, null, 2)}`)
  }
  return config
}
