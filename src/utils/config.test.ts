import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { loadConfig } from './config'

const MESSAGE_PREFIX =
  'LINE Notify destinations are no longer supported because the service ended on 2025-03-31. Remove or replace these destinations: '

const baseConfig = {
  selfs: [{ name: 'self', condition: {} }],
  router: { ip: '192.0.2.1', username: 'user', password: 'pass' },
}

describe('loadConfig', () => {
  let directory: string
  let configPath: string

  /**
   * 一時ファイルに設定を書き出し、`loadConfig()` の結果を返す
   *
   * @param config 設定ファイルの内容
   */
  const load = (config: unknown): unknown => {
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf8')
    return loadConfig(configPath)
  }

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'telcheck-config-'))
    configPath = path.join(directory, 'config.json')
  })

  after(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('line-notify 宛先を宛先名つきのエラーで拒否する', () => {
    assert.throws(
      () =>
        load({
          ...baseConfig,
          destinations: [
            {
              type: 'line-notify',
              token: 'FAKE-LINE-TOKEN',
              name: 'old-line',
              condition: {},
            },
          ],
        }),
      { message: `${MESSAGE_PREFIX}old-line` }
    )
  })

  it('宛先名がない line-notify 宛先は添字で示し、出現順に連結する', () => {
    assert.throws(
      () =>
        load({
          ...baseConfig,
          destinations: [
            { type: 'line-notify', token: 'FAKE-LINE-TOKEN-A', name: 'first' },
            null,
            { type: 'web-push', name: 'push', condition: {} },
            { type: 'line-notify', token: 'FAKE-LINE-TOKEN-B' },
          ],
        }),
      { message: `${MESSAGE_PREFIX}first, #3` }
    )
  })

  it('エラーメッセージにトークンを含めない', () => {
    assert.throws(
      () =>
        load({
          ...baseConfig,
          destinations: [
            { type: 'line-notify', token: 'FAKE-LINE-TOKEN', name: 'x' },
          ],
        }),
      (error: Error) => !error.message.includes('FAKE-LINE-TOKEN')
    )
  })

  it('line-notify を含まない有効な設定は読み込める', () => {
    const config = {
      ...baseConfig,
      destinations: [{ type: 'web-push', name: 'push', condition: {} }],
    }
    assert.deepEqual(load(config), config)
  })
})
