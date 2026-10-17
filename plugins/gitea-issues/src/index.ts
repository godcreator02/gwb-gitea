import type { GwbContext } from '@godcreator/gwb-kernel-desktop'
import type { GiteaResponse, GwbGiteaApi } from '@godcreator/gwb-gitea'
import type { GwbQqBotApi } from '@godcreator/gwb-qq-bot'
// 空的类型 import 只为让这几个包的 `declare module 'cordis'` 生效，ctx 上才有对应服务的类型
import type {} from '@cordisjs/plugin-timer'
import type {} from '@godcreator/gwb-commands'
import type {} from '@godcreator/gwb-data'
import type {} from '@godcreator/gwb-settings'
import type {} from '@godcreator/gwb-shell'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  compareOwner, issueDetailFromApi, issueRowFromSearch, noticeId, noticeText, ownerKey, parseRepo, parseSource, SOURCE_LABEL,
  type IssueChange, type IssueDetail, type IssueRow, type IssueSource, type SeenState,
} from './core.js'
import { listOpenGithubIssues, readGithubIssue } from './github.js'

export type { IssueComment, IssueDetail, IssueRow, IssueSource, IssueState } from './core.js'

export const name = 'gwb-gitea-issues'

export const inject = ['gwbCommands', 'gwbSettings', 'gwbData', 'gwbGitea', 'timer']

const CLIENT_URL = new URL('./client.js', import.meta.url).href
const STYLE_URL = new URL('./style.css', import.meta.url).href

/** 带正文的 issue 一条就有几 KB，gwbGitea.http 的回执超过 64KB 会截断：一页只取几条 */
const ISSUE_PAGE_SIZE = 5
const COMMENT_PAGE_SIZE = 10

const SETTING_OWNERS = 'owners'
const SETTING_GITHUB_OWNERS = 'github-owners'
const SETTING_POLL_MINUTES = 'poll-minutes'

interface PollStatus {
  lastPollAt: string | null
  lastError: string | null
  openIssues: number
  notified: number
}

interface TrackedOwner {
  source: IssueSource
  owner: string
}

