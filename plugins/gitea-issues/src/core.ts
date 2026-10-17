/** issue 从哪个站来：gitea 是主仓，GitHub 上是推送镜像出去的公开仓 */
export type IssueSource = 'gitea' | 'github'

export const SOURCE_LABEL: Record<IssueSource, string> = { gitea: 'gitea', github: 'GitHub' }

/** 两边的合并请求都是一条 issue：编号、评论接口共用，`pull_request` 字段不为空的就是合并请求 */
export type IssueKind = 'issue' | 'pull'

/** issue 或合并请求的一行：窗格、命令回执与 QQ 通知共用这一份形状 */
export interface IssueRow {
  source: IssueSource
  /** `<owner>/<仓名>` */
  repo: string
  kind: IssueKind
  number: number
  title: string
  author: string
  createdAt: string
  updatedAt: string
  commentCount: number
  url: string
}

export interface IssueComment {
  author: string
  body: string
  createdAt: string
}

/** 合并请求关掉时合进去了算 merged */
export type IssueState = 'open' | 'closed' | 'merged'

export interface IssueDetail extends IssueRow {
  state: IssueState
  body: string
  comments: IssueComment[]
}

/** 一个 owner 上次查到的状态：每条开着的 issue 记评论数，键是 `<owner>/<仓名>#<编号>`；polledAt 是那一次开始查的时间 */
export interface OwnerSeen {
  polledAt: string
  issues: Record<string, number>
}

/** 键是 ownerKey；没有这个键的 owner 是第一次看 */
export type SeenState = Record<string, OwnerSeen>

export type IssueChangeKind = 'opened' | 'reopened' | 'commented' | 'closed' | 'merged'

export interface IssueChange {
  kind: IssueChangeKind
  issue: IssueRow
  /** commented 才有：上次看到的评论数，新评论是它之后的那几条 */
  previousCommentCount?: number
}

export const KIND_LABEL: Record<IssueKind, string> = { issue: 'issue', pull: '合并请求' }

/** QQ 私聊正文的上限，与 gwbQqBot.notify 的上限一致 */
export const NOTICE_MAX_CHARS = 5000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(record: Record<string, unknown>, key: string, what: string): string {
  const value = record[key]
  if (typeof value !== 'string') throw new Error(`回执里的${what}缺字段 ${key}（或不是字符串）`)
  return value
}

function requireNumber(record: Record<string, unknown>, key: string, what: string): number {
  const value = record[key]
  if (typeof value !== 'number') throw new Error(`回执里的${what}缺字段 ${key}（或不是数字）`)
  return value
}

function loginOf(record: Record<string, unknown>, what: string): string {
  const user = record['user']
  if (!isRecord(user)) throw new Error(`回执里的${what}缺字段 user`)
  return requireString(user, 'login', `${what}的 user`)
}

/** GitHub 的搜索结果只有 `repository_url`（`https://api.github.com/repos/<owner>/<仓名>`），gitea 的有 `repository.full_name` */
function repoOfSearchItem(source: IssueSource, raw: Record<string, unknown>): string {
  if (source === 'gitea') {
    const repository = raw['repository']
    if (!isRecord(repository)) throw new Error('gitea 回的 issue 缺字段 repository')
    return requireString(repository, 'full_name', 'issue 的 repository')
  }
  const match = /\/repos\/([^/]+\/[^/]+)$/.exec(requireString(raw, 'repository_url', 'issue'))
  if (match === null) throw new Error(`GitHub 回的 repository_url 不是 …/repos/<owner>/<仓名>：${String(raw['repository_url'])}`)
  return match[1]!
}

/** 搜索接口回执里的一项 → IssueRow；形状不对直接报错 */
export function issueRowFromSearch(source: IssueSource, raw: unknown): IssueRow {
  if (!isRecord(raw)) throw new Error(`${SOURCE_LABEL[source]} 回的 issue 不是对象`)
  return { source, repo: repoOfSearchItem(source, raw), ...issueFields(raw) }
}

/**
 * 读一条 issue 的回执没有仓名，由调用方给。
 * GitHub 的 body 没写正文时是 null（接口文档如此），gitea 是空串
 */
export function issueDetailFromApi(source: IssueSource, repo: string, raw: unknown, rawComments: unknown[]): IssueDetail {
  if (!isRecord(raw)) throw new Error(`${SOURCE_LABEL[source]} 回的 issue 不是对象`)
  const body = source === 'github' && raw['body'] === null ? '' : requireString(raw, 'body', 'issue')
  return {
    source,
    repo,
    ...issueFields(raw),
    state: issueStateOf(source, raw),
    body,
    comments: rawComments.map(commentFromApi),
  }
}

