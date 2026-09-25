# gwb-gitea

**本页回答**：在这个仓干活的 agent 先看什么、怎么运行、提交前要过哪些检查、什么不能做。

文档怎么写、分区、钉码怎么确认，读随 `@godcreator/gwb-docfirst-workflow` 插件发布的说明书「docfirst-docs」；
写插件、在隔离 home 里验证读「gwb-devkit」；升版本号、发版读「gwb-release」。这一页只写本仓专属的。

## 先读

`docs-site/content/docs/`：首页 `index.mdx`（功能、接缝、接口、依赖、不做的事）→ 要改的那块的页：
`request.mdx`（一次调用从参数到回执）、`wiring.mdx`（注入与 peer）。

## 这个仓的形状

pnpm workspace：仓根是不发布的 private 包，插件 `@godcreator/gwb-gitea` 在 `plugins/gitea/`，文档站在 `docs-site/`
（自己一套依赖，不进 workspace）。插件只有 node 侧，**一条命令** `gitea.http`：各类调用怎么组装、回执怎么读、
token 怎么配，全写在 `plugins/gitea/skills/gitea/SKILL.md`、随包发布，代码只负责把请求发出去。
纯逻辑在 `plugins/gitea/src/core.ts`，测试在 `plugins/gitea/tests/`；真发请求只发生在 `plugins/gitea/src/index.ts` 的处理函数里。

## 怎么运行

```bash
pnpm install
pnpm build        # 递归构建 plugins/*：tsc 输出到 plugins/gitea/dist/
pnpm check        # 递归检查：typecheck + oxlint + vitest
```

在隔离 home 里验证：`devkit.dev {"home":"<home 名>","dir":"<仓根>","packages":["plugins/gitea"]}`，
真调用用 `gitea.http GET /version`（不用 token）。

## 提交前的检查

```bash
pnpm check
cd docs-site && pnpm doc
```

改了被钉的代码，同一个提交里 `pnpm doc:confirm` 写回挪了位置的钉码，剩下的黄灯复核后 `pnpm doc:confirm <页…> --accept`。

## 不能做的

- 别往 `plugins/gitea/src/index.ts` 里加「建仓命令」「发版命令」：那等于把用法写死在代码里，新的调用写法写进说明书
- 这份 AGENTS.md 是生成物，正本是 `docs-site/content/docs/outputs/agents.mdx`，改那边再 `pnpm doc:render`
