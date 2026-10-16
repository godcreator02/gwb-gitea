import { redact, type HttpArgs, type Parsed } from './core.js'
import { isRecord } from './vocab.js'

/** 设置键不带分区：分区由条目 id 最后一段决定，完整的名字是 gitea.github-token */
export const GITHUB_TOKEN_KEY = 'github-token'
export const PUSH_MIRROR_INTERVAL = '8h0m0s'

/** gitea 与 GitHub 的 owner 和仓名都只由这些字符组成 */
const REPO_FULL_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const PUSH_MIRROR_ARG_NAMES = new Set(['repo', 'github'])

export interface PushMirrorArgs {
  /** gitea 上的 owner/name */
  repo: string
  /** GitHub 上的 owner/name */
  github: string
}

/** gitea 回的推送镜像里不含凭据的字段，原样交回 */
export interface PushMirrorReceipt {
  repo_name: unknown
  remote_name: unknown
  remote_address: unknown
  interval: unknown
  sync_on_commit: unknown
  created: unknown
  last_update: unknown
  last_error: unknown
}

const PUSH_MIRROR_RECEIPT_FIELDS: ReadonlyArray<keyof PushMirrorReceipt> = [
  'repo_name',
  'remote_name',
  'remote_address',
  'interval',
  'sync_on_commit',
  'created',
  'last_update',
  'last_error',
]

const PUSH_MIRROR_USAGE = '参数形状是 { repo: "<gitea 上的 owner/name>", github: "<GitHub 上的 owner/name>" }'

function checkRepoFullName(argName: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || !REPO_FULL_NAME.test(value)) {
    return `${argName} 要写成 owner/name（只含字母、数字、_ . -），收到 ${JSON.stringify(value)}`
  }
  return undefined
}

export function parsePushMirrorArgs(args: unknown): Parsed<PushMirrorArgs> {
  if (!isRecord(args)) return { ok: false, error: PUSH_MIRROR_USAGE }
  const unknownArgNames = Object.keys(args).filter((argName) => !PUSH_MIRROR_ARG_NAMES.has(argName))
  if (unknownArgNames.length > 0) return { ok: false, error: `不认识参数 ${unknownArgNames.join('、')}——${PUSH_MIRROR_USAGE}` }
  const repoError = checkRepoFullName('repo', args.repo)
  if (repoError !== undefined) return { ok: false, error: repoError }
  const githubError = checkRepoFullName('github', args.github)
  if (githubError !== undefined) return { ok: false, error: githubError }
  return { ok: true, value: { repo: args.repo as string, github: args.github as string } }
}

/** GitHub 认 token 不认用户名，用户名写 GitHub 仓的 owner */
export function buildPushMirrorRequest(args: PushMirrorArgs, githubToken: string): HttpArgs {
  const githubOwner = args.github.split('/')[0]!
  return {
    method: 'POST',
    path: `repos/${args.repo}/push_mirrors`,
    body: {
      remote_address: `https://github.com/${args.github}.git`,
      remote_username: githubOwner,
      remote_password: githubToken,
      interval: PUSH_MIRROR_INTERVAL,
      sync_on_commit: true,
    },
  }
}

/** 只挑白名单里的字段；字段值里万一出现 token 也换成 ***，回执与报错不许带出 token */
export function pushMirrorReceipt(giteaBody: unknown, githubToken: string): Parsed<PushMirrorReceipt> {
  if (!isRecord(giteaBody)) {
    return { ok: false, error: redact(`gitea 回了 2xx，但 body 不是推送镜像对象：${JSON.stringify(giteaBody)}`, githubToken) }
  }
  const receipt = {} as PushMirrorReceipt
  for (const field of PUSH_MIRROR_RECEIPT_FIELDS) {
    const value = giteaBody[field]
    receipt[field] = typeof value === 'string' ? redact(value, githubToken) : value
  }
  return { ok: true, value: receipt }
}

export function describeGiteaRejection(status: number, giteaBody: unknown, githubToken: string): string {
  const giteaMessage = isRecord(giteaBody) && typeof giteaBody.message === 'string' ? giteaBody.message : JSON.stringify(giteaBody)
  return redact(`gitea 回 ${status}：${giteaMessage}`, githubToken)
}
