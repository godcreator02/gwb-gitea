import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // next dev 缺省会往站目录写 AGENTS.md / CLAUDE.md；本仓的这两份是 docfirst 生成到仓根的，站目录不要
  agentRules: false,
  redirects: async () => [
    { source: '/', destination: '/docs', permanent: true },
    // 生成正本挪进了现状区，在途 spec 挪进了未来区
    { source: '/outputs/:path*', destination: '/docs/outputs/:path*', permanent: false },
    { source: '/spec/:path*', destination: '/future/spec/:path*', permanent: false },
  ],
}

export default withMDX(config)
