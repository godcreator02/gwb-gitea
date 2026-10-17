import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, name, type GwbGiteaApi } from '../src/index.js'
import type { GwbContext } from '@godcreator/gwb-kernel-desktop'

/**
 * 加载与命令：替身自己写。网络部分全走替换掉的 fetch；真发请求的验证在隔离 home 的
 * devkit.dev 里，不在这儿。
 */

interface Harness {
  ctx: GwbContext
  commands: Array<{ name: string; description: string; usage: string; effect?: string; plugin?: string }>
  handlers: Map<string, (args?: unknown) => Promise<unknown>>
  defines: Array<{ key: string; type: string; default: unknown }>
  skillDirs: Array<string>
  settingValues: Map<string, unknown>
  provided: Map<string, unknown>
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
    provided: new Map(),
  }
  h.ctx = {
    reflect: {
      provide: (serviceName: string, service: unknown) => {
        h.provided.set(serviceName, service)
        return () => {}
      },
    },
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
      define: (def: { key: string; type: string; default: unknown }) => {
        h.defines.push({ key: def.key, type: def.type, default: def.default })
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

  it('挂上即：四项设置（两个 token 是 secret 型，push-url 默认是团队的推送服务）、两条命令、说明书目录注册', () => {
    const h = harness()
    apply(h.ctx)
    expect(h.defines.map((d) => d.key).sort()).toEqual(['base-url', 'github-token', 'push-url', 'token'])
    expect(h.defines.find((d) => d.key === 'push-url')?.default).toBe('https://ntfy.tianshen02.online:28377')
    expect(h.defines.find((d) => d.key === 'token')?.type).toBe('secret')
    expect(h.defines.find((d) => d.key === 'github-token')?.type).toBe('secret')
    expect([...h.handlers.keys()]).toEqual(['gitea.http', 'gitea.push-mirror.add'])
    for (const cmd of h.commands) {
      expect(cmd.plugin).toBeUndefined()
      expect(cmd.description.trim()).not.toBe('')
      expect(cmd.effect).toBe('external')
    }
    expect(h.commands[0]?.usage).toContain('method')
    expect(h.commands[1]?.usage).toContain('github')
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

describe('gitea.push-mirror.add', () => {
  const GITHUB_TOKEN = 'ghp_secret_github_token_123'
  type CommandResult = { ok: boolean; error?: string; data?: Record<string, unknown> }

  function stubGiteaReply(status: number, body: unknown): Array<[string, RequestInit]> {
    const calls: Array<[string, RequestInit]> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push([url, init])
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
      }),
    )
    return calls
  }

  const giteaMirror = {
    repo_name: 'gwb-gitea',
    remote_name: 'remote_mirror_abc',
    remote_address: 'https://github.com/godcreator02/gwb-gitea.git',
    interval: '1h0m0s',
    sync_on_commit: true,
    created: '2026-10-16T10:00:00+08:00',
    last_update: '',
    last_error: '',
    remote_password: GITHUB_TOKEN,
  }

  it('参数缺、格式不对、多出认不出的参数都直接报错，不发请求', async () => {
    const h = harness({ 'github-token': GITHUB_TOKEN })
    apply(h.ctx)
    const calls = stubGiteaReply(201, giteaMirror)
    for (const bad of [
      '不是对象',
      { github: 'godcreator02/gwb-gitea' },
      { repo: 'godcreator/gwb-gitea' },
      { repo: 'gwb-gitea', github: 'godcreator02/gwb-gitea' },
      { repo: 'godcreator/gwb-gitea', github: 'https://github.com/godcreator02/gwb-gitea' },
      { repo: 'godcreator/gwb-gitea', github: 'godcreator02/gwb-gitea', interval: '1h' },
    ]) {
      const res = (await h.handlers.get('gitea.push-mirror.add')!(bad)) as CommandResult
      expect(res.ok, JSON.stringify(bad)).toBe(false)
      expect(res.error).toBeTruthy()
    }
    expect(calls).toHaveLength(0)
  })

  it('GitHub token 没配：报错写明去设置界面填哪一项，不发请求', async () => {
    const h = harness({ token: 'gitea-tok' })
    apply(h.ctx)
    const calls = stubGiteaReply(201, giteaMirror)
    const res = (await h.handlers.get('gitea.push-mirror.add')!({ repo: 'godcreator/gwb-gitea', github: 'godcreator02/gwb-gitea' })) as CommandResult
    expect(res.ok).toBe(false)
    expect(res.error).toContain('gitea.github-token')
    expect(res.error).toContain('设置界面')
    expect(calls).toHaveLength(0)
  })

  it('请求形状：POST 到 gitea 仓的 push_mirrors，带 gitea token 头，body 里是 GitHub 地址、owner、token、1 小时与推送即同步', async () => {
    const h = harness({ token: 'gitea-tok', 'github-token': GITHUB_TOKEN })
    apply(h.ctx)
    const calls = stubGiteaReply(201, giteaMirror)
    await h.handlers.get('gitea.push-mirror.add')!({ repo: 'godcreator/gwb-gitea', github: 'godcreator02/gwb-gitea' })
    expect(calls).toHaveLength(1)
    const [url, init] = calls[0]!
    expect(url).toBe('https://git.tianshen02.online:28377/api/v1/repos/godcreator/gwb-gitea/push_mirrors')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('token gitea-tok')
    expect(JSON.parse(init.body as string)).toEqual({
      remote_address: 'https://github.com/godcreator02/gwb-gitea.git',
      remote_username: 'godcreator02',
      remote_password: GITHUB_TOKEN,
      interval: '1h0m0s',
      sync_on_commit: true,
    })
  })

  it('回执只有镜像信息里不含凭据的字段，哪儿都没有 token', async () => {
    const h = harness({ token: 'gitea-tok', 'github-token': GITHUB_TOKEN })
    apply(h.ctx)
    stubGiteaReply(201, giteaMirror)
    const res = (await h.handlers.get('gitea.push-mirror.add')!({ repo: 'godcreator/gwb-gitea', github: 'godcreator02/gwb-gitea' })) as CommandResult
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({
      repo_name: 'gwb-gitea',
      remote_name: 'remote_mirror_abc',
      remote_address: 'https://github.com/godcreator02/gwb-gitea.git',
      interval: '1h0m0s',
      sync_on_commit: true,
      created: '2026-10-16T10:00:00+08:00',
      last_update: '',
      last_error: '',
    })
    expect(JSON.stringify(res)).not.toContain(GITHUB_TOKEN)
  })

  it('gitea 回非 2xx：报错带状态码与 gitea 的 message，token 换成 ***', async () => {
    const h = harness({ token: 'gitea-tok', 'github-token': GITHUB_TOKEN })
    apply(h.ctx)
    stubGiteaReply(400, { message: `remote address ${GITHUB_TOKEN} is invalid` })
    const res = (await h.handlers.get('gitea.push-mirror.add')!({ repo: 'godcreator/gwb-gitea', github: 'godcreator02/gwb-gitea' })) as CommandResult
    expect(res.ok).toBe(false)
    expect(res.error).toContain('400')
    expect(res.error).toContain('is invalid')
    expect(res.error).not.toContain(GITHUB_TOKEN)
    expect(res.error).toContain('***')
  })

  it('没发出去：报错里的 GitHub token 也换成 ***', async () => {
    const h = harness({ token: 'gitea-tok', 'github-token': GITHUB_TOKEN })
    apply(h.ctx)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError(`fetch failed: ${GITHUB_TOKEN}`)
      }),
    )
    const res = (await h.handlers.get('gitea.push-mirror.add')!({ repo: 'godcreator/gwb-gitea', github: 'godcreator02/gwb-gitea' })) as CommandResult
    expect(res.ok).toBe(false)
    expect(res.error).toContain('没发出去')
    expect(res.error).not.toContain(GITHUB_TOKEN)
  })
})