export function apply(ctx: GwbContext): void {
  const log = ctx.logger(name)
  const commands = ctx.gwbCommands
  if (commands === undefined) throw new Error('ctx.gwbCommands 不在：inject 里写了它，cordis 本不该调用 apply')
  const gitea = ctx.gwbGitea
  if (gitea === undefined) throw new Error('ctx.gwbGitea 不在：inject 里写了它，cordis 本不该调用 apply')

  ctx.gwbSettings.define({
    key: SETTING_OWNERS, title: '看 gitea 上哪些 owner 的仓', type: 'string-list', default: ['godcreator', 'god-private'],
    description: 'gitea 上的用户名或组织名，一行一个。窗格与 QQ 推送只看这些 owner 名下仓里的 issue 与合并请求；协作站项目的组织由协作站插件管，不用写进来',
  })
  ctx.gwbSettings.define({
    key: SETTING_GITHUB_OWNERS, title: '看 GitHub 上哪些 owner 的仓', type: 'string-list', default: ['godcreator02'],
    description: 'GitHub 上的用户名或组织名，一行一个，只看公开仓（不带 token 读）；清空就不看 GitHub',
  })
  ctx.gwbSettings.define({
    key: SETTING_POLL_MINUTES, title: '查新内容的间隔（分钟）', type: 'number', default: 5,
    description: '每隔这么久查一次有没有新的、重新打开的、关掉的 issue 与合并请求和新评论，最少 1 分钟；改了下一轮起生效',
  })

  const readOwnerList = (key: string): string[] => {
    const value = ctx.gwbSettings.get(key)
    if (!Array.isArray(value) || value.some((owner) => typeof owner !== 'string' || owner.trim() === '')) {
      throw new Error(`设置 ${key} 要是非空字符串的列表`)
    }
    return value.map((owner: string) => owner.trim())
  }
  const trackedOwners = (): TrackedOwner[] => [
    ...readOwnerList(SETTING_OWNERS).map((owner) => ({ source: 'gitea' as const, owner })),
    ...readOwnerList(SETTING_GITHUB_OWNERS).map((owner) => ({ source: 'github' as const, owner })),
  ]
  const readPollMs = (): number => Math.max(1, Number(ctx.gwbSettings.get(SETTING_POLL_MINUTES))) * 60_000

  const listOpen = (tracked: TrackedOwner): Promise<IssueRow[]> =>
    tracked.source === 'gitea' ? listOpenGiteaIssues(gitea, tracked.owner) : listOpenGithubIssues(tracked.owner)
  const readIssue = (source: IssueSource, repo: string, number: number): Promise<IssueDetail | null> =>
    source === 'gitea' ? readGiteaIssue(gitea, repo, number) : readGithubIssue(repo, number)
  const requireIssue = async (source: IssueSource, repo: string, number: number): Promise<IssueDetail> => {
    const detail = await readIssue(source, repo, number)
    if (detail === null) throw new Error(`${SOURCE_LABEL[source]} 上没有 ${repo}#${number}（删了或仓不在了）`)
    return detail
  }

  let qqBot: GwbQqBotApi | null = null
  ctx.inject(['gwbQqBot'], (scoped) => {
    scoped.effect(() => { qqBot = scoped.gwbQqBot; return () => { qqBot = null } })
  })

  // 0.2 的 seen.json 只记 gitea、没有每个 owner 的查询时间；换成 seen-state.json，升级后第一轮当成第一次看
  rmSync(join(ctx.gwbData.dir, 'seen.json'), { force: true })
  const seenFile = join(ctx.gwbData.dir, 'seen-state.json')
  const status: PollStatus = { lastPollAt: null, lastError: null, openIssues: 0, notified: 0 }

  /** 每个 owner 各查各的：一边查不通（比如 GitHub 限额用完）只沿用它上次的记录，不挡另一边的推送 */
  async function pollOnce(): Promise<void> {
    const previous = readSeen(seenFile)
    const next: SeenState = {}
    /** 关掉、合并的在核对时已经读过那一条，带上；别的推送前再读 */
    const changes: Array<{ change: IssueChange; detail?: IssueDetail }> = []
    const ownerErrors: string[] = []
    let openIssues = 0
    for (const tracked of trackedOwners()) {
      const key = ownerKey(tracked.source, tracked.owner)
      const polledAt = new Date().toISOString()
      let current: IssueRow[]
      try {
        current = await listOpen(tracked)
      } catch (error) {
        ownerErrors.push(`${SOURCE_LABEL[tracked.source]} ${tracked.owner}：${error instanceof Error ? error.message : String(error)}`)
        if (previous[key] !== undefined) next[key] = previous[key]
        continue
      }
      const comparison = compareOwner(previous[key], current, polledAt)
      changes.push(...comparison.changes.map((change) => ({ change })))
      for (const gone of comparison.disappeared) {
        const detail = await readIssue(tracked.source, gone.repo, gone.number)
        if (detail !== null && detail.state !== 'open') changes.push({ change: { kind: detail.state, issue: detail }, detail })
      }
      next[key] = comparison.next
      openIssues += current.length
    }

    const bot = qqBot
    if (bot !== null) {
      for (const { change, detail: knownDetail } of changes) {
        const detail = knownDetail ?? await requireIssue(change.issue.source, change.issue.repo, change.issue.number)
        const reply = await bot.notify(noticeId(change), noticeText(change, detail))
        if (reply.delivered) status.notified += 1
      }
    }
    writeFileSync(seenFile, JSON.stringify(next), 'utf-8')
    status.openIssues = openIssues
    if (ownerErrors.length > 0) throw new Error(ownerErrors.join('；'))
  }

  let pollInFlight: Promise<void> | null = null
  function startPoll(): Promise<void> {
    pollInFlight ??= pollOnce().then(
      () => { status.lastError = null },
      (error: unknown) => {
        status.lastError = String(error instanceof Error ? error.message : error)
        log.error(`查 issue 没成：${status.lastError}`)
      },
    ).finally(() => {
      status.lastPollAt = new Date().toISOString()
      pollInFlight = null
    })
    return pollInFlight
  }

  let currentPollMs = readPollMs()
  let stopTick = ctx.interval(() => void startPoll(), currentPollMs)
  const stopRecheck = ctx.interval(() => {
    const wantedMs = readPollMs()
    if (wantedMs === currentPollMs) return
    currentPollMs = wantedMs
    stopTick()
    stopTick = ctx.interval(() => void startPoll(), wantedMs)
  }, 30_000)
  void startPoll()

  commands.register(
    {
      name: 'gitea-issues.list',
      description: '列出设置里 gitea 与 GitHub 各 owner 名下各仓开着的 issue 与合并请求',
      usage: '无参数。回 { issues: [{ source（"gitea" 或 "github"）, repo（"<owner>/<仓名>"）, kind（"issue" 或合并请求 "pull"）, number, title, author, createdAt, updatedAt, commentCount, url }] }，现查两边，不读缓存；哪一边查不通整条报错',
      effect: 'read',
    },
    async () => {
      const rows = await Promise.all(trackedOwners().map(listOpen))
      return { ok: true, data: { issues: rows.flat() } }
    },
  )

  commands.register(
    {
      name: 'gitea-issues.detail',
      description: '读一条 issue 或合并请求的正文与全部评论（合并请求的代码审阅意见不在里面）',
      usage: '{ source: "gitea" | "github", repo: "<owner>/<仓名>", number: 编号（issue 与合并请求共用一套编号） }。回 list 里那一行的各字段加 state（"open" / "closed" / "merged"）、body 与 comments: [{ author, body, createdAt }]；没有这一条报错',
      effect: 'read',
    },
    async (args) => {
      const record = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
      const unknownKeys = Object.keys(record).filter((key) => key !== 'source' && key !== 'repo' && key !== 'number')
      if (unknownKeys.length > 0) throw new Error(`不认识的参数：${unknownKeys.join('、')}`)
      const source = parseSource(record['source'])
      const repo = parseRepo(record['repo'])
      const number = record['number']
      if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) throw new Error('number 要是正整数')
      return { ok: true, data: await requireIssue(source, `${repo.owner}/${repo.name}`, number) }
    },
  )

  commands.register(
    {
      name: 'gitea-issues.status',
      description: '后台查新 issue 与合并请求的状态：上次查的时间与结果、qq-bot 在不在（在就推送到 QQ）',
      usage: '无参数。回 { lastPollAt, lastError（哪几个 owner 没查通，各自的原因；都通了是 null）, openIssues（上次查通的 owner 名下开着的条数）, notified（本次加载以来推出去的条数）, qqBotAvailable（装着 qq-bot 就推送）, pollMinutes }',
      effect: 'read',
    },
    async () => ({
      ok: true,
      data: { ...status, qqBotAvailable: qqBot !== null, pollMinutes: currentPollMs / 60_000 },
    }),
  )

  ctx.inject(['gwbShell'], (scoped) => {
    scoped.gwbShell.describeSelf({ title: 'issue', icon: 'message-square-warning' })
    scoped.gwbShell.registerPane({ id: 'issues', title: 'issue 与合并请求', icon: 'message-square-warning', kind: 'tool', client: CLIENT_URL, style: STYLE_URL })
  })

  ctx.effect(() => async () => {
    stopRecheck()
    stopTick()
    await pollInFlight
  })
}

