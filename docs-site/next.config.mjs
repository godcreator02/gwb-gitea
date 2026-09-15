import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  /**
   * **这一行空着，本身就是那条「不许打包」的账。**
   *
   * `@godcreator/docfirst-workflow` 与 `@godcreator/docfirst-trajectory` 都**不许**放进
   * `serverExternalPackages`：两个包里都有客户端组件（前者的 `/fumadocs/pre` 是状态点，
   * 后者的 `./react` 是星轨盘），外置之后 Next 走 Node 单独加载它们、跟站打包的 React
   * 分了家，预渲染报 `Cannot read properties of null (reading 'use')`，报错完全不指根因。
   * trajectory 还多一层：它的 `./server` 用**包名自引用**去渲 `./react`，一外置连那句
   * `"use client"` 都发现不了，`StarDisk` 被当服务端组件渲染，一命中 hooks 就炸。
   *
   * 两条是同一类：**外置的边界会把客户端指令吃掉**。它们的服务端那半（remark 插件、
   * 读盘调 git 的那些）走 fumadocs-mdx 的 loader，本来就是 Node 直载、不经打包器。
   */
  serverExternalPackages: [],
  // 站根落到文档首页
  redirects: async () => [
    { source: '/', destination: '/docs', permanent: true },
  ],
}

export default withMDX(config)
