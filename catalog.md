# catalog · gwb-gitea

插件的身份卡：是谁、提供什么、靠谁。命令清单不存卡——现扫门的 `index`。
登记面变了这张卡要跟着改，`tests/catalog.test.ts` 钉着防漏（正本住 @godcreator/gwb-repo-kit）。

**定位**：gitea 的通用 HTTP 手——一条 `gitea.http` 把 agent 组装好的 API 调用发往设置里的 gitea 实例（补 /api/v1、注 token、整形回执）；语义住随包发的 skills/SKILL.md（cookbook），代码只做管道。spec 在单元根 `../spec/gitea.md`。

## 提供

（无服务——命令经总线直接面客）

## 依赖

`gwbCommands`、`gwbSettings`（硬依赖，inject）；`gwbSkills` 局部注入挂说明书。包级 peer：gwb-plugin-api / gwb-commands / gwb-settings / gwb-skills

## 命令

命令清单不存卡——**现扫门的 `index`**。出厂自带 `gitea.http`。