function requireArrayBody(response: GiteaResponse, what: string): unknown[] {
  if (response.status !== 200) throw new Error(`${what}：gitea 回 ${response.status}，${JSON.stringify(response.body).slice(0, 300)}`)
  if (response.truncated) throw new Error(`${what}：回执超过 64KB 被截断，把每页条数调小`)
  if (!Array.isArray(response.body)) throw new Error(`${what}：gitea 回的不是数组`)
  return response.body
}

/** 开着的 issue 与合并请求；gitea 的搜索接口按 type 分开列，两种各查一遍 */
async function listOpenGiteaIssues(gitea: GwbGiteaApi, owner: string): Promise<IssueRow[]> {
  const rows: IssueRow[] = []
  for (const type of ['issues', 'pulls'] as const) {
    for (let page = 1; ; page += 1) {
      const response = await gitea.http({
        method: 'GET', path: '/repos/issues/search',
        query: { type, state: 'open', owner, limit: ISSUE_PAGE_SIZE, page },
      })
      const items = requireArrayBody(response, `列 ${owner} 名下开着的 ${type}`)
      rows.push(...items.map((item) => issueRowFromSearch('gitea', item)))
      if (items.length < ISSUE_PAGE_SIZE) break
    }
  }
  return rows
}

async function listAllGiteaComments(gitea: GwbGiteaApi, repo: string, number: number): Promise<unknown[]> {
  const comments: unknown[] = []
  for (let page = 1; ; page += 1) {
    const response = await gitea.http({
      method: 'GET', path: `/repos/${repo}/issues/${number}/comments`, query: { limit: COMMENT_PAGE_SIZE, page },
    })
    const items = requireArrayBody(response, `读 ${repo}#${number} 的评论`)
    comments.push(...items)
    if (items.length < COMMENT_PAGE_SIZE) return comments
  }
}

/** 删了或仓不在了回 null */
async function readGiteaIssue(gitea: GwbGiteaApi, repo: string, number: number): Promise<IssueDetail | null> {
  const response = await gitea.http({ method: 'GET', path: `/repos/${repo}/issues/${number}` })
  if (response.status === 404) return null
  if (response.status !== 200) throw new Error(`读 ${repo}#${number}：gitea 回 ${response.status}，${JSON.stringify(response.body).slice(0, 300)}`)
  if (response.truncated) throw new Error(`读 ${repo}#${number}：回执超过 64KB 被截断`)
  return issueDetailFromApi('gitea', repo, response.body, await listAllGiteaComments(gitea, repo, number))
}

/** 没有记录文件就是每个 owner 都第一次看；文件坏了直接报错：当成第一次看会悄悄丢掉这期间的变化 */
function readSeen(file: string): SeenState {
  if (!existsSync(file)) return {}
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`${file} 不是对象，删掉它重新记`)
  return parsed as SeenState
}
