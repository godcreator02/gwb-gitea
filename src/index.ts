import fs from 'node:fs'
import path from 'node:path'
import type { GwbContext } from '@godcreator/gwb-plugin-api'
// 空的类型 import 只为让三个包的 `declare module 'cordis'` 生效，ctx 上才有 gwbCommands / gwbSettings / gwbSkills 的类型
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
 * gitea HTTP 插件（只有 node 侧）：一条 `gitea.http` 命令——把 agent 组装好的 gitea API 调用发出去。
 * 语义（配方、读法、token 用法）全在随包发的 skills/gitea/SKILL.md，代码只做管道。
 * 两项设置（base-url、token）住 gwbSettings，token 是 secret 型不随包发。
 */
export const name = 'gwb-gitea'

/** 命令登记的 plugin 字段写包名——index 回执按它归属（commands 0.4 起的规范） */
const PKG = '@godcreator/gwb-gitea'

/** 缺哪个都不加载——inject 是 cordis 的等待机制，不是建议 */
export const inject = ['gwbCommands', 'gwbSettings']

/** 说明书随包发，从产物位置反推：dist/index.js 的上一级就是 skills/ */
const SKILLS_DIR = new URL('../skills/', import.meta.url)

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function apply(ctx: GwbContext): void {
  // 日志用 ctx.logger：它的输出进日志窗格，console 的不进
  const log = ctx.logger(name)
  const commands = ctx.gwbCommands
  const settings = ctx.gwbSettings
  // inject 保证了它们在，这几句只是把类型收窄
  if (commands === undefined || settings === undefined) return
  log.info('gitea HTTP 插件已加载')

  // 说明书：**一份说明书一个子目录**（skills/gitea/SKILL.md）——gwb-skills 的收集器只扫
  // skills/ 的子目录，平铺的 SKILL.md 会被不报错地跳过（2026-09-15 实际遇到过）。
  // 局部注入——说明书插件没装，命令照常，只是 skill.list 里没这份
  ctx.inject(['gwbSkills'], (c) => {
    c.effect(() => c.gwbSkills.register(SKILLS_DIR))
  })

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

  // 命令：register 返回注销函数，包在 ctx.effect 里——条目停用时命令名也跟着注销（2026-09-09 遇到过）
  ctx.effect(() =>
    commands.register(
      {
        name: 'gitea.http',
        description: '把一条 gitea API 调用发往配置的 gitea 实例，配方与读法见 skill「gitea」',
        usage:
          '参数 { method, path, query?, body?, file? }：method 是 GET / POST / PUT / PATCH / DELETE / HEAD（大小写不限）；path 不带 /api/v1（管道补）；query 的值是字符串 / 数字 / 布尔；GET、HEAD 不带 body / file；file = { path, field?, name? } 出现即 multipart 上传（field 缺省 attachment），这时 body 只能是对象、拆成表单字段。回 { status, truncated, note?, body }——2xx/4xx/5xx 都算发出去了、解释权在调用方，body 超过 64KB 截断并带 note；没发出去才 ok: false',
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
