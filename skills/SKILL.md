---
name: gitea
description: 要对 gitea 发 API 调用时读——建仓、发 release、传产物、列仓、查 npm 包、删草稿仓。讲 gitea.http 的参数形状、{status, body} 回执怎么读、token 怎么配（一次）、常用配方与状态码读法。语义全在这份说明书里，代码只是管道，没有第二条专用命令。
---

# gitea 的手：一条 gitea.http 走天下

这个件只有一条命令 `gitea.http`。它是 gitea REST API 的**通用管道**：你（agent）按
gitea 的 API 文档组装调用，它负责补前缀、注 token、发请求、整形回执。**没有**建仓命令、
没有发版命令——那些是下面的配方，不是代码。

## 先配 token（一次性）

1. gitea 网页 → 右上头像 → Settings → Applications → Generate New Token，**只勾
   `api` scope**（够建仓、发 release、管包；最小权限）
2. 写进设置：`settings.set { "section": "gitea", "key": "token", "value": "<token>" }`
   （secret 型，不随包发、不进日志）
3. 验链路（免 token）：`gitea.http { "method": "GET", "path": "/version" }` →
   `status: 200`
4. 验收（带 token）：`gitea.http { "method": "GET", "path": "/user" }` →
   `status: 200`，body 里是你自己的登录名

`gitea.base-url` 设置项默认 `https://git.tianshen02.online:28377`，换实例才动它。

## 命令形状

```
gitea.http {
  "method": "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD",
  "path":   "/user/repos",          // 不带 /api/v1，管道补；手滑带了也会剥掉
  "query?": { "limit": 50, "page": 2 },   // 键→字符串/数字/布尔
  "body?":  { "name": "x" },        // JSON 对象
  "file?":  { "path": "D:\\…\\a.zip", "field?": "attachment", "name?": "a.zip" }
}
```

- `file` 一出现就走 multipart/form-data；`body` 此时拆成表单字段
- GET / HEAD 不带 body / file
- 回执 `{ ok, status, body, truncated? }`：**2xx/4xx/5xx 都算发出去了**，`status` 是
  数据、解释权在你；`ok:false` 只表示根本没发出去（网络、配置、参数形状）
- body 超过 64KB 截断（`truncated: true`）——分页收窄再取
- 超时：普通 60s，带 file 10 分钟

## 配方

**建仓**（当前用户名下）：

```
gitea.http { "method": "POST", "path": "/user/repos", "body": { "name": "仓名", "private": true } }
```

**列仓**（分页：每页 limit，从 page 1 起）：

```
gitea.http { "method": "GET", "path": "/user/repos", "query": { "limit": 50, "page": 1 } }
```

**建 draft release**：

```
gitea.http { "method": "POST", "path": "/repos/{owner}/{repo}/releases",
  "body": { "tag_name": "v0.2.2", "name": "gwb v0.2.2", "draft": true } }
```

**传产物上 release**（回执里有 release 的 `id`）：

```
gitea.http { "method": "POST",
  "path": "/repos/{owner}/{repo}/releases/{id}/assets",
  "query": { "name": "gwb-setup-0.2.2.exe" },
  "file": { "path": "D:\\…\\gwb-setup-0.2.2.exe" } }
```

**列 release / 删草稿仓**：

```
gitea.http { "method": "GET",  "path": "/repos/{owner}/{repo}/releases" }
gitea.http { "method": "DELETE", "path": "/repos/{owner}/{repo}" }
```

## 状态码读法

| status | 意思 | 下一步 |
| --- | --- | --- |
| 401 | token 没配 / 失效 / scope 不够 | 检查 `gitea.token`；写接口要 api scope |
| 403 | token 对了但没权限动那个资源 | 换 token 或换资源 |
| 404 | 路径拼错，或私有仓对无权限者不可见 | 核对 owner/repo 拼写 |
| 409 | 已存在（同名仓、同 tag） | 换名或用现有的 |
| 422 | 参数不对 | 看 body 里的 message，gitea 说得很清楚 |

分页端点默认 `limit` 不大——列不全就翻 `page`，别以为是全量。
