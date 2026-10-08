import type { GwbContext } from '@godcreator/gwb-kernel-desktop'
import type { GiteaResponse, GwbGiteaApi } from '@godcreator/gwb-gitea'
import type { GwbQqBotApi } from '@godcreator/gwb-qq-bot'
// 空的类型 import 只为让这几个包的 `declare module 'cordis'` 生效，ctx 上才有对应服务的类型
import type {} from '@cordisjs/plugin-timer'
import type {} from '@godcreator/gwb-commands'
import type {} from '@godcreator/gwb-data'
import type {} from '@godcreator/gwb-settings'
import type {} from '@godcreator/gwb-shell'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  changesSince, issueDetailFromGitea, issueRowFromSearch, noticeId, noticeText, parseRepo,
  type IssueChange, type IssueDetail, type IssueRow, type SeenIssues,
} from './core.js'

export type { IssueComment, IssueDetail, IssueRow } from './core.js'

export const name = 'gwb-gitea-issues'

export const inject = ['gwbCommands', 'gwbSettings', 'gwbData', 'gwbGitea', 'timer']

const CLIENT_URL = new URL('./client.js', import.meta.url).href
const STYLE_URL = new URL('./style.css', import.meta.url).href

/** 带正文的 issue 一条就有几 KB，gwbGitea.http 的回执超过 64KB 会截断：一页只取几条 */
const ISSUE_PAGE_SIZE = 5
const COMMENT_PAGE_SIZE = 10

const SETTING_OWNERS = 'owners'
const SETTING_POLL_MINUTES = 'poll-minutes'

interface PollStatus {
  lastPollAt: string | null
  lastError: string | null
  openIssues: number
  notified: number
}

