import { isRecord } from './vocab.js'

/**
 * gitea.http 的纯逻辑部分：参数收窄、URL 组装、回执整形、脱敏。
 * 不访问网络、不读写磁盘——给输入看输出，测试在 tests/core.test.ts。
 * 真发请求的部分在 index.ts。
 */

/** 设置键不带分区——分区由条目 id 末段自动决定（这个插件的条目就是 gitea），settings 不收带点的键 */
export const BASE_URL_KEY = 'base-url'
export const TOKEN_KEY = 'token'
export const DEFAULT_BASE_URL = 'https://git.tianshen02.online:28377'

/** 普通调用 60s；带 file 的大文件上传 10 分钟——传到一半被超时中断比慢更糟 */
export const DEFAULT_TIMEOUT_MS = 60_000
export const FILE_TIMEOUT_MS = 600_000

/** 回执 body 超过这个字符数就截断——分页收窄是调用方的事，cookbook 里写了路 */
export const BODY_LIMIT = 64 * 1024

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
/** fetch 对这两个 method 带 body 会直接 TypeError，在收窄这层就拦下并给出看得懂的错误 */
const BODYLESS = new Set(['GET', 'HEAD'])

export interface HttpArgs {
  method: string
  path: string
  query?: Record<string, string | number | boolean>
  body?: unknown
  file?: { path: string; field?: string; name?: string }
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * path 规整：去空白、去前导斜杠、剥掉误带上的 `api/v1` 前缀（管道会补，带了就重复）。
 * 只剥一次——剥完还以 api/v1 开头的是调用方真的有这个目录，不动。
 */
export function stripPath(path: string): string {
  let p = path.trim().replace(/^\/+/, '')
  if (p.startsWith('api/v1/')) p = p.slice('api/v1/'.length)
  return p
}

/** 收窄 unknown → HttpArgs。错误文案就是用法（错误即文档），返回值形状见 Parsed */
export function parseArgs(args: unknown): Parsed<HttpArgs> {
  if (!isRecord(args)) return { ok: false, error: '参数形状是 { method, path, query?, body?, file? }——path 不带 /api/v1（管道补）' }
  const { method, path, query, body, file } = args

  if (typeof method !== 'string' || !METHODS.has(method.toUpperCase())) {
    return { ok: false, error: `method 要是 ${[...METHODS].join(' / ')} 之一（大小写随你），收到 ${String(method)}` }
  }
  const m = method.toUpperCase()

  if (typeof path !== 'string' || path.trim() === '') {
    return { ok: false, error: 'path 要是非空字符串：gitea API 路径，不带 /api/v1（管道补），如 /user/repos' }
  }

  if (query !== undefined) {
    if (!isRecord(query)) return { ok: false, error: 'query 要是对象：键 → 字符串 / 数字 / 布尔' }
    for (const [k, v] of Object.entries(query)) {
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
        return { ok: false, error: `query.${k} 要是字符串 / 数字 / 布尔，收到 ${typeof v === 'object' ? JSON.stringify(v) : String(v)}` }
      }
    }
  }

  if (BODYLESS.has(m) && (body !== undefined || file !== undefined)) {
    return { ok: false, error: `${m} 不带 body / file——fetch 会直接拒，查询条件走 query` }
  }

  if (file !== undefined) {
    if (!isRecord(file) || typeof file.path !== 'string' || file.path.trim() === '') {
      return { ok: false, error: 'file 要是 { path, field?, name? }——path 指本地文件（绝对路径稳妥，相对按内核 cwd 解）' }
    }
    if ((file.field !== undefined && typeof file.field !== 'string') || (file.name !== undefined && typeof file.name !== 'string')) {
      return { ok: false, error: 'file.field / file.name 要是字符串' }
    }
    if (body !== undefined && !isRecord(body)) {
      return { ok: false, error: '带 file 时 body 只能是对象——它会拆成 multipart 的表单字段' }
    }
  }

  return {
    ok: true,
    value: { method: m, path: stripPath(path), query: query as HttpArgs['query'], body, file: file as HttpArgs['file'] },
  }
}

/** baseUrl 规整：去尾斜杠；没写协议的当 https——祖先 god-gitea 的 https-only 不变量，继承 */
export function normalizeBase(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  return trimmed.includes('://') ? trimmed : `https://${trimmed}`
}

/** URL ＝ 规整后的 baseUrl ＋ /api/v1 ＋ path ＋ query */
export function buildUrl(baseUrl: string, path: string, query?: HttpArgs['query']): string {
  let url = `${normalizeBase(baseUrl)}/api/v1/${stripPath(path)}`
  if (query !== undefined) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) qs.append(k, String(v))
    const s = qs.toString()
    if (s !== '') url += `?${s}`
  }
  return url
}

/**
 * 回执 body 整形：超限截断（截断的 JSON 解不开，落回文本段）；JSON 的认法是
 * content-type 说 json，或（未截断时）首字符像 { / [ 且真解析得开——gitea 全线 json，
 * 文本那档留给意外。
 */
export function shapeResponse(raw: string, contentType: string | null, limit = BODY_LIMIT): { body: unknown; truncated: boolean } {
  const truncated = raw.length > limit
  const text = truncated ? raw.slice(0, limit) : raw
  if (!truncated) {
    const wantsJson = contentType?.toLowerCase().includes('json') ?? false
    const head = text.trimStart()[0]
    if (wantsJson || head === '{' || head === '[') {
      try {
        return { body: JSON.parse(text), truncated }
      } catch {
        // 解不开就落回文本——半截 JSON 与错误页都属于这一档
      }
    }
  }
  return { body: text, truncated }
}

/** 把 secret 的每次出现换成 ***——错误文案要带进回执，token 不能跟着漏出去 */
export function redact(text: string, secret: string | undefined): string {
  if (secret === undefined || secret === '') return text
  return text.split(secret).join('***')
}
