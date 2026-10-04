---
name: gitea
description: 要对 gitea 发 API 调用时读——建仓（个人名下或组织里）、发 release、传产物、列仓、查 npm 包、团队与成员、分支保护、合并请求的留言与合并。讲 gitea.http 的参数形状、回执怎么读、token 勾哪些权限、常用调用的写法与状态码读法。具体做法全在这份说明书里，插件只负责把请求发出去，没有第二条专用命令。
---

# 用 gitea.http 调 gitea API

这个插件只有一条命令 `gitea.http`，能发任意 gitea REST API 调用：你（agent）按 gitea 的 API 文档拼好调用，
它负责补 `/api/v1` 前缀、带上 token、发请求、整理回执。**没有**建仓命令、发版命令——那些是下面的调用写法，不是代码。

## 先配 token（只做一次）

1. gitea 网页 → 右上头像 → 设置 → 应用 → 生成新令牌。gitea 按资源细分权限，每一项选「无 / 读 / 读写」，没有单独的 api 一项。
   照要调的接口勾，下表是常用的几项：

   | 要做的 | 勾哪一项 |
   | --- | --- |
   | 读写仓库：个人名下建仓、发 release、传产物、改仓库设置与分支保护、合并请求 | 仓库 读写 |
   | 列组织的仓与团队 | 组织 读 |
   | 在组织里建仓、管团队成员 | 组织 读写 |
   | 读写工单、合并请求下的留言 | 工单 读 / 读写 |
   | 查、传 npm 包 | 包 读 / 读写 |
   | 确认 token 是谁（`GET /user`） | 用户 读 |

   用 gwb-collab 的，照它的说明书 `collab-project`「加入项目」第 3 步勾那四项
2. 写进设置：`settings.set { "section": "gitea", "key": "token", "value": "<token>" }`
   （secret 型，不随包发布）。token 由人生成、由人填，你不经手
3. 确认连得上（不需要 token）：`gitea.http { "method": "GET", "path": "/version" }` →
   `status: 200`
4. 确认 token 有效：`gitea.http { "method": "GET", "path": "/user" }` →
   `status: 200`，body 里是 token 所属账号的登录名

`gitea.base-url` 设置项默认 `https://git.tianshen02.online:28377`，换实例才改它。换实例时一起改 `gitea.push-url`：
那台 gitea 旁边的推送服务 ntfy 的地址（默认 `https://ntfy.tianshen02.online:28377`），gwb-collab 订阅它来马上知道 gitea 上的事件。

## 命令形状

```
gitea.http {
  "method": "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD",
  "path":   "/user/repos",          // 不带 /api/v1，插件会补；多写了也会去掉
  "query?": { "limit": 50, "page": 2 },   // 键→字符串/数字/布尔
  "body?":  { "name": "x" },        // JSON 对象
  "file?":  { "path": "D:\\…\\a.zip", "field?": "attachment", "name?": "a.zip" }
}
```

- 带 `file` 就按 multipart/form-data 发；这时 `body` 的每个字段变成表单字段
- GET / HEAD 不带 body / file
- 回执 `{ ok: true, data: { status, truncated, note?, body } }`：**2xx/4xx/5xx 都算发出去了**，`status` 怎么解释由你决定；
  `ok: false` 只表示根本没发出去（网络、配置、参数形状），`error` 里写了往哪查
- body 超过 64KB 截断（`truncated: true`，`note` 里有提示）——用 query 分页再取，或者改调只回一项的接口
- 超时：普通 60 秒，带 file 10 分钟

## 常用调用

下面的 `{owner}` 是用户名或组织名，`{org}` 是组织名。

### 仓库

**建仓**（当前用户名下 / 组织里）：

```
gitea.http { "method": "POST", "path": "/user/repos", "body": { "name": "仓名", "private": true } }
gitea.http { "method": "POST", "path": "/orgs/{org}/repos",
  "body": { "name": "仓名", "private": true, "default_branch": "main", "auto_init": true } }
```

**列仓**（分页：每页 limit，从 page 1 起）：

```
gitea.http { "method": "GET", "path": "/user/repos", "query": { "limit": 50, "page": 1 } }
gitea.http { "method": "GET", "path": "/orgs/{org}/repos", "query": { "limit": 50, "page": 1 } }
```

**限定合并方式**（例：只留「合并提交」与「仅快进」）：

```
gitea.http { "method": "PATCH", "path": "/repos/{owner}/{repo}",
  "body": { "allow_merge_commits": true, "allow_fast_forward_only_merge": true,
            "allow_squash_merge": false, "allow_rebase": false, "allow_rebase_explicit": false,
            "default_merge_style": "merge" } }
```

