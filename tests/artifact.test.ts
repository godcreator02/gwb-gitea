import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 产物守卫（纯 node 半版）：缺产物时整组跳过——门禁不依赖 build。
 * 钉两条：相对 import 带 .js（产物给 node 直接加载）、裸名只有词汇表包
 * （契约包与各件都是 import type，整句擦除，不该出现在运行时 import）。
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(here, '../dist')
const built = fs.existsSync(distDir)

if (!built) console.warn('[gwb-gitea] dist/ 还没造出来，产物组跳过（pnpm build 之后再跑）')

/** node 半运行时真 import 的 */
const ALLOWED_BARE = new Set(['@godcreator/gwb-plugin-api'])
/** 正则锚行首：字符串字面量里的 import 总带着缩进，顶格的才是真的顶层 import */
const RELATIVE = /^import\s+(?:[^'"]*from\s*)?['"](\.[^'"]*)['"]/gm
const BARE = /^import\s+(?:[^'"]*from\s*)?['"]([^'".][^'"]*)['"]/gm

describe.skipIf(!built)('产物', () => {
  const all = built ? fs.readdirSync(distDir).filter((f) => f.endsWith('.js')) : []

  it('node 半在——至少有 index.js，拆出新文件也照收', () => {
    expect(all).toContain('index.js')
  })

  it('相对 import 一律带扩展名——产物给 node 直接加载，ESM 不做补全', () => {
    const bad: string[] = []
    for (const file of all) {
      const text = fs.readFileSync(path.join(distDir, file), 'utf8')
      for (const m of text.matchAll(RELATIVE)) {
        if (!m[1]!.endsWith('.js')) bad.push(`${file}: ${m[1]!}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('裸名只有词汇表包', () => {
    const bare = new Set<string>()
    for (const file of all) {
      const text = fs.readFileSync(path.join(distDir, file), 'utf8')
      for (const m of text.matchAll(BARE)) {
        const spec = m[1]!
        if (!spec.startsWith('node:')) bare.add(spec)
      }
    }
    expect([...bare].filter((s) => !ALLOWED_BARE.has(s))).toEqual([])
  })

  it('说明书与身份卡随包走——files 白名单里有 skills 与 catalog.md', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(here, '../package.json'), 'utf8')) as { files?: string[] }
    expect(pkg.files).toEqual(expect.arrayContaining(['skills', 'catalog.md']))
  })
})
