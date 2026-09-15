import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, name } from '../src/index.js'
import type { GwbContext } from '@godcreator/gwb-plugin-api'

/**
 * 挂载与命令面：手搓替身（模板期改成了手写件，repo-kit 的挂载守卫形状对不上——
 * timer 仓同款路子）。网络那半全走 stub 的 fetch：真发请求的验证在隔离 home 的
 * devkit.dev 里，不在这儿。
 */

interface Harness {
  ctx: GwbContext
  commands: Array<{ name: string; description: string; plugin: string }>
  handlers: Map<string, (args?: unknown) => Promise<unknown>>
  defines: Array<{ key: string; type: string }>
  skillDirs: Array<string>
  settingValues: Map<string, unknown>
}

/** 最小 ctx 替身：logger / effect（立即执行）/ 三张服务表 */
function harness(settingValues: Record<string, unknown> = {}): Harness {
  const h: Harness = {
    ctx: undefined as unknown as GwbContext,
    commands: [],
    handlers: new Map(),
    defines: [],
    skillDirs: [],
    settingValues: new Map(Object.entries(settingValues)),
  }
  h.ctx = {
    logger: () => ({ info() {}, warn() {}, error() {} }),
    effect: (fn: () => unknown) => {
      fn()
      return () => {}
    },
    inject: (_deps: string[], cb: (c: GwbContext) => void) => {
      cb(h.ctx)
    },
    gwbCommands: {
      register: (def: Harness['commands'][number], handler: (args?: unknown) => Promise<unknown>) => {
        h.commands.push(def)
        h.handlers.set(def.name, handler)
        return () => {}
      },
    },
    gwbSettings: {
      define: (def: { key: string; type: string }) => {
        h.defines.push({ key: def.key, type: def.type })
        return () => {}
      },
      get: (key: string) => h.settingValues.get(key),
    },
    gwbSkills: {
      register: (dir: string | URL) => {
        h.skillDirs.push(String(dir))
        return () => {}
      },
    },
  } as unknown as GwbContext
  return h
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('gwb-gitea', () => {
  it('身份与依赖面', () => {
    expect(name).toBe('gwb-gitea')
  })

  it('挂上即：两项设置（token 是 secret 型）、一条命令、说明书目录注册', () => {
    const h = harness()
    apply(h.ctx)
    expect(h.defines.map((d) => d.key).sort()).toEqual(['base-url', 'token'])
    expect(h.defines.find((d) => d.key === 'token')?.type).toBe('secret')
    expect([...h.handlers.keys()]).toEqual(['gitea.http'])
    for (const cmd of h.commands) expect(cmd.plugin).toBe('@godcreator/gwb-gitea')
    expect(h.commands[0]?.description).toContain('method')
    expect(h.skillDirs).toHaveLength(1)
    expect(h.skillDirs[0]).toMatch(/\/skills\/$/)
  })

  it('参数形状不对：ok:false 且文案即用法', async () => {
    const h = harness()
    apply(h.ctx)
    for (const bad of ['不是对象', { method: 'BREW', path: '/x' }, { method: 'GET', path: '' }, { method: 'GET', path: '/x', body: {} }]) {
      const res = (await h.handlers.get('gitea.http')!(bad)) as { ok: boolean; error?: string }
      expect(res.ok, JSON.stringify(bad)).toBe(false)
      expect(res.error).toBeTruthy()
    }
  })

  it('4xx 也是发出去了：status 与 body 原样交回（解释权在调用方）', async () => {
    const h = harness()
    apply(h.ctx)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"nope"}', { status: 404, headers: { 'content-type': 'application/json' } })),
    )
    const res = (await h.handlers.get('gitea.http')!({ method: 'GET', path: '/repos/a/b' })) as {
      ok: boolean
      data: { status: number; body: { message: string }; truncated: boolean }
    }
    expect(res.ok).toBe(true)
    expect(res.data.status).toBe(404)
    expect(res.data.body).toEqual({ message: 'nope' })
    expect(res.data.truncated).toBe(false)
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[string, RequestInit]>
    expect(calls[0]![0]).toContain('/api/v1/repos/a/b')
  })

  it('没发出去才 ok:false，token 在错误文案里被脱敏', async () => {
    const h = harness({ token: 'sectok1234567890' })
    apply(h.ctx)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed: sectok1234567890 leaked in stack')
      }),
    )
    const res = (await h.handlers.get('gitea.http')!({ method: 'GET', path: '/version' })) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('没发出去')
    expect(res.error).not.toContain('sectok1234567890')
    expect(res.error).toContain('***')
  })

  it('token 配了就注入 Authorization；没配就不带这个头', async () => {
    const withToken = harness({ token: 'tok-xyz' })
    apply(withToken.ctx)
    const seen: Array<Record<string, string> | undefined> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(init.headers as Record<string, string>)
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      }),
    )
    await withToken.handlers.get('gitea.http')!({ method: 'GET', path: '/user' })
    expect(seen[0]?.authorization).toBe('token tok-xyz')

    const bare = harness()
    apply(bare.ctx)
    await bare.handlers.get('gitea.http')!({ method: 'GET', path: '/version' })
    expect(seen[1]?.authorization).toBeUndefined()
  })

  it('file 出现即 multipart：文件从盘上读、字段名默认 attachment', async () => {
    const h = harness()
    apply(h.ctx)
    const bodies: Array<FormData | string | undefined> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(init.body as FormData | string | undefined)
        return new Response('{"id": 1}', { status: 201, headers: { 'content-type': 'application/json' } })
      }),
    )
    const tmp = `${import.meta.dirname}/__upload-probe.txt`
    const { writeFileSync, rmSync } = await import('node:fs')
    writeFileSync(tmp, 'hello gitea')
    try {
      const res = (await h.handlers.get('gitea.http')!({
        method: 'POST',
        path: '/repos/o/r/releases/1/assets',
        query: { name: 'probe.txt' },
        file: { path: tmp, name: 'probe.txt' },
      })) as { ok: boolean; data: { status: number } }
      expect(res.ok).toBe(true)
      expect(res.data.status).toBe(201)
      const fd = bodies[0] as FormData
      expect(fd).toBeInstanceOf(FormData)
      expect(fd.get('attachment') instanceof File).toBe(true)
      expect((fd.get('attachment') as File).name).toBe('probe.txt')
    } finally {
      rmSync(tmp)
    }
  })
})
