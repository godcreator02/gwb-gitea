/**
 * 组件名单的正本。mdx.tsx 用它的类型要求 React 组件表一个不多一个不少；
 * scripts/verify-roster.mjs 拿它跟 docfirst.config.mjs 里生成 markdown 用的组件规则表核对。
 *
 * 两张表少了哪一张都是硬失败：**规则表没有** → 生成 markdown 时报「名册外组件」；
 * **React 表没有** → 站渲染时报 Expected component。
 *
 * Files / Folder / File 是 fumadocs 自己的文件树组件：目录树引用生成的就是它们，规则在格式包的默认表里。
 * GiteaSeams 是首页的接缝图，见 gitea-seams.tsx。
 * registry.ts 只有可擦除的类型，Node 可以直接运行它。
 */
export const componentNames = ['Note', 'Files', 'Folder', 'File', 'GiteaSeams'] as const
export type ComponentName = (typeof componentNames)[number]
