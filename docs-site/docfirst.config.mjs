/**
 * 这个站怎么挂机制：用哪个格式包、哪几区进 check、卡目录在哪、生成物摆哪、组件名册是什么。
 * 命令行和站读的是同一份。
 *
 * 项目根是这个站目录，钉的代码在仓根——引用里写 `../src/…`，读取器按项目根拼路径。
 * 比较器不写死：仓里有 git 就用 git 比，没有就退回按内容摘要比。
 *
 * 六区里只有 docs（现状）与 outputs（生成正本）进 check——只有这两区对代码说话。
 * trajectory 指卡目录：check 顺带跑卡校验（卡是 .mdx，六个字段一个不沾的页不算卡）。
 * outputs：仓根 AGENTS.md / README.md 是生成物，正本是 content/outputs/ 下那两篇 mdx——
 * 改 mdx 源要跑 `pnpm doc:render` 重摆，两份一起提交，check 守着生成物跟源一致。
 * 要发 SKILL.md 这类头部得保留 frontmatter 字段的生成物，目标写成对象：
 *   'content/outputs/skills/x.mdx': [{ to: '../skills/x/SKILL.md', frontmatter: ['name', 'description'] }]
 */
import * as fumadocs from '@godcreator/docfirst-workflow/fumadocs'

export default {
  formats: [fumadocs],
  docs: ['content/docs', 'content/outputs'],
  trajectory: 'content/trajectory',
  out: 'out',
  outputs: {
    'content/outputs/agents.mdx': ['../AGENTS.md'],
    'content/outputs/readme.mdx': ['../README.md'],
  },
  components: {
    ...fumadocs.defaultRoster,
  },
}
