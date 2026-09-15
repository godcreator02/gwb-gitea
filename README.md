# gitea 的手

**本页回答**：`@godcreator/gwb-gitea` 是什么、怎么装、怎么用、文档在哪。

## 是什么

gitea 的**通用 HTTP 手**：一条 `gitea.http` 命令把 agent 组装好的 gitea API 调用发往
设置里的 gitea 实例——管道负责补 `/api/v1` 前缀、注入 token（secret 型设置项，回执与
日志脱敏）、整形回执（`{ status, body }`，2xx/4xx/5xx 都是数据）、`file` 参数走 multipart
（传 release 产物）。**没有**建仓命令、没有发版命令——语义全住随包发的说明书
（`skills/SKILL.md`，cookbook），代码只做管道。前身是 DSH 时代的 god-gitea，其
`helper.api(method, path, body)` 的形状原样继承。

## 怎么装

```bash
pnpm add @godcreator/gwb-gitea
```

装完经门 `run` 调 `gitea.http`；token 一次性配置见说明书（网页开 api scope 的 token →
`settings.set` 写 `gitea.token`）。

## 怎么用

`gitea.http { "method": "GET", "path": "/version" }` → `{ ok, data: { status: 200, body: { version: … } } }`。
建仓、发 release、传产物、查包的完整配方与状态码读法，读 skill「gitea」。

## 文档

`docs-site/` 是六区文档站：`cd docs-site && pnpm install && pnpm dev`，看 `http://localhost:4326`。
现状钉在源码上，`pnpm doc` 核对。这份 README 是生成物，正本是 `docs-site/content/outputs/readme.mdx`。
