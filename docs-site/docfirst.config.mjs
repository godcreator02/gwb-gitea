/**
 * 这个站的 docfirst 配置：命令行 docfirst（check / confirm / render / trajectory）读它，项目根是站点目录。
 * 被钉的代码在仓根的 `plugins/gitea/` 与 `plugins/gitea-issues/`，引用写 `../plugins/gitea/…`。
 *
 * content：内容根。下面的 future/ 是未来区、不进核对，其余目录都是现状区、都进 check；本站的现状区是 `content/docs/`。
 * outputs：仓根 AGENTS.md / CLAUDE.md / README.md 与随包发布的说明书 `plugins/gitea/skills/gitea/SKILL.md` 是生成物，
 * 正本在 `content/docs/outputs/`，改了正本运行 `pnpm doc:render`，两份放进同一个提交。SKILL.md 要保留 frontmatter 的
 * `name` 与 `description`（说明书插件登记时读它们），所以目标写成对象形式。
 * CLAUDE.md 第一行固定是 `@AGENTS.md`，只给 Claude 的指令写在它后面。生成正本按原文渲染，里面不能用 JSX 组件。
 * fumadocsRoster 与 components：组件名册。fumadocsRoster 放进 fumadocs 自带的 Note、Files、Folder、File 的机读规则，
 * components 再加站里的组件。
 * trajectory：轨迹卡放在站点根下的 trajectory/，站点的卡集合（app/features/trajectory/mdx.ts）读同一个目录。
 * 术语表不在这里：它是站点根的 glossary.json，由站点的 source.config.ts 交给术语标注插件。
 */
export default {
  content: 'content',
  outputs: {
    'content/docs/outputs/agents.mdx': ['../AGENTS.md'],
    'content/docs/outputs/claude.mdx': ['../CLAUDE.md'],
    'content/docs/outputs/readme.mdx': ['../README.md'],
    'content/docs/outputs/skills/gitea.mdx': [
      { to: '../plugins/gitea/skills/gitea/SKILL.md', frontmatter: ['name', 'description'] },
    ],
  },
  fumadocsRoster: true,
  components: {
    // 手写的术语标注：机读版里只留术语原词
    Term: 'children',
    // 首页接缝图：图在机读版里看不见，这段文字要把六条接缝都讲到，编号与 content/docs/index/gitea-seams.tsx 一致
    GiteaSeams: (node, h) =>
      h.paragraph(
        '[接缝图] gwb-gitea 插件与外部的六条接缝：1 命令总线 gwbCommands 登记 gitea.http 与 gitea.push-mirror.add（effect 都标 external）并把调用交给发送函数；' +
          '2 设置 gwbSettings 提供 base-url、token、push-url、github-token，每次调用现读；3 说明书插件 gwbSkills 登记 skills/ 目录（局部注入，缺了只少说明书）；' +
          '4 发送函数用 fetch 调 gitea 实例的 /api/v1，带 token 头；5 带 file 的上传从本机磁盘读 file.path；' +
          '6 服务 gwbGitea 给依赖方插件：http 与命令走同一个发送函数、失败抛 Error，connection 回地址、推送地址与 token。',
      ),
  },
  trajectory: 'trajectory',
}