function issueFields(raw: Record<string, unknown>): Omit<IssueRow, 'source' | 'repo'> {
  return {
    kind: raw['pull_request'] === null || raw['pull_request'] === undefined ? 'issue' : 'pull',
    number: requireNumber(raw, 'number', 'issue'),
    title: requireString(raw, 'title', 'issue'),
    author: loginOf(raw, 'issue'),
    createdAt: requireString(raw, 'created_at', 'issue'),
    updatedAt: requireString(raw, 'updated_at', 'issue'),
    commentCount: requireNumber(raw, 'comments', 'issue'),
    url: requireString(raw, 'html_url', 'issue'),
  }
}

/** 合进去了：gitea 看 `pull_request.merged`，GitHub 看 `pull_request.merged_at` 不为空 */
function issueStateOf(source: IssueSource, raw: Record<string, unknown>): IssueState {
  const state = requireString(raw, 'state', 'issue')
  if (state === 'open') return 'open'
  if (state !== 'closed') throw new Error(`${SOURCE_LABEL[source]} 回的 issue state 是 ${state}，只认 open、closed`)
  const pull = raw['pull_request']
  if (!isRecord(pull)) return 'closed'
  const merged = source === 'gitea' ? pull['merged'] === true : typeof pull['merged_at'] === 'string'
  return merged ? 'merged' : 'closed'
}

export function commentFromApi(raw: unknown): IssueComment {
  if (!isRecord(raw)) throw new Error('回执里的评论不是对象')
  return {
    author: loginOf(raw, '评论'),
    body: requireString(raw, 'body', '评论'),
    createdAt: requireString(raw, 'created_at', '评论'),
  }
}

/** 窗格与通知 id 里认一条 issue：两边的 owner 可能同名，所以带上来源 */
export function issueKey(issue: Pick<IssueRow, 'source' | 'repo' | 'number'>): string {
  return `${issue.source}:${issue.repo}#${issue.number}`
}

export function ownerKey(source: IssueSource, owner: string): string {
  return `${source}:${owner}`
}

function seenKey(issue: Pick<IssueRow, 'repo' | 'number'>): string {
  return `${issue.repo}#${issue.number}`
}

function parseSeenKey(key: string): { repo: string; number: number } {
  const at = key.lastIndexOf('#')
  return { repo: key.slice(0, at), number: Number(key.slice(at + 1)) }
}

export interface OwnerComparison {
  changes: IssueChange[]
  /** 上次开着、这次不在列表里的：关了、删了或转走了，由调用方读一次那条 issue 再定 */
  disappeared: Array<{ repo: string; number: number }>
  next: OwnerSeen
}

/**
 * 一个 owner 这次查到的开着的 issue 跟上次比。`previous` 是 undefined 表示第一次看这个 owner：
 * 只记下现状、不算变化，免得刚装上或刚加 owner 时把已有的全推一遍。
 * 上次没有的编号，创建时间晚于上次开始查的时间算新开的，早于的是关了又重新打开的
 */
export function compareOwner(previous: OwnerSeen | undefined, current: readonly IssueRow[], polledAt: string): OwnerComparison {
  const issues: Record<string, number> = {}
  for (const issue of current) issues[seenKey(issue)] = issue.commentCount
  const next = { polledAt, issues }
  if (previous === undefined) return { changes: [], disappeared: [], next }

  const changes: IssueChange[] = []
  for (const issue of current) {
    const before = previous.issues[seenKey(issue)]
    if (before === undefined) {
      changes.push({ kind: Date.parse(issue.createdAt) > Date.parse(previous.polledAt) ? 'opened' : 'reopened', issue })
    } else if (issue.commentCount > before) {
      changes.push({ kind: 'commented', issue, previousCommentCount: before })
    }
  }
  const disappeared = Object.keys(previous.issues).filter((key) => !(key in issues)).map(parseSeenKey)
  return { changes, disappeared, next }
}

/** 同一条变化只推一次：qq-bot 按 id 去重。新评论按评论数区分，新开按创建时间，重开、关闭、合并按更新时间 */
export function noticeId(change: IssueChange): string {
  const { issue } = change
  const marker = change.kind === 'commented' ? String(issue.commentCount)
    : change.kind === 'opened' ? issue.createdAt
    : issue.updatedAt
  return `gitea-issues:${issueKey(issue)}:${change.kind}:${marker}`
}

