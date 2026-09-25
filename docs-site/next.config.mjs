import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // next dev 缺省会往站目录写 AGENTS.md / CLAUDE.md；本仓的这两份是 docfirst 生成到仓根的，站目录不要
  agentRules: false,
  /**
   * 故意留空：`@godcreator/docfirst-workflow` 与 `@godcreator/docfirst-trajectory` 都不能放进
   * `serverExternalPackages`。两个包里都有客户端组件（前者 `/fumadocs/pre` 的状态点，后者 `./react` 的星轨盘），
   * 外置之后 Next 用 Node 单独加载它们、和站打包的 React 不是同一份，预渲染报
   * `Cannot read properties of null (reading 'use')`，报错里看不出原因。trajectory 的 `./server` 还用包名引用
   * 自己的 `./react`，外置后 `"use client"` 指令被忽略，`StarDisk` 被当成服务端组件渲染，一用到 hooks 就报错。
   * 它们服务端的部分（remark 插件、读磁盘调 git 的代码）经 fumadocs-mdx 的 loader 由 Node 直接加载，不经打包器。
   */
  serverExternalPackages: [],
  redirects: async () => [
    { source: '/', destination: '/docs', permanent: true },
    // 生成正本挪进了现状区，在途 spec 挪进了未来区
    { source: '/outputs/:path*', destination: '/docs/outputs/:path*', permanent: false },
    { source: '/spec/:path*', destination: '/future/spec/:path*', permanent: false },
  ],
}

export default withMDX(config)
