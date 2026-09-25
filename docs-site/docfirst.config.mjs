/**
 * 这个站的 docfirst 配置：用哪个格式包、生成物写到哪、组件规则表是什么。命令行和站读的是同一份。
 *
 * 项目根是这个站目录，被钉的代码在 `plugins/gitea/`——引用里写 `../plugins/gitea/…`，按项目根拼路径。
 * 分区按约定：`content/` 下 `trajectory/` 与 `future/` 两个名字固定，其余目录都是现状区、都进 check；
 * 本站的现状区只有 `content/docs`。
 *
 * 仓根 AGENTS.md / CLAUDE.md / README.md 是生成物，正本在 `content/docs/outputs/`，改正本后运行
 * `pnpm doc:render`，两份一起提交。CLAUDE.md 第一行固定是 `@AGENTS.md`，只给 Claude 的指令写在它后面。
 * 生成正本按原文渲染，里面不能用 JSX 组件。
 */
import * as fumadocs from '@godcreator/docfirst-workflow/fumadocs'

export default {
  formats: [fumadocs],
  outputs: {
    'content/docs/outputs/agents.mdx': ['../AGENTS.md'],
    'content/docs/outputs/claude.mdx': ['../CLAUDE.md'],
    'content/docs/outputs/readme.mdx': ['../README.md'],
  },
  components: {
    ...fumadocs.defaultRoster,
  },
}
