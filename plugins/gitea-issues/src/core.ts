/** gitea 里合并请求也是一条 issue：编号、评论接口共用，`pull_request` 字段不为空的就是合并请求 */
export type IssueKind = 'issue' | 'pull'

/** issue 或合并请求的一行：窗格、命令回执与 QQ 通知共用这一份形状 */
export interface IssueRow {
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

export interface IssueDetail extends IssueRow {
  body: string
  comments: IssueComment[]
}

/** 每条 open issue 上次看到的评论数，键是 `<owner>/<仓名>#<编号>` */
export type SeenIssues = Record<string, number>

export interface IssueChange {
  kind: 'opened' | 'commented'
  issue: IssueRow
}

export const KIND_LABEL: Record<IssueKind, string> = { issue: 'issue', pull: '合并请求' }

/** QQ 私聊正文的上限，与 gwbQqBot.notify 的上限一致 */
export const NOTICE_MAX_CHARS = 600

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(record: Record<string, unknown>, key: string, what: string): string {
  const value = record[key]
  if (typeof value !== 'string') throw new Error(`gitea 回的${what}缺字段 ${key}（或不是字符串）`)
  return value
}

function requireNumber(record: Record<string, unknown>, key: string, what: string): number {
  const value = record[key]
  if (typeof value !== 'number') throw new Error(`gitea 回的${what}缺字段 ${key}（或不是数字）`)
  return value
}

function loginOf(record: Record<string, unknown>, what: string): string {
  const user = record['user']
  if (!isRecord(user)) throw new Error(`gitea 回的${what}缺字段 user`)
  return requireString(user, 'login', `${what}的 user`)
}

/** `GET /repos/issues/search` 回执里的一项 → IssueRow；形状不对直接报错 */
export function issueRowFromSearch(raw: unknown): IssueRow {
  if (!isRecord(raw)) throw new Error('gitea 回的 issue 不是对象')
  const repository = raw['repository']
  if (!isRecord(repository)) throw new Error('gitea 回的 issue 缺字段 repository')
  return {
    repo: requireString(repository, 'full_name', 'issue 的 repository'),
    ...issueFields(raw),
  }
}

/** `GET /repos/{owner}/{repo}/issues/{number}` 的回执没有 repository 字段，仓名由调用方给 */
export function issueDetailFromGitea(repo: string, raw: unknown, rawComments: unknown[]): IssueDetail {
  if (!isRecord(raw)) throw new Error('gitea 回的 issue 不是对象')
  return {
    repo,
    ...issueFields(raw),
    body: requireString(raw, 'body', 'issue'),
    comments: rawComments.map(commentFromGitea),
  }
}

function issueFields(raw: Record<string, unknown>): Omit<IssueRow, 'repo'> {
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

export function commentFromGitea(raw: unknown): IssueComment {
  if (!isRecord(raw)) throw new Error('gitea 回的评论不是对象')
  return {
    author: loginOf(raw, '评论'),
    body: requireString(raw, 'body', '评论'),
    createdAt: requireString(raw, 'created_at', '评论'),
  }
}

export function issueKey(issue: Pick<IssueRow, 'repo' | 'number'>): string {
  return `${issue.repo}#${issue.number}`
}

/**
 * 跟上次看到的比，算出新开的 issue 与评论数变多的 issue，并给出这次要记下的评论数。
 * `seen` 是 null 表示第一次看：只记下现状、不算变化，免得开启时把已有的 issue 全推一遍
 */
export function changesSince(seen: SeenIssues | null, current: readonly IssueRow[]): { changes: IssueChange[]; seen: SeenIssues } {
  const nextSeen: SeenIssues = {}
  const changes: IssueChange[] = []
  for (const issue of current) {
    const key = issueKey(issue)
    nextSeen[key] = issue.commentCount
    if (seen === null) continue
    const before = seen[key]
    if (before === undefined) changes.push({ kind: 'opened', issue })
    else if (issue.commentCount > before) changes.push({ kind: 'commented', issue })
  }
  return { changes, seen: nextSeen }
}

/** 同一条变化只推一次：qq-bot 按 id 去重，评论数进 id，再来一条评论就是新的一条 */
export function noticeId(change: IssueChange): string {
  return `gitea-issues:${issueKey(change.issue)}:${change.kind}:${change.issue.commentCount}`
}

/**
 * 给手机看的通知正文。链接不写：QQ 会过滤没在开放平台报备的域名。
 * `excerpt` 是新 issue 的正文或最新一条评论，`excerptAuthor` 是评论的作者
 */
export function noticeText(change: IssueChange, excerpt: string, excerptAuthor: string): string {
  const head = change.kind === 'opened'
    ? `${change.issue.repo} ${change.issue.kind === 'pull' ? '新合并请求' : '新 issue'} #${change.issue.number}（${change.issue.author}）：${change.issue.title}`
    : `${change.issue.repo} #${change.issue.number} 新评论（${excerptAuthor}）：${change.issue.title}`
  const body = excerpt.replace(/\s+/g, ' ').trim()
  const full = body === '' ? head : `${head}\n${body}`
  return full.length <= NOTICE_MAX_CHARS ? full : `${full.slice(0, NOTICE_MAX_CHARS - 1)}…`
}

/** 命令参数里的仓：`<owner>/<仓名>`，两段都非空、不含别的斜杠 */
export function parseRepo(value: unknown): { owner: string; name: string } {
  if (typeof value !== 'string') throw new Error('repo 要写成字符串 "<owner>/<仓名>"')
  const parts = value.split('/')
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') throw new Error(`repo 要写成 "<owner>/<仓名>"，收到 "${value}"`)
  return { owner: parts[0]!, name: parts[1]! }
}

/** 按仓分组，组内按最近更新排在前面，组按组里最近一次更新排序 */
export function groupByRepo(issues: readonly IssueRow[]): Array<{ repo: string; issues: IssueRow[] }> {
  const groups = new Map<string, IssueRow[]>()
  for (const issue of issues) {
    const list = groups.get(issue.repo) ?? []
    list.push(issue)
    groups.set(issue.repo, list)
  }
  const byUpdatedDesc = (a: IssueRow, b: IssueRow): number => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  return [...groups.entries()]
    .map(([repo, list]) => ({ repo, issues: list.sort(byUpdatedDesc) }))
    .sort((a, b) => byUpdatedDesc(a.issues[0]!, b.issues[0]!))
}
