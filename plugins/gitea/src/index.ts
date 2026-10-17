import fs from 'node:fs'
import path from 'node:path'
import type { GwbContext } from '@godcreator/gwb-kernel-desktop'
// 空的类型 import 只为让三个包的 `declare module 'cordis'` 生效，ctx 上才有 gwbCommands / gwbSettings / gwbSkills 的类型
import type {} from '@godcreator/gwb-commands'
import type {} from '@godcreator/gwb-settings'
import type {} from '@godcreator/gwb-skills'
import {
  BASE_URL_KEY,
  DEFAULT_BASE_URL,
  DEFAULT_PUSH_URL,
  DEFAULT_TIMEOUT_MS,
  FILE_TIMEOUT_MS,
  PUSH_URL_KEY,
  TOKEN_KEY,
  buildUrl,
  parseArgs,
  redact,
  shapeResponse,
  type HttpArgs,
} from './core.js'
import {
  GITHUB_TOKEN_KEY,
  buildPushMirrorRequest,
  describeGiteaRejection,
  parsePushMirrorArgs,
  pushMirrorReceipt,
  type PushMirrorReceipt,
} from './push-mirror.js'
import { GiteaService, type GiteaConnection, type GiteaSendResult, type GwbGiteaApi } from './service.js'

/** 写在包入口：devkit.release 只读类型入口 dist/index.d.ts 认服务由谁提供 */
declare module 'cordis' {
  interface Context {
    gwbGitea?: GwbGiteaApi
  }
}

export type { GiteaConnection, GiteaResponse, GwbGiteaApi } from './service.js'
export type { HttpArgs } from './core.js'

export const name = 'gwb-gitea'

export const inject = ['gwbCommands', 'gwbSettings']

/** 产物在 dist/index.js，说明书目录是它上一级的 skills/；gwbSkills 只扫这个目录的子目录，平铺的 SKILL.md 不报错地被跳过 */
const SKILLS_DIR = new URL('../skills/', import.meta.url)

type PluginLogger = ReturnType<GwbContext['logger']>

