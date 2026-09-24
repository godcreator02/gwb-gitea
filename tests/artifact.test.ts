import fs from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 构建产物的检查（只有 node 侧）。没有 dist/ 时整组跳过——`pnpm check` 不构建。
 * 查三条：相对 import 带 .js（产物给 node 直接加载）；包名 import 只有 node 内置模块、electron、cordis
 * （词汇表包与别的插件只 import type，编译后整句消失）；说明书在 files 白名单里。
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(here, '../dist')
const built = fs.existsSync(distDir)

if (!built) console.warn('[gwb-gitea] dist/ 还没生成，产物检查整组跳过（pnpm build 之后再运行）')

/** node 侧产物里允许留下的包名 import：node 内置模块、electron、宿主提供的 cordis */
const NODE_SIDE_ALLOWED = new Set(['electron', 'cordis'])
const isNodeBuiltin = (spec: string): boolean => spec.startsWith('node:') || builtinModules.includes(spec)
/** 正则锚行首：字符串字面量里的 import 总带着缩进，顶格的才是真的顶层 import */
const RELATIVE = /^import\s+(?:[^'"]*from\s*)?['"](\.[^'"]*)['"]/gm
const BARE = /^import\s+(?:[^'"]*from\s*)?['"]([^'".][^'"]*)['"]/gm

describe.skipIf(!built)('产物', () => {
  const all = built ? fs.readdirSync(distDir).filter((f) => f.endsWith('.js')) : []

  it('node 侧产物在：至少有 index.js，拆出新文件也照样检查', () => {
    expect(all).toContain('index.js')
  })

  it('相对 import 一律带扩展名——产物给 node 直接加载，ESM 不补扩展名', () => {
    const bad: string[] = []
    for (const file of all) {
      const text = fs.readFileSync(path.join(distDir, file), 'utf8')
      for (const m of text.matchAll(RELATIVE)) {
        if (!m[1]!.endsWith('.js')) bad.push(`${file}: ${m[1]!}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('包名 import 只有 node 内置模块、electron、cordis', () => {
    const bad = new Set<string>()
    for (const file of all) {
      const text = fs.readFileSync(path.join(distDir, file), 'utf8')
      for (const m of text.matchAll(BARE)) {
        const spec = m[1]!
        if (!isNodeBuiltin(spec) && !NODE_SIDE_ALLOWED.has(spec)) bad.add(spec)
      }
    }
    expect([...bad]).toEqual([])
  })

  it('说明书随包发布——files 白名单里有 skills', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(here, '../package.json'), 'utf8')) as { files?: string[] }
    expect(pkg.files).toEqual(expect.arrayContaining(['skills']))
  })
})
