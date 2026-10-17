import { issueDetailFromApi, issueRowFromSearch, type IssueDetail, type IssueRow } from './core.js'

/**
 * 不带 token 读 GitHub 上公开仓的 issue：搜索接口每分钟 10 次、别的接口每小时 60 次。
 * 每轮每个 owner 只搜两次（issue、合并请求各一次），读单条只在有变化时，远在限额以内
 */
const GITHUB_API = 'https://api.github.com'
const SEARCH_PAGE_SIZE = 100
const COMMENT_PAGE_SIZE = 100
const TIMEOUT_MS = 60_000

interface GithubReply {
  status: number
  body: unknown
}

async function githubGet(path: string, query: Record<string, string | number> = {}): Promise<GithubReply> {
  const url = new URL(path, GITHUB_API)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value))
  const response = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'gwb-gitea-issues' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (response.status === 403 || response.status === 429) {
    const reset = Number(response.headers.get('x-ratelimit-reset'))
    const resetAt = Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toLocaleTimeString('zh-CN') : '不知道几点'
    throw new Error(`GitHub 回 ${response.status}（多半是不带 token 的限额用完了，${resetAt} 恢复）：${(await response.text()).slice(0, 300)}`)
  }
  return { status: response.status, body: await response.json() }
}

function describeFailure(what: string, reply: GithubReply): Error {
  return new Error(`${what}：GitHub 回 ${reply.status}，${JSON.stringify(reply.body).slice(0, 300)}`)
}

function requireArray(reply: GithubReply, what: string): unknown[] {
  if (reply.status !== 200) throw describeFailure(what, reply)
  if (!Array.isArray(reply.body)) throw new Error(`${what}：GitHub 回的不是数组`)
  return reply.body
}

/** 一个 owner 名下公开仓里开着的 issue 与合并请求；搜索接口要求写明 is:issue 或 is:pr，两种各搜一遍 */
export async function listOpenGithubIssues(owner: string): Promise<IssueRow[]> {
  const rows: IssueRow[] = []
  for (const type of ['issue', 'pr'] as const) {
    const what = `搜 GitHub ${owner} 名下开着的 ${type}`
    for (let page = 1; ; page += 1) {
      const reply = await githubGet('/search/issues', { q: `user:${owner} is:${type} is:open`, per_page: SEARCH_PAGE_SIZE, page })
      if (reply.status !== 200) throw describeFailure(what, reply)
      const body = reply.body as { items?: unknown; incomplete_results?: unknown }
      // 没搜完的列表会把漏掉的当成可能关了、逐条去读，所以这一轮直接算失败
      if (body.incomplete_results === true) throw new Error(`${what}：GitHub 说这次没搜完（incomplete_results），下一轮再查`)
      if (!Array.isArray(body.items)) throw new Error(`${what}：GitHub 回的没有 items 数组`)
      rows.push(...body.items.map((item) => issueRowFromSearch('github', item)))
      if (body.items.length < SEARCH_PAGE_SIZE) break
    }
  }
  return rows
}

/** 一条 issue 或合并请求连同全部评论；不在了（404 删了、410 关了 issue 功能）回 null。转到别的仓的，GitHub 跳转后回的是新仓里那一条 */
export async function readGithubIssue(repo: string, number: number): Promise<IssueDetail | null> {
  const what = `读 GitHub ${repo}#${number}`
  const reply = await githubGet(`/repos/${repo}/issues/${number}`)
  if (reply.status === 404 || reply.status === 410) return null
  if (reply.status !== 200) throw describeFailure(what, reply)
  const comments: unknown[] = []
  for (let page = 1; ; page += 1) {
    const items = requireArray(await githubGet(`/repos/${repo}/issues/${number}/comments`, { per_page: COMMENT_PAGE_SIZE, page }), `${what} 的评论`)
    comments.push(...items)
    if (items.length < COMMENT_PAGE_SIZE) break
  }
  return issueDetailFromApi('github', repo, reply.body, comments)
}
