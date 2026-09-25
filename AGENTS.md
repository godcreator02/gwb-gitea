# gwb-gitea

**本页回答**：在这个仓干活的 agent 先看什么、怎么跑、门禁是哪几条、什么碰不得。

通用纪律（TDD、模块经接口连接、盘问、六区规则、文档怎么写）不在这儿——正本是随
`@godcreator/gwb-docfirst-workflow` 插件发布的 skill「docfirst-docs」，读它。这一页只写仓专属的，
压在 60 行内。

## 先读

`docs-site/content/docs/`：[系统地图](docs-site/content/docs/system-map.mdx) → 要改的那块的页。
在途的活与初版设计 spec（`gitea-spec.mdx`）都在 `docs-site/content/spec/`。写插件、在隔离 home 里验证读
skill「gwb-devkit」，升版本号、发版读 skill「gwb-release」。

## 这个仓的形状

只有 node 侧的插件，**一条命令** `gitea.http`：各类调用怎么组装、回执怎么读、token 怎么配，全写在
`skills/gitea/SKILL.md`、随包发布，代码只负责把请求发出去。纯逻辑在 `src/core.ts`（参数收窄、URL 组装、
回执整理、脱敏），测试在 `tests/`；真发请求只发生在 `src/index.ts` 的 handler 里。

## 怎么跑

```bash
pnpm install
pnpm check        # typecheck + oxlint + vitest
pnpm build        # tsc 输出到 dist/
```

在隔离 home 里验证时，真调用用 `gitea.http GET /version`（不用 token）。

## 门禁

提交前都要绿：

```bash
pnpm check
cd docs-site && pnpm doc && pnpm build
```

## 红线

* 别往 `src/index.ts` 里加「建仓命令」「发版命令」：那等于把用法写死在代码里，新的调用写法写进说明书
* 这份 AGENTS.md 是生成物，正本是 `docs-site/content/outputs/agents.mdx`，改那边
