/**
 * 这个站的 docfirst 配置：用哪个格式（`@godcreator/docfirst-workflow` 的子入口 `./fumadocs`）、生成物写到哪、组件规则表是什么。命令行和站读的是同一份。
 *
 * 项目根是这个站目录，被钉的代码在 `plugins/gitea/`——引用里写 `../plugins/gitea/…`，按项目根拼路径。
 * 分区按约定：`content/` 下 `trajectory/` 与 `future/` 两个名字固定，其余目录都是现状区、都进 check；
 * 本站的现状区只有 `content/docs`。
 *
 * 仓根 AGENTS.md / CLAUDE.md / README.md 与随包发布的说明书 `plugins/gitea/skills/gitea/SKILL.md` 是生成物，
 * 正本在 `content/docs/outputs/`，改正本后运行 `pnpm doc:render`，两份一起提交。SKILL.md 要保留 frontmatter 的
 * `name` 与 `description`（说明书插件登记时读它们），所以目标写成对象形式。
 * CLAUDE.md 第一行固定是 `@AGENTS.md`，只给 Claude 的指令写在它后面。
 * 生成正本按原文渲染，里面不能用 JSX 组件。
 */
import * as fumadocs from '@godcreator/docfirst-workflow/fumadocs'

export default {
  formats: [fumadocs],
  outputs: {
    'content/docs/outputs/agents.mdx': ['../AGENTS.md'],
    'content/docs/outputs/claude.mdx': ['../CLAUDE.md'],
    'content/docs/outputs/readme.mdx': ['../README.md'],
    'content/docs/outputs/skills/gitea.mdx': [
      { to: '../plugins/gitea/skills/gitea/SKILL.md', frontmatter: ['name', 'description'] },
    ],
  },
  components: {
    ...fumadocs.defaultRoster,
    // 首页接缝图：图在机读版里看不见，这段文字要把五条接缝都讲到，编号与 src/components/gitea-seams.tsx 一致
    GiteaSeams: (node, h) =>
      h.paragraph(
        '[接缝图] gwb-gitea 插件与外部的五条接缝：1 命令总线 gwbCommands 登记 gitea.http（effect 标 external）并把调用交给处理函数；' +
          '2 设置 gwbSettings 提供 base-url 与 token，每次调用现读；3 说明书插件 gwbSkills 登记 skills/ 目录（局部注入，缺了只少说明书）；' +
          '4 处理函数用 fetch 调 gitea 实例的 /api/v1，带 token 头；5 带 file 的上传从本机磁盘读 file.path。',
      ),
  },
}
