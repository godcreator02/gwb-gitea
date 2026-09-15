import fs from 'node:fs'
import path from 'node:path'
import { type GwbContext } from '@godcreator/gwb-plugin-api'
// 只为激活 declare module 'cordis'——ctx 上由此长出 gwbCommands / gwbSettings / gwbSkills
import type {} from '@godcreator/gwb-commands'
import type {} from '@godcreator/gwb-settings'
import type {} from '@godcreator/gwb-skills'
import {
  BASE_URL_KEY,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  FILE_TIMEOUT_MS,
  TOKEN_KEY,
  buildUrl,
  parseArgs,
  redact,
  shapeResponse,
} from './core.js'

/**
 * gitea 的手 node 半：一条 `gitea.http` 命令——把 agent 组装好的 gitea API 调用发出去。
 * 语义（配方、读法、token 仪式）全住随包发的 skills/SKILL.md，代码只做管道。
 * 两项设置（base-url、token）住 gwbSettings，token 是 secret 型不随包发。
 */
export const name = 'gwb-gitea'

/** 命令登记的 plugin 字段写包名——index 回执按它归属（commands 0.4 起的规范） */
const PKG = '@godcreator/gwb-gitea'

/** 缺哪个都不挂——inject 是 cordis 的等待机制，不是建议。gwbSkills 也硬依赖：
 *  ctx.inject 的回调在「服务已就绪 + loader 子树热挂」的组合下不触发（2026-09-15 实弹撞的），
 *  硬依赖让 cordis 替我们等到位、apply 里直取直注册，绕开那层调度 */
export const inject = ['gwbCommands', 'gwbSettings', 'gwbSkills']

/** 说明书随包发，从产物位置反推：dist/index.js 的上一级就是 skills/ */
const SKILLS_DIR = new URL('../skills/', import.meta.url)

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function apply(ctx: GwbContext): void {
  // 件说话的正规出口：logger 进得了日志窗格，console 进不了
  const log = ctx.logger(name)
  const commands = ctx.gwbCommands
  const settings = ctx.gwbSettings
  const skills = ctx.gwbSkills
  // inject 保证了它们在，这几句只是把类型收窄
  if (commands === undefined || settings === undefined || skills === undefined) return
  log.info('gitea 的手 起来了')

  // 说明书：目录从产物位置反推（dist/index.js 的上一级就是 skills/）
  ctx.effect(() => skills.register(SKILLS_DIR))

  settings.define({
    key: BASE_URL_KEY,
    title: 'gitea 地址',
    type: 'string',
    description: '协议://主机:口，不带路径；没写协议的当 https',
    default: DEFAULT_BASE_URL,
  })
  settings.define({
    key: TOKEN_KEY,
    title: 'gitea token',
    type: 'secret',
    description: 'gitea 网页上开的 api token（建议只给 api scope）；管道注入 Authorization，回执与日志里脱敏',
    default: '',
  })

  // 命令面：register 回注销函数，包在 ctx.effect 里——条目停了名字也跟着摘（2026-09-09 撞过）
  ctx.effect(() =>
    commands.register(
      {
        name: 'gitea.http',
        description:
          '把一条 gitea API 调用发出去：{ method, path, query?, body?, file? }——path 不带 /api/v1（管道补）；回 { status, body, truncated? }，2xx/4xx/5xx 都算发出去了、解释权在调用方；file={ path, field?, name? } 出现即 multipart（上传产物用）。配方与读法见 skill「gitea」',
        plugin: PKG,
      },
      async (args: unknown) => {
        const parsed = parseArgs(args)
        if (!parsed.ok) return { ok: false as const, error: parsed.error }

        const a = parsed.value
        const baseUrl = asString(settings.get(BASE_URL_KEY)) || DEFAULT_BASE_URL
        const token = asString(settings.get(TOKEN_KEY))
        const url = buildUrl(baseUrl, a.path, a.query)
        const hasFile = a.file !== undefined

        const headers: Record<string, string> = {}
        let payload: FormData | string | undefined
        try {
          if (hasFile) {
            const fd = new FormData()
            if (a.body !== undefined) {
              for (const [k, v] of Object.entries(a.body as Record<string, unknown>)) {
                fd.append(k, typeof v === 'string' ? v : JSON.stringify(v))
              }
            }
            const f = a.file!
            fd.append(f.field ?? 'attachment', new Blob([fs.readFileSync(f.path)]), f.name ?? path.basename(f.path))
            payload = fd
          } else if (a.body !== undefined) {
            headers['content-type'] = 'application/json'
            payload = JSON.stringify(a.body)
          }
          if (token !== '') headers.authorization = `token ${token}`

          const res = await fetch(url, {
            method: a.method,
            headers,
            body: payload,
            signal: AbortSignal.timeout(hasFile ? FILE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS),
          })
          const text = await res.text()
          const shaped = shapeResponse(text, res.headers.get('content-type'))
          log.info(`${a.method} ${a.path} → ${res.status}${shaped.truncated ? '（body 截断）' : ''}`)
          return {
            ok: true as const,
            data: {
              status: res.status,
              truncated: shaped.truncated,
              ...(shaped.truncated ? { note: 'body 超过 64KB 被截断——用 query 收窄（分页 page/limit）再取' } : {}),
              body: shaped.body,
            },
          }
        } catch (err) {
          const msg = redact(err instanceof Error ? (err.stack ?? err.message) : String(err), token)
          return {
            ok: false as const,
            error: `没发出去：${msg}——网络通不通？gitea.base-url（现为 ${baseUrl}）与 gitea.token 配了没？file.path 要指向盘上真有的文件`,
          }
        }
      },
    ),
  )
}
