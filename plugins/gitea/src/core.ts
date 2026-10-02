import { isRecord } from './vocab.js'

/** 设置键不带分区：分区由条目 id 最后一段决定（本插件是 gitea），gwbSettings 不收带点的键 */
export const BASE_URL_KEY = 'base-url'
export const TOKEN_KEY = 'token'
export const DEFAULT_BASE_URL = 'https://git.tianshen02.online:28377'
/** 和 gitea 同一台机器上的推送服务 ntfy：gitea 的 webhook 发到它，订阅它就能马上知道 gitea 上的事件。本插件不用它，只替要订阅的插件存地址 */
export const PUSH_URL_KEY = 'push-url'
export const DEFAULT_PUSH_URL = 'https://ntfy.tianshen02.online:28377'

export const DEFAULT_TIMEOUT_MS = 60_000
export const FILE_TIMEOUT_MS = 600_000

export const BODY_LIMIT = 64 * 1024

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
/** fetch 对这两个 method 带 body 直接抛 TypeError */
const METHODS_WITHOUT_BODY = new Set(['GET', 'HEAD'])

export interface HttpArgs {
  method: string
  path: string
  query?: Record<string, string | number | boolean>
  body?: unknown
  file?: { path: string; field?: string; name?: string }
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

/** 只剥一次 `api/v1/`：剥完仍以它开头的，是调用方真的有这个目录 */
export function stripPath(path: string): string {
  let pathWithoutLeadingSlash = path.trim().replace(/^\/+/, '')
  if (pathWithoutLeadingSlash.startsWith('api/v1/')) pathWithoutLeadingSlash = pathWithoutLeadingSlash.slice('api/v1/'.length)
  return pathWithoutLeadingSlash
}

function describeReceivedValue(value: unknown): string {
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function isQueryValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function checkQuery(query: unknown): string | undefined {
  if (!isRecord(query)) return 'query 要是对象：键 → 字符串 / 数字 / 布尔'
  for (const [queryKey, queryValue] of Object.entries(query)) {
    if (!isQueryValue(queryValue)) return `query.${queryKey} 要是字符串 / 数字 / 布尔，收到 ${describeReceivedValue(queryValue)}`
  }
  return undefined
}

function checkFileAndBody(file: unknown, body: unknown): string | undefined {
  if (!isRecord(file) || typeof file.path !== 'string' || file.path.trim() === '') {
    return 'file 要是 { path, field?, name? }——path 指本地文件（绝对路径稳妥，相对按内核 cwd 解）'
  }
  if ((file.field !== undefined && typeof file.field !== 'string') || (file.name !== undefined && typeof file.name !== 'string')) {
    return 'file.field / file.name 要是字符串'
  }
  if (body !== undefined && !isRecord(body)) return '带 file 时 body 只能是对象——它会拆成 multipart 的表单字段'
  return undefined
}

export function parseArgs(args: unknown): Parsed<HttpArgs> {
  if (!isRecord(args)) return { ok: false, error: '参数形状是 { method, path, query?, body?, file? }——path 不带 /api/v1（管道补）' }
  const { method, path, query, body, file } = args

  if (typeof method !== 'string' || !ALLOWED_METHODS.has(method.toUpperCase())) {
    return { ok: false, error: `method 要是 ${[...ALLOWED_METHODS].join(' / ')} 之一（大小写随你），收到 ${String(method)}` }
  }
  const upperCaseMethod = method.toUpperCase()

  if (typeof path !== 'string' || path.trim() === '') {
    return { ok: false, error: 'path 要是非空字符串：gitea API 路径，不带 /api/v1（管道补），如 /user/repos' }
  }

  if (query !== undefined) {
    const queryError = checkQuery(query)
    if (queryError !== undefined) return { ok: false, error: queryError }
  }

  if (METHODS_WITHOUT_BODY.has(upperCaseMethod) && (body !== undefined || file !== undefined)) {
    return { ok: false, error: `${upperCaseMethod} 不带 body / file——fetch 会直接拒，查询条件走 query` }
  }

  if (file !== undefined) {
    const fileError = checkFileAndBody(file, body)
    if (fileError !== undefined) return { ok: false, error: fileError }
  }

  return {
    ok: true,
    value: { method: upperCaseMethod, path: stripPath(path), query: query as HttpArgs['query'], body, file: file as HttpArgs['file'] },
  }
}

/** 没写协议的当 https */
export function normalizeBase(baseUrl: string): string {
  const baseUrlWithoutTrailingSlash = baseUrl.trim().replace(/\/+$/, '')
  return baseUrlWithoutTrailingSlash.includes('://') ? baseUrlWithoutTrailingSlash : `https://${baseUrlWithoutTrailingSlash}`
}

export function buildUrl(baseUrl: string, path: string, query?: HttpArgs['query']): string {
  let url = `${normalizeBase(baseUrl)}/api/v1/${stripPath(path)}`
  if (query !== undefined) {
    const searchParams = new URLSearchParams()
    for (const [queryKey, queryValue] of Object.entries(query)) searchParams.append(queryKey, String(queryValue))
    const queryString = searchParams.toString()
    if (queryString !== '') url += `?${queryString}`
  }
  return url
}

function looksLikeJson(text: string, contentType: string | null): boolean {
  const contentTypeSaysJson = contentType?.toLowerCase().includes('json') ?? false
  const firstNonSpaceChar = text.trimStart()[0]
  return contentTypeSaysJson || firstNonSpaceChar === '{' || firstNonSpaceChar === '['
}

export function shapeResponse(raw: string, contentType: string | null, limit = BODY_LIMIT): { body: unknown; truncated: boolean } {
  const truncated = raw.length > limit
  const text = truncated ? raw.slice(0, limit) : raw
  if (!truncated && looksLikeJson(text, contentType)) {
    try {
      return { body: JSON.parse(text), truncated }
    } catch {
      // 解不开的 JSON 与错误页都按文本交回
    }
  }
  return { body: text, truncated }
}

/** 错误文案要带进回执，token 的每次出现都换成 *** */
export function redact(text: string, secret: string | undefined): string {
  if (secret === undefined || secret === '') return text
  return text.split(secret).join('***')
}