describe('服务 gwbGitea', () => {
  function serviceOf(h: Harness): GwbGiteaApi {
    apply(h.ctx)
    const service = h.provided.get('gwbGitea')
    expect(service).toBeDefined()
    return service as GwbGiteaApi
  }

  it('http 与命令走同一个发送：4xx 照常返回、带上 token', async () => {
    const service = serviceOf(harness({ token: 'tok-svc' }))
    const seen: Array<Record<string, string>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(init.headers as Record<string, string>)
        return new Response('{"message":"nope"}', { status: 404, headers: { 'content-type': 'application/json' } })
      }),
    )
    const res = await service.http({ method: 'GET', path: '/repos/a/b' })
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ message: 'nope' })
    expect(seen[0]?.authorization).toBe('token tok-svc')
  })

  it('参数不对、没发出去都抛 Error，token 被脱敏', async () => {
    const service = serviceOf(harness({ token: 'sectok1234567890' }))
    await expect(service.http({ method: 'BREW', path: '/x' })).rejects.toThrow(Error)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed: sectok1234567890')
      }),
    )
    const err = await service.http({ method: 'GET', path: '/version' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('没发出去')
    expect((err as Error).message).not.toContain('sectok1234567890')
  })

  it('connection 回当前设置，没配的用默认地址、token 是空字符串', () => {
    expect(serviceOf(harness()).connection()).toEqual({
      baseUrl: 'https://git.tianshen02.online:28377',
      pushUrl: 'https://ntfy.tianshen02.online:28377',
      token: '',
    })
    const configured = harness({ 'base-url': 'https://g.example:3000', 'push-url': 'https://n.example', token: 't1' })
    expect(serviceOf(configured).connection()).toEqual({ baseUrl: 'https://g.example:3000', pushUrl: 'https://n.example', token: 't1' })
  })
})