export function apply(ctx: GwbContext): void {
  const log = ctx.logger(name)
  const commands = ctx.gwbCommands
  if (commands === undefined) throw new Error('ctx.gwbCommands 不在：inject 里写了它，cordis 本不该调用 apply')
  const gitea = ctx.gwbGitea
  if (gitea === undefined) throw new Error('ctx.gwbGitea 不在：inject 里写了它，cordis 本不该调用 apply')

  ctx.gwbSettings.define({
    key: SETTING_OWNERS, title: '看哪些 owner 的仓', type: 'string-list', default: ['godcreator', 'god-private'],
    description: 'gitea 上的用户名或组织名，一行一个。窗格与 QQ 推送只看这些 owner 名下仓里开着的 issue 与合并请求；协作站项目的组织由协作站插件管，不用写进来',
  })
  ctx.gwbSettings.define({
    key: SETTING_POLL_MINUTES, title: '查新内容的间隔（分钟）', type: 'number', default: 5,
    description: '每隔这么久查一次有没有新的 issue、合并请求与评论，最少 1 分钟；改了下一轮起生效',
  })

  const readOwners = (): string[] => {
    const value = ctx.gwbSettings.get(SETTING_OWNERS)
    if (!Array.isArray(value) || value.some((owner) => typeof owner !== 'string' || owner.trim() === '')) {
      throw new Error(`设置 ${SETTING_OWNERS} 要是非空字符串的列表`)
    }
    return value.map((owner: string) => owner.trim())
  }
  const readPollMs = (): number => Math.max(1, Number(ctx.gwbSettings.get(SETTING_POLL_MINUTES))) * 60_000

  let qqBot: GwbQqBotApi | null = null
  ctx.inject(['gwbQqBot'], (scoped) => {
    scoped.effect(() => { qqBot = scoped.gwbQqBot; return () => { qqBot = null } })
  })

  const seenFile = join(ctx.gwbData.dir, 'seen.json')
  const status: PollStatus = { lastPollAt: null, lastError: null, openIssues: 0, notified: 0 }

  async function pollOnce(): Promise<void> {
    const current = await listOpenIssues(gitea!, readOwners())
    const { changes, seen } = changesSince(readSeen(seenFile), current)
    const bot = qqBot
    if (bot !== null) {
      for (const change of changes) {
        const { excerpt, excerptAuthor } = await excerptOf(gitea!, change)
        const reply = await bot.notify(noticeId(change), noticeText(change, excerpt, excerptAuthor))
        if (reply.delivered) status.notified += 1
      }
    }
    writeFileSync(seenFile, JSON.stringify(seen), 'utf-8')
    status.openIssues = current.length
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
      description: '列出设置 owners 名下各仓里开着的 issue 与合并请求',
      usage: '无参数。回 { issues: [{ repo（"<owner>/<仓名>"）, kind（"issue" 或合并请求 "pull"）, number, title, author, createdAt, updatedAt, commentCount, url }] }，现查 gitea，不读缓存',
      effect: 'read',
    },
    async () => ({ ok: true, data: { issues: await listOpenIssues(gitea, readOwners()) } }),
  )

  commands.register(
    {
      name: 'gitea-issues.detail',
      description: '读一条 issue 或合并请求的正文与全部评论（合并请求的代码审阅意见不在里面）',
      usage: '{ repo: "<owner>/<仓名>", number: 编号（issue 与合并请求共用一套编号） }。回 list 里那一行的各字段加 body 与 comments: [{ author, body, createdAt }]',
      effect: 'read',
    },
    async (args) => {
      const record = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
      const unknownKeys = Object.keys(record).filter((key) => key !== 'repo' && key !== 'number')
      if (unknownKeys.length > 0) throw new Error(`不认识的参数：${unknownKeys.join('、')}`)
      const repo = parseRepo(record['repo'])
      const number = record['number']
      if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) throw new Error('number 要是正整数')
      return { ok: true, data: await readIssueDetail(gitea, `${repo.owner}/${repo.name}`, number) }
    },
  )

  commands.register(
    {
      name: 'gitea-issues.status',
      description: '后台查新 issue 与合并请求的状态：上次查的时间与结果、qq-bot 在不在（在就推送到 QQ）',
      usage: '无参数。回 { lastPollAt, lastError, openIssues, notified（本次加载以来推出去的条数）, qqBotAvailable（装着 qq-bot 就推送）, pollMinutes }',
      effect: 'read',
    },
    async () => ({
      ok: true,
      data: { ...status, qqBotAvailable: qqBot !== null, pollMinutes: currentPollMs / 60_000 },
    }),
  )

  ctx.inject(['gwbShell'], (scoped) => {
    scoped.gwbShell.describeSelf({ title: 'gitea issue', icon: 'message-square-warning' })
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
async function listOpenIssues(gitea: GwbGiteaApi, owners: readonly string[]): Promise<IssueRow[]> {
  const rows: IssueRow[] = []
  for (const owner of owners) {
    for (const type of ['issues', 'pulls'] as const) {
      for (let page = 1; ; page += 1) {
        const response = await gitea.http({
          method: 'GET', path: '/repos/issues/search',
          query: { type, state: 'open', owner, limit: ISSUE_PAGE_SIZE, page },
        })
        const items = requireArrayBody(response, `列 ${owner} 名下开着的 ${type}`)
        rows.push(...items.map(issueRowFromSearch))
        if (items.length < ISSUE_PAGE_SIZE) break
      }
    }
  }
  return rows
}

async function listAllComments(gitea: GwbGiteaApi, repo: string, number: number): Promise<unknown[]> {
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

async function readIssueDetail(gitea: GwbGiteaApi, repo: string, number: number): Promise<IssueDetail> {
  const response = await gitea.http({ method: 'GET', path: `/repos/${repo}/issues/${number}` })
  if (response.status !== 200) throw new Error(`读 ${repo}#${number}：gitea 回 ${response.status}，${JSON.stringify(response.body).slice(0, 300)}`)
  if (response.truncated) throw new Error(`读 ${repo}#${number}：回执超过 64KB 被截断`)
  return issueDetailFromGitea(repo, response.body, await listAllComments(gitea, repo, number))
}

/** 新 issue 摘正文，新评论摘最新那一条 */
async function excerptOf(gitea: GwbGiteaApi, change: IssueChange): Promise<{ excerpt: string; excerptAuthor: string }> {
  const detail = await readIssueDetail(gitea, change.issue.repo, change.issue.number)
  if (change.kind === 'opened') return { excerpt: detail.body, excerptAuthor: detail.author }
  const latest = detail.comments.at(-1)
  if (latest === undefined) return { excerpt: '', excerptAuthor: '' }
  return { excerpt: latest.body, excerptAuthor: latest.author }
}

/** 没有记录文件就是第一次看；文件坏了直接报错：当成第一次看会悄悄丢掉这期间的新 issue 与评论 */
function readSeen(file: string): SeenIssues | null {
  if (!existsSync(file)) return null
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`${file} 不是对象，删掉它重新记`)
  return parsed as SeenIssues
}
