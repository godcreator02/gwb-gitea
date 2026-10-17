import { describe, expect, it } from 'vitest'
import {
  compareOwner, groupByRepo, issueDetailFromApi, issueRowFromSearch, NOTICE_MAX_CHARS, noticeId, noticeText, parseRepo, parseSource,
  type IssueChange, type IssueDetail, type IssueRow,
} from '../src/core.js'

function giteaItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 3, title: '标题', user: { login: 'godcreator' }, created_at: '2026-10-07T10:00:00+08:00',
    updated_at: '2026-10-07T11:00:00+08:00', comments: 1, html_url: 'https://git.example/godcreator/gwb-kernel/issues/3',
    body: '正文', state: 'open', repository: { full_name: 'godcreator/gwb-kernel' }, ...over,
  }
}

function githubItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  const { repository: _, ...rest } = giteaItem({ html_url: 'https://github.com/godcreator02/gwb-kernel/issues/3' })
  return { ...rest, repository_url: 'https://api.github.com/repos/godcreator02/gwb-kernel', ...over }
}

function row(repo: string, number: number, commentCount: number, at = '2026-10-07T10:00:00+08:00'): IssueRow {
  return { source: 'gitea', repo, kind: 'issue', number, title: `t${number}`, author: 'a', createdAt: at, updatedAt: at, commentCount, url: '' }
}

function detailOf(issue: IssueRow, over: Partial<IssueDetail> = {}): IssueDetail {
  return { ...issue, state: 'open', body: '', comments: [], ...over }
}

describe('issueRowFromSearch', () => {
  it('gitea：取出仓名、编号、作者与评论数', () => {
    expect(issueRowFromSearch('gitea', giteaItem({ pull_request: null }))).toEqual({
      source: 'gitea', repo: 'godcreator/gwb-kernel', kind: 'issue', number: 3, title: '标题', author: 'godcreator',
      createdAt: '2026-10-07T10:00:00+08:00', updatedAt: '2026-10-07T11:00:00+08:00', commentCount: 1,
      url: 'https://git.example/godcreator/gwb-kernel/issues/3',
    })
  })

  it('GitHub：仓名从 repository_url 取', () => {
    const issue = issueRowFromSearch('github', githubItem())
    expect([issue.source, issue.repo]).toEqual(['github', 'godcreator02/gwb-kernel'])
    expect(() => issueRowFromSearch('github', githubItem({ repository_url: 'https://api.github.com/x' }))).toThrow('repository_url')
  })

  it('pull_request 不为空的是合并请求', () => {
    expect(issueRowFromSearch('gitea', giteaItem({ pull_request: { merged: false } })).kind).toBe('pull')
  })

  it('缺字段直接报错，写明缺哪一个', () => {
    expect(() => issueRowFromSearch('gitea', giteaItem({ repository: undefined }))).toThrow('repository')
    expect(() => issueRowFromSearch('gitea', giteaItem({ comments: '1' }))).toThrow('comments')
    expect(() => issueRowFromSearch('gitea', giteaItem({ user: { name: 'x' } }))).toThrow('login')
  })
})

describe('issueDetailFromApi', () => {
  it('带上正文与评论', () => {
    const detail = issueDetailFromApi('gitea', 'godcreator/gwb-kernel', giteaItem(), [
      { user: { login: 'b' }, body: '回复', created_at: '2026-10-07T12:00:00+08:00' },
    ])
    expect(detail.body).toBe('正文')
    expect(detail.state).toBe('open')
    expect(detail.comments).toEqual([{ author: 'b', body: '回复', createdAt: '2026-10-07T12:00:00+08:00' }])
  })

  it('GitHub 没写正文是 null，读成空串；gitea 的 null 照样报错', () => {
    expect(issueDetailFromApi('github', 'o/a', githubItem({ body: null }), []).body).toBe('')
    expect(() => issueDetailFromApi('gitea', 'o/a', giteaItem({ body: null }), [])).toThrow('body')
  })

  it('关掉的合并请求，合进去了算 merged：gitea 看 merged，GitHub 看 merged_at', () => {
    expect(issueDetailFromApi('gitea', 'o/a', giteaItem({ state: 'closed', pull_request: { merged: true } }), []).state).toBe('merged')
    expect(issueDetailFromApi('gitea', 'o/a', giteaItem({ state: 'closed', pull_request: { merged: false } }), []).state).toBe('closed')
    expect(issueDetailFromApi('github', 'o/a', githubItem({ state: 'closed', pull_request: { merged_at: '2026-10-08T00:00:00Z' } }), []).state).toBe('merged')
    expect(issueDetailFromApi('github', 'o/a', githubItem({ state: 'closed', pull_request: { merged_at: null } }), []).state).toBe('closed')
    expect(issueDetailFromApi('github', 'o/a', githubItem({ state: 'closed' }), []).state).toBe('closed')
  })
})