interface OutgoingPayload {
  headers: Record<string, string>
  payload: FormData | string | undefined
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function buildMultipartForm(formFields: unknown, file: NonNullable<HttpArgs['file']>): FormData {
  const form = new FormData()
  if (formFields !== undefined) {
    for (const [fieldName, fieldValue] of Object.entries(formFields as Record<string, unknown>)) {
      form.append(fieldName, typeof fieldValue === 'string' ? fieldValue : JSON.stringify(fieldValue))
    }
  }
  form.append(file.field ?? 'attachment', new Blob([fs.readFileSync(file.path)]), file.name ?? path.basename(file.path))
  return form
}

function buildOutgoingPayload(request: HttpArgs): OutgoingPayload {
  if (request.file !== undefined) return { headers: {}, payload: buildMultipartForm(request.body, request.file) }
  if (request.body !== undefined) return { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(request.body) }
  return { headers: {}, payload: undefined }
}

function describeTruncation(truncated: boolean): { note?: string } {
  return truncated ? { note: 'body 超过 64KB 被截断——用 query 收窄（分页 page/limit）再取' } : {}
}

async function sendToGitea(request: HttpArgs, baseUrl: string, token: string, log: PluginLogger) {
  const url = buildUrl(baseUrl, request.path, request.query)
  const isFileUpload = request.file !== undefined
  try {
    const { headers, payload } = buildOutgoingPayload(request)
    if (token !== '') headers.authorization = `token ${token}`

    const response = await fetch(url, {
      method: request.method,
      headers,
      body: payload,
      signal: AbortSignal.timeout(isFileUpload ? FILE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS),
    })
    const shaped = shapeResponse(await response.text(), response.headers.get('content-type'))
    log.info(`${request.method} ${request.path} → ${response.status}${shaped.truncated ? '（body 截断）' : ''}`)
    return {
      ok: true as const,
      data: { status: response.status, truncated: shaped.truncated, ...describeTruncation(shaped.truncated), body: shaped.body },
    }
  } catch (err) {
    const redactedMessage = redact(err instanceof Error ? (err.stack ?? err.message) : String(err), token)
    return {
      ok: false as const,
      error: `没发出去：${redactedMessage}——网络通不通？gitea.base-url（现为 ${baseUrl}）与 gitea.token 配了没？file.path 要指向盘上真有的文件`,
    }
  }
}

export function apply(ctx: GwbContext): void {
  // 日志用 ctx.logger：它的输出进日志窗格，console 的不进
  const log = ctx.logger(name)
  const commands = ctx.gwbCommands
  const settings = ctx.gwbSettings
  // 命令总线在类型上是可选的（内核也声明了它）；inject 保证了它在，不在就是加载顺序出了错
  if (commands === undefined) throw new Error('ctx.gwbCommands 不在：inject 里写了它，cordis 本不该调用 apply')
  log.info('gitea HTTP 插件已加载')

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
    key: PUSH_URL_KEY,
    title: 'gitea 的推送地址',
    type: 'string',
    description: '和 gitea 同一台机器上的推送服务 ntfy，协议://主机:口，不带路径；gitea 的 webhook 发到它，要马上知道 gitea 上事件的插件（如 gwb-collab）订阅它。换 gitea 实例时和地址一起改',
    default: DEFAULT_PUSH_URL,
  })
  settings.define({
    key: TOKEN_KEY,
    title: 'gitea token',
    type: 'secret',
    description: 'gitea 网页上生成的 API token（建议只给 api scope）；只放进请求头 Authorization 发出，日志不记它；请求没发出去时，报错文字里的 token 换成 ***；gitea 正常返回的 body 原样交回',
    default: '',
  })
  settings.define({
    key: GITHUB_TOKEN_KEY,
    title: 'GitHub token（推送镜像用）',
    type: 'secret',
    description:
      '命令 gitea.push-mirror.add 开推送镜像时交给 gitea，gitea 用它把仓推到 GitHub。fine-grained token：仓库范围只选 godcreator02 名下要镜像的仓，权限 Contents 读写；或经典 token 勾 repo。只能在这里手动填，命令的参数、回执、日志都不带它',
    default: '',
  })

  const connection = (): GiteaConnection => ({
    baseUrl: stringOrEmpty(settings.get(BASE_URL_KEY)) || DEFAULT_BASE_URL,
    pushUrl: stringOrEmpty(settings.get(PUSH_URL_KEY)) || DEFAULT_PUSH_URL,
    token: stringOrEmpty(settings.get(TOKEN_KEY)),
  })
  const send = async (args: unknown): Promise<GiteaSendResult> => {
    const parsed = parseArgs(args)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const { baseUrl, token } = connection()
    return sendToGitea(parsed.value, baseUrl, token, log)
  }
  new GiteaService(ctx, send, connection)

  const addPushMirror = async (args: unknown): Promise<{ ok: true; data: PushMirrorReceipt } | { ok: false; error: string }> => {
    const parsed = parsePushMirrorArgs(args)
    if (!parsed.ok) return parsed
    const githubToken = stringOrEmpty(settings.get(GITHUB_TOKEN_KEY))
    if (githubToken === '') {
      return { ok: false, error: `GitHub token 没配：请用户在工作台设置界面的 gitea 分区填「GitHub token（推送镜像用）」（gitea.${GITHUB_TOKEN_KEY}），填好再调` }
    }
    const { baseUrl, token } = connection()
    const sent = await sendToGitea(buildPushMirrorRequest(parsed.value, githubToken), baseUrl, token, log)
    if (!sent.ok) return { ok: false, error: redact(sent.error, githubToken) }
    const { status, body } = sent.data
    if (status < 200 || status >= 300) return { ok: false, error: describeGiteaRejection(status, body, githubToken) }
    const receipt = pushMirrorReceipt(body, githubToken)
    return receipt.ok ? { ok: true, data: receipt.value } : receipt
  }

  commands.register(
    {
      name: 'gitea.http',
      description: '把一条 gitea API 调用发往配置的 gitea 实例，调用写法与回执读法见 skill「gitea」',
      usage:
        '参数 { method, path, query?, body?, file? }：method 是 GET / POST / PUT / PATCH / DELETE / HEAD（大小写不限）；path 不带 /api/v1（插件补上）；query 的值是字符串 / 数字 / 布尔；GET、HEAD 不带 body / file；file = { path, field?, name? } 出现即 multipart 上传（field 缺省 attachment），这时 body 只能是对象、拆成表单字段。回 { status, truncated, note?, body }——2xx/4xx/5xx 都算发出去了、解释权在调用方，body 超过 64KB 截断并带 note；没发出去才 ok: false',
      effect: 'external',
    },
    (args: unknown) => send(args),
  )

  commands.register(
    {
      name: 'gitea.push-mirror.add',
      description: '给 gitea 上的仓开一条推送镜像，同步到 GitHub 上的仓；GitHub token 取自设置 gitea.github-token，不经参数。写法见 skill「gitea」的「开推送镜像」',
      usage:
        '参数 { repo, github }：repo 是 gitea 上的 owner/name，github 是 GitHub 上的 owner/name，不收别的参数。GitHub token 由用户在设置界面填进 gitea.github-token，没配直接报错。镜像每小时同步一次，gitea 上每次推送后也同步。回 { repo_name, remote_name, remote_address, interval, sync_on_commit, created, last_update, last_error }，不含 token；gitea 回非 2xx 报错，带状态码与 gitea 的 message',
      effect: 'external',
    },
    (args: unknown) => addPushMirror(args),
  )
}
