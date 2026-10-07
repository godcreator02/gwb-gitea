import { describe, expect, it } from 'vitest'
import {
  changesSince, groupByRepo, issueDetailFromGitea, issueRowFromSearch, NOTICE_MAX_CHARS, noticeId, noticeText, parseRepo,
  type IssueRow,
} from '../src/core.js'

function searchItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 3, title: '标题', user: { login: 'godcreator' }, created_at: '2026-10-07T10:00:00+08:00',
    updated_at: '2026-10-07T11:00:00+08:00', comments: 1, html_url: 'https://git.example/godcreator/gwb-kernel/issues/3',
    body: '正文', repository: { full_name: 'godcreator/gwb-kernel' }, ...over,
  }
}

function row(repo: string, number: number, commentCount: number, updatedAt = '2026-10-07T10:00:00+08:00'): IssueRow {
  return { repo, kind: 'issue', number, title: `t${number}`, author: 'a', createdAt: updatedAt, updatedAt, commentCount, url: '' }
}

describe('issueRowFromSearch', () => {
  it('取出仓名、编号、作者与评论数', () => {
    expect(issueRowFromSearch(searchItem({ pull_request: null }))).toEqual({
      repo: 'godcreator/gwb-kernel', kind: 'issue', number: 3, title: '标题', author: 'godcreator',
      createdAt: '2026-10-07T10:00:00+08:00', updatedAt: '2026-10-07T11:00:00+08:00', commentCount: 1,
      url: 'https://git.example/godcreator/gwb-kernel/issues/3',
    })
  })

  it('pull_request 不为空的是合并请求', () => {
    expect(issueRowFromSearch(searchItem({ pull_request: { merged: false } })).kind).toBe('pull')
  })

  it('缺字段直接报错，写明缺哪一个', () => {
    expect(() => issueRowFromSearch(searchItem({ repository: undefined }))).toThrow('repository')
    expect(() => issueRowFromSearch(searchItem({ comments: '1' }))).toThrow('comments')
    expect(() => issueRowFromSearch(searchItem({ user: { name: 'x' } }))).toThrow('login')
  })
})

describe('issueDetailFromGitea', () => {
  it('带上正文与评论', () => {
    const detail = issueDetailFromGitea('godcreator/gwb-kernel', searchItem(), [
      { user: { login: 'b' }, body: '回复', created_at: '2026-10-07T12:00:00+08:00' },
    ])
    expect(detail.body).toBe('正文')
    expect(detail.comments).toEqual([{ author: 'b', body: '回复', createdAt: '2026-10-07T12:00:00+08:00' }])
  })
})

describe('changesSince', () => {
  it('第一次看只记现状，不算变化', () => {
    const result = changesSince(null, [row('o/a', 1, 0), row('o/a', 2, 3)])
    expect(result.changes).toEqual([])
    expect(result.seen).toEqual({ 'o/a#1': 0, 'o/a#2': 3 })
  })

  it('新编号算新开，评论数变多算新评论，关掉的不再记', () => {
    const result = changesSince({ 'o/a#1': 0, 'o/a#2': 3, 'o/a#9': 0 }, [row('o/a', 1, 1), row('o/a', 2, 3), row('o/b', 1, 0)])
    expect(result.changes.map((c) => [c.kind, c.issue.repo, c.issue.number])).toEqual([
      ['commented', 'o/a', 1],
      ['opened', 'o/b', 1],
    ])
    expect(result.seen).toEqual({ 'o/a#1': 1, 'o/a#2': 3, 'o/b#1': 0 })
  })
})

describe('通知', () => {
  it('id 带上评论数：同一条 issue 再来一条评论是新的一条', () => {
    const first = noticeId({ kind: 'commented', issue: row('o/a', 1, 1) })
    const second = noticeId({ kind: 'commented', issue: row('o/a', 1, 2) })
    expect(first).not.toBe(second)
  })

  it('正文压成一行、超长截断到上限', () => {
    const text = noticeText({ kind: 'opened', issue: row('o/a', 1, 0) }, `第一行\n\n第二行${'字'.repeat(800)}`, 'a')
    expect(text.startsWith('o/a 新 issue #1（a）：t1\n第一行 第二行')).toBe(true)
    expect(text.length).toBe(NOTICE_MAX_CHARS)
  })

  it('新开的合并请求写明是合并请求', () => {
    expect(noticeText({ kind: 'opened', issue: { ...row('o/a', 2, 0), kind: 'pull' } }, '', 'a')).toBe('o/a 新合并请求 #2（a）：t2')
  })

  it('新评论写评论的作者', () => {
    expect(noticeText({ kind: 'commented', issue: row('o/a', 1, 1) }, '好的', 'b')).toBe('o/a #1 新评论（b）：t1\n好的')
  })
})

describe('parseRepo', () => {
  it('只认 owner/仓名', () => {
    expect(parseRepo('godcreator/gwb-kernel')).toEqual({ owner: 'godcreator', name: 'gwb-kernel' })
    expect(() => parseRepo('gwb-kernel')).toThrow('<owner>/<仓名>')
    expect(() => parseRepo('a/b/c')).toThrow('<owner>/<仓名>')
    expect(() => parseRepo(3)).toThrow('字符串')
  })
})

describe('groupByRepo', () => {
  it('组内与组之间都按最近更新排', () => {
    const groups = groupByRepo([
      row('o/a', 1, 0, '2026-10-01T00:00:00+08:00'),
      row('o/b', 1, 0, '2026-10-05T00:00:00+08:00'),
      row('o/a', 2, 0, '2026-10-03T00:00:00+08:00'),
    ])
    expect(groups.map((g) => [g.repo, g.issues.map((i) => i.number)])).toEqual([
      ['o/b', [1]],
      ['o/a', [2, 1]],
    ])
  })
})