describe('compareOwner', () => {
  const polledAt = '2026-10-08T00:00:00Z'

  it('第一次看这个 owner 只记现状，不算变化', () => {
    const result = compareOwner(undefined, [row('o/a', 1, 0), row('o/a', 2, 3)], polledAt)
    expect(result.changes).toEqual([])
    expect(result.disappeared).toEqual([])
    expect(result.next).toEqual({ polledAt, issues: { 'o/a#1': 0, 'o/a#2': 3 } })
  })

  it('上次没有的编号：上次开始查之后创建的算新开，之前创建的算重新打开', () => {
    const previous = { polledAt: '2026-10-07T12:00:00+08:00', issues: {} }
    const result = compareOwner(previous, [row('o/a', 1, 0, '2026-10-07T13:00:00+08:00'), row('o/a', 2, 0, '2026-10-01T00:00:00+08:00')], polledAt)
    expect(result.changes.map((c) => [c.kind, c.issue.number])).toEqual([['opened', 1], ['reopened', 2]])
  })

  it('评论数变多算新评论并记下原来的条数，不在了的交给调用方核对', () => {
    const previous = { polledAt: '2026-10-07T00:00:00Z', issues: { 'o/a#1': 0, 'o/a#2': 3, 'o/b#9': 0 } }
    const result = compareOwner(previous, [row('o/a', 1, 2), row('o/a', 2, 3)], polledAt)
    expect(result.changes).toEqual([{ kind: 'commented', issue: row('o/a', 1, 2), previousCommentCount: 0 }])
    expect(result.disappeared).toEqual([{ repo: 'o/b', number: 9 }])
    expect(result.next.issues).toEqual({ 'o/a#1': 2, 'o/a#2': 3 })
  })
})

describe('通知', () => {
  it('id 带上来源；新评论按评论数区分', () => {
    const first = noticeId({ kind: 'commented', issue: row('o/a', 1, 1) })
    const second = noticeId({ kind: 'commented', issue: row('o/a', 1, 2) })
    expect(first).not.toBe(second)
    expect(first.startsWith('gitea-issues:gitea:o/a#1:commented:')).toBe(true)
  })

  it('重新打开与第一次新开是不同的 id', () => {
    const issue = row('o/a', 1, 0)
    expect(noticeId({ kind: 'opened', issue })).not.toBe(noticeId({ kind: 'reopened', issue: { ...issue, updatedAt: '2026-10-09T00:00:00Z' } }))
  })

  it('新开的：标题行写来源与仓，正文的 markdown 原样保留', () => {
    const issue = row('o/a', 1, 0)
    const text = noticeText({ kind: 'opened', issue }, detailOf(issue, { body: '## 现场\n\n- 一\n- 二' }))
    expect(text.split('\n').slice(0, 2)).toEqual(['**新 issue** · gitea · o/a #1', '### t1'])
    expect(text.endsWith('## 现场\n\n- 一\n- 二')).toBe(true)
  })

  it('新评论写上次之后的每一条，各带作者', () => {
    const issue = { ...row('o/a', 1, 3), source: 'github' as const }
    const comments = [
      { author: 'x', body: '旧的', createdAt: '2026-10-07T10:00:00+08:00' },
      { author: 'y', body: '第二条', createdAt: '2026-10-07T11:00:00+08:00' },
      { author: 'z', body: '第三条', createdAt: '2026-10-07T12:00:00+08:00' },
    ]
    const text = noticeText({ kind: 'commented', issue, previousCommentCount: 1 }, detailOf(issue, { comments }))
    expect(text.startsWith('**新评论** · GitHub · o/a #1\n### t1\n')).toBe(true)
    expect(text).not.toContain('旧的')
    expect(text).toContain('**y**')
    expect(text).toContain('第二条\n\n---\n\n**z**')
  })

  it('关掉的合并请求写已合并，关掉的 issue 写已关闭', () => {
    const pull = { ...row('o/a', 2, 0), kind: 'pull' as const }
    expect(noticeText({ kind: 'merged', issue: pull }, detailOf(pull)).split('\n')[0]).toBe('**已合并** · gitea · o/a #2')
    expect(noticeText({ kind: 'closed', issue: pull }, detailOf(pull)).split('\n')[0]).toBe('**已关闭** · gitea · o/a #2（合并请求）')
    expect(noticeText({ kind: 'opened', issue: pull }, detailOf(pull)).split('\n')[0]).toBe('**新合并请求** · gitea · o/a #2')
  })

  it('超长截断到上限，截在代码块中间时补上收尾', () => {
    const issue = row('o/a', 1, 0)
    const change: IssueChange = { kind: 'opened', issue }
    const text = noticeText(change, detailOf(issue, { body: `说明\n\n\`\`\`ts\n${'x\n'.repeat(4000)}\`\`\`` }))
    expect(text.length).toBeLessThanOrEqual(NOTICE_MAX_CHARS)
    expect(text).toMatch(/```\n\n……（太长，后面的到窗格里看）$/)
  })
})

describe('参数', () => {
  it('repo 只认 owner/仓名', () => {
    expect(parseRepo('godcreator/gwb-kernel')).toEqual({ owner: 'godcreator', name: 'gwb-kernel' })
    expect(() => parseRepo('gwb-kernel')).toThrow('<owner>/<仓名>')
    expect(() => parseRepo('a/b/c')).toThrow('<owner>/<仓名>')
    expect(() => parseRepo(3)).toThrow('字符串')
  })

  it('source 只认 gitea、github', () => {
    expect(parseSource('github')).toBe('github')
    expect(() => parseSource('GitHub')).toThrow('source')
    expect(() => parseSource(undefined)).toThrow('source')
  })
})

describe('groupByRepo', () => {
  it('组内与组之间都按最近更新排，两边同名的仓分开', () => {
    const groups = groupByRepo([
      row('o/a', 1, 0, '2026-10-01T00:00:00+08:00'),
      row('o/b', 1, 0, '2026-10-05T00:00:00+08:00'),
      row('o/a', 2, 0, '2026-10-03T00:00:00+08:00'),
      { ...row('o/a', 7, 0, '2026-10-02T00:00:00+08:00'), source: 'github' },
    ])
    expect(groups.map((g) => [g.source, g.repo, g.issues.map((i) => i.number)])).toEqual([
      ['gitea', 'o/b', [1]],
      ['gitea', 'o/a', [2, 1]],
      ['github', 'o/a', [7]],
    ])
  })
})