**删仓**（删了就回不来，只删自己刚建、确定不要的草稿仓；别人的仓、有内容的仓让人自己在网页上删）：

```
gitea.http { "method": "DELETE", "path": "/repos/{owner}/{repo}" }
```

### 发版与包

**建 draft release**：

```
gitea.http { "method": "POST", "path": "/repos/{owner}/{repo}/releases",
  "body": { "tag_name": "v0.2.2", "name": "gwb v0.2.2", "draft": true } }
```

**传产物上 release**（建 release 的回执里有它的 `id`）：

```
gitea.http { "method": "POST",
  "path": "/repos/{owner}/{repo}/releases/{id}/assets",
  "query": { "name": "gwb-setup-0.2.2.exe" },
  "file": { "path": "D:\\…\\gwb-setup-0.2.2.exe" } }
```

**列 release / 查 npm 包**：

```
gitea.http { "method": "GET", "path": "/repos/{owner}/{repo}/releases" }
gitea.http { "method": "GET", "path": "/packages/{owner}", "query": { "type": "npm", "q": "包名" } }
```

### 组织的团队与成员

每个组织自带一个 `Owners` 团队（组织所有者，删不掉）；别的团队给的是对一组仓的权限。

```
gitea.http { "method": "GET", "path": "/orgs/{org}/teams" }                 // 回执里每个团队有 id
gitea.http { "method": "GET", "path": "/teams/{id}/members" }
gitea.http { "method": "PUT", "path": "/teams/{id}/members/{username}" }    // 加人，204
gitea.http { "method": "DELETE", "path": "/teams/{id}/members/{username}" } // 移出，204
```

### 分支保护

一个仓的每条保护规则按规则名（通常就是分支名）记。白名单可以写用户名，也可以写组织里的团队名，写团队的话换人只改团队成员：

```
gitea.http { "method": "GET", "path": "/repos/{owner}/{repo}/branch_protections" }
gitea.http { "method": "POST", "path": "/repos/{owner}/{repo}/branch_protections",
  "body": { "rule_name": "main", "enable_push": true,
            "enable_push_whitelist": true, "push_whitelist_usernames": ["维护者"], "push_whitelist_teams": ["Owners"],
            "enable_merge_whitelist": true, "merge_whitelist_usernames": ["维护者"], "merge_whitelist_teams": ["Owners"],
            "enable_force_push": false } }
gitea.http { "method": "PATCH", "path": "/repos/{owner}/{repo}/branch_protections/main",
  "body": { "push_whitelist_usernames": [], "push_whitelist_teams": ["Owners"] } }
```

`PATCH` 只改给出的字段，白名单给的是整份新名单，不是追加。改完用 `GET /repos/{owner}/{repo}/branches/main` 核对：
回执里的 `protected`、`user_can_push`、`user_can_merge` 是按 token 所属账号算的。

### 合并请求

```
gitea.http { "method": "GET", "path": "/repos/{owner}/{repo}/pulls", "query": { "state": "open" } }
gitea.http { "method": "POST", "path": "/repos/{owner}/{repo}/issues/{number}/comments", "body": { "body": "留言正文" } }
gitea.http { "method": "POST", "path": "/repos/{owner}/{repo}/pulls/{number}/merge", "body": { "Do": "merge" } }
```

合并请求的留言走 `issues/{number}/comments`，编号和合并请求是同一个。`Do` 写合并方式（`merge`、`fast-forward-only` 等），
仓库没开的方式回 405。合并、留言都会以 token 所属账号的名义出现在网页上：替人做之前先问清楚。

## 状态码读法

| status | 意思 | 下一步 |
| --- | --- | --- |
| 401 | token 没配、填错或已失效 | 检查 `gitea.token`，让人重新生成 |
| 403，原话里有 `required=[…]` | token 少勾了一项权限，`required` 里写的就是缺的那一项，`token scope` 是现有的 | 让人照它重新生成 token |
| 403，没有 `required` | token 所属账号对那个资源没权限（不是团队成员、不是仓的管理员） | 换有权限的账号，或请管理员授权 |
| 404 | 路径拼错，或私有仓、私有组织对无权限者不可见 | 核对 owner/repo 拼写与账号的权限 |
| 405 | 这个操作在仓库设置里没开（例：没开的合并方式） | 换一种开着的，或先改仓库设置 |
| 409 | 已存在（同名仓、同 tag） | 换名或用现有的 |
| 422 | 参数不对 | 看 body 里的 message，gitea 写得很清楚 |

分页接口默认 `limit` 不大——列不全就翻 `page`，别当成全量。
