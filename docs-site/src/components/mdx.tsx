/**
 * mdx 里能用的 React 组件表。生成 markdown 用的规则表在 docfirst.config.mjs，两边的名单由 registry.ts 的类型对齐：
 * 少一个编译不过，多一个也编译不过；两边齐不齐由 scripts/verify-roster.mjs 核对。
 * 底下是 fumadocs 的默认表，pre 换成格式包里会画状态点的那个。
 */
import defaultMdxComponents from 'fumadocs-ui/mdx'
import { File, Files, Folder } from 'fumadocs-ui/components/files'
import type { MDXComponents } from 'mdx/types'
import type { ReactNode } from 'react'
import { DocfirstPre } from '@godcreator/docfirst-workflow/fumadocs/pre'
import { GiteaSeams } from './gitea-seams'
import type { ComponentName } from './registry'

type Loose = MDXComponents[string]

export function Note({ children }: { children?: ReactNode }) {
  return <div className="note">{children}</div>
}

const table: Record<ComponentName, Loose> = {
  Note: Note as Loose,
  Files: Files as Loose,
  Folder: Folder as Loose,
  File: File as Loose,
  GiteaSeams: GiteaSeams as Loose,
}

export function getMDXComponents(components: MDXComponents = {}): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...components,
    ...table,
    pre: DocfirstPre as unknown as NonNullable<MDXComponents['pre']>,
  }
}
