# gwb-gitea

gwb 工作台里调 gitea REST API 的插件 `@godcreator/gwb-gitea`：一条 `gitea.http` 命令把 agent 拼好的 API 调用发往设置里的
gitea 实例，补上 `/api/v1` 前缀、带上 token（secret 型设置项）、把回应整理成 `{ status, truncated, note?, body }`
（2xx、4xx、5xx 都照样交回），带 `file` 参数时按 multipart 上传。**没有**建仓命令、发版命令：各类调用怎么写在随包发布的
说明书 `plugins/gitea/skills/gitea/SKILL.md` 里。

## 怎么装

在工作台里调 `plugin-manager.install {"pkg":"@godcreator/gwb-gitea"}`。装完经 MCP 入口的 `run` 调 `gitea.http`；
token 在 gitea 网页上生成，按要调的接口勾仓库、组织、工单这些权限（勾哪几项见说明书 `gitea`）。在本地设置界面填写，或经 `credentials.copy` / `credentials.import` 无回显地存入 `gitea.token`；用 `credentials.status {"section":"gitea","key":"token"}` 核对是否已配置。

## 怎么用

`gitea.http {"method":"GET","path":"/version"}` → `{ ok: true, data: { status: 200, truncated: false, body: { version: … } } }`。
建仓、发 release、传产物、查包的写法与状态码怎么读，读说明书 `gitea`（`skill.read {"name":"gitea"}`）。

## 仓的结构

pnpm workspace：插件包在 `plugins/gitea/`，仓根 `pnpm install`、`pnpm build`、`pnpm check`。
`docs-site/` 是文档站：`cd docs-site && pnpm install && pnpm build && pnpm start`，看 `http://localhost:4326`。
这份 README 是生成物，正本是 `docs-site/content/docs/outputs/readme.mdx`。
