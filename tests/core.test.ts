import { describe, expect, it } from 'vitest'
import { buildUrl, normalizeBase, parseArgs, redact, shapeResponse, stripPath } from '../src/core.js'

/** gitea.http 管道的纯逻辑：参数收窄、URL 组装、回执整形、脱敏 */

describe('parseArgs', () => {
  it('全参收窄 + method 大写化', () => {
    const r = parseArgs({ method: 'post', path: '/user/repos', query: { limit: 50 }, body: { name: 'x' } })
    expect(r).toEqual({ ok: true, value: { method: 'POST', path: 'user/repos', query: { limit: 50 }, body: { name: 'x' }, file: undefined } })
  })

  it('path 手滑带了 /api/v1 或前导斜杠都剥掉', () => {
    const r = parseArgs({ method: 'GET', path: '/api/v1/version' })
    expect(r).toMatchObject({ ok: true, value: { path: 'version' } })
    expect(stripPath('  //user/repos')).toBe('user/repos')
    // 只剥一次：真有这个目录的不动
    expect(stripPath('api/v1/api/v1/x')).toBe('api/v1/x')
  })

  it('method / path / query 形状不对都拦下且文案说人话', () => {
    expect(parseArgs({ method: 'BREW', path: '/x' })).toMatchObject({ ok: false })
    expect(parseArgs({ method: 'GET', path: '' })).toMatchObject({ ok: false })
    expect(parseArgs({ method: 'GET', path: '/x', query: { bad: { deep: 1 } } })).toMatchObject({ ok: false })
    expect(parseArgs('不是对象')).toMatchObject({ ok: false })
  })

  it('GET / HEAD 不带 body / file；带 file 时 body 只能是对象', () => {
    expect(parseArgs({ method: 'GET', path: '/x', body: { a: 1 } })).toMatchObject({ ok: false })
    expect(parseArgs({ method: 'HEAD', path: '/x', file: { path: 'a' } })).toMatchObject({ ok: false })
    expect(parseArgs({ method: 'POST', path: '/x', file: { path: 'a' }, body: '字符串' })).toMatchObject({ ok: false })
    expect(parseArgs({ method: 'POST', path: '/x', file: { path: 'a' }, body: { k: 'v' } })).toMatchObject({ ok: true })
  })
})

describe('buildUrl', () => {
  it('前缀补一次、尾斜杠去干净', () => {
    expect(buildUrl('https://g.example:3000/', 'user/repos')).toBe('https://g.example:3000/api/v1/user/repos')
  })

  it('没写协议当 https（祖先的 https-only 不变量）', () => {
    expect(normalizeBase('g.example:3000')).toBe('https://g.example:3000')
  })

  it('query 序列化，空 query 不留问号', () => {
    expect(buildUrl('https://g.example', '/x', { name: 'a b', n: 3, b: true })).toBe('https://g.example/api/v1/x?name=a+b&n=3&b=true')
    expect(buildUrl('https://g.example', '/x', {})).toBe('https://g.example/api/v1/x')
  })
})

describe('shapeResponse', () => {
  it('content-type 说 json 就解析', () => {
    expect(shapeResponse('{"v":1}', 'application/json')).toEqual({ body: { v: 1 }, truncated: false })
  })

  it('没说 json 但长得像也解析；解不开落回文本', () => {
    expect(shapeResponse('[1,2]', null)).toEqual({ body: [1, 2], truncated: false })
    expect(shapeResponse('{broken', 'application/json')).toEqual({ body: '{broken', truncated: false })
  })

  it('超限截断成文本段，不硬解半截 JSON', () => {
    const big = 'x'.repeat(65 * 1024)
    const r = shapeResponse(big, 'text/plain', 64 * 1024)
    expect(r.truncated).toBe(true)
    expect((r.body as string).length).toBe(64 * 1024)
  })
})

describe('redact', () => {
  it('token 的每次出现都换成 ***；空 secret 不动', () => {
    expect(redact('token abc123 出现在 abc123 里', 'abc123')).toBe('token *** 出现在 *** 里')
    expect(redact('原文', '')).toBe('原文')
  })
})
