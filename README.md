# gitea 的手

**本页回答**：`@godcreator/gwb-gitea` 是什么、怎么装、怎么用、文档在哪。

## 是什么

gwb 工作台里调 gitea API 的插件：一条 `gitea.http` 命令把 agent 组装好的 gitea API 调用发往设置里的
gitea 实例。插件补上 `/api/v1` 前缀、注入 token（secret 型设置项，回执与日志里脱敏）、把回执整理成
`{ status, body }`（2xx、4xx、5xx 都是数据），`file` 参数走 multipart（传 release 产物）。**没有**建仓命令、
没有发版命令：各类调用怎么组装写在随包发布的说明书 `skills/gitea/SKILL.md` 里，代码只负责把请求发出去。

## 怎么装

在工作台里调 `plugin-manager.install {"pkg":"@godcreator/gwb-gitea"}`。装完经 MCP 入口的 `run` 调 `gitea.http`；
token 怎么配见说明书（在 gitea 网页上开一个 api scope 的 token，`settings.set` 写进 `gitea.token`）。

## 怎么用

`gitea.http { "method": "GET", "path": "/version" }` → `{ ok, data: { status: 200, body: { version: … } } }`。
建仓、发 release、传产物、查包的完整写法与状态码读法，读 skill「gitea」。

## 文档

`docs-site/` 是文档站：`cd docs-site && pnpm install && pnpm dev`，看 `http://localhost:4326`。
这份 README 是生成物，正本是 `docs-site/content/outputs/readme.mdx`。