const CHANGE_LABEL: Record<IssueChangeKind, string> = {
  opened: '新', reopened: '重新打开', commented: '新评论', closed: '已关闭', merged: '已合并',
}

function headLine(change: IssueChange): string {
  const { issue } = change
  const label = change.kind === 'opened' ? `新${issue.kind === 'pull' ? '合并请求' : ' issue'}` : CHANGE_LABEL[change.kind]
  const kindNote = issue.kind === 'pull' && change.kind !== 'opened' && change.kind !== 'merged' ? '（合并请求）' : ''
  return `**${label}** · ${SOURCE_LABEL[issue.source]} · ${issue.repo} #${issue.number}${kindNote}`
}

export function formatNoticeTime(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 新开的写正文，新评论写上次之后的每一条，重开、关闭、合并只写一行时间 */
function noticeBody(change: IssueChange, detail: IssueDetail): string {
  if (change.kind === 'opened') {
    const meta = `${detail.author} · ${formatNoticeTime(detail.createdAt)}`
    return detail.body.trim() === '' ? meta : `${meta}\n\n${detail.body.trim()}`
  }
  if (change.kind === 'commented') {
    return detail.comments.slice(change.previousCommentCount)
      .map((comment) => `**${comment.author}** · ${formatNoticeTime(comment.createdAt)}\n\n${comment.body.trim()}`)
      .join('\n\n---\n\n')
  }
  return `更新于 ${formatNoticeTime(detail.updatedAt)}`
}

const TRUNCATED_NOTE = '\n\n……（太长，后面的到窗格里看）'

/** 截断落在代码块中间时补上收尾的 ```，不然后面的字全按代码渲染 */
function closeOpenFence(text: string): string {
  const fences = text.match(/^\s*```/gm)?.length ?? 0
  return fences % 2 === 1 ? `${text}\n\`\`\`` : text
}

/**
 * 给手机看的通知正文，按 markdown 写，原文的排版保留。链接不写：QQ 会过滤没在开放平台报备的域名。
 * `detail` 是这条 issue 现在的正文与评论
 */
export function noticeText(change: IssueChange, detail: IssueDetail): string {
  const head = `${headLine(change)}\n### ${change.issue.title}`
  const body = noticeBody(change, detail)
  const full = body === '' ? head : `${head}\n${body}`
  if (full.length <= NOTICE_MAX_CHARS) return full
  // 留出截断说明与补的 ``` 的位置
  const kept = full.slice(0, NOTICE_MAX_CHARS - TRUNCATED_NOTE.length - 4)
  return `${closeOpenFence(kept)}${TRUNCATED_NOTE}`
}

/** 命令参数里的仓：`<owner>/<仓名>`，两段都非空、不含别的斜杠 */
export function parseRepo(value: unknown): { owner: string; name: string } {
  if (typeof value !== 'string') throw new Error('repo 要写成字符串 "<owner>/<仓名>"')
  const parts = value.split('/')
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') throw new Error(`repo 要写成 "<owner>/<仓名>"，收到 "${value}"`)
  return { owner: parts[0]!, name: parts[1]! }
}

export function parseSource(value: unknown): IssueSource {
  if (value === 'gitea' || value === 'github') return value
  throw new Error(`source 要写 "gitea" 或 "github"，收到 ${JSON.stringify(value)}`)
}

/** 按来源与仓分组，组内按最近更新排在前面，组按组里最近一次更新排序 */
export function groupByRepo(issues: readonly IssueRow[]): Array<{ source: IssueSource; repo: string; issues: IssueRow[] }> {
  const groups = new Map<string, { source: IssueSource; repo: string; issues: IssueRow[] }>()
  for (const issue of issues) {
    const key = `${issue.source}:${issue.repo}`
    const group = groups.get(key) ?? { source: issue.source, repo: issue.repo, issues: [] }
    group.issues.push(issue)
    groups.set(key, group)
  }
  const byUpdatedDesc = (a: IssueRow, b: IssueRow): number => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  return [...groups.values()]
    .map((group) => ({ ...group, issues: group.issues.sort(byUpdatedDesc) }))
    .sort((a, b) => byUpdatedDesc(a.issues[0]!, b.issues[0]!))
}
