import type { GwbResult } from '@godcreator/gwb-commands/client'
import type { HostBridge, PaneArgs, PaneHandle } from '@godcreator/gwb-shell/pane'
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { groupByRepo, issueKey, KIND_LABEL, type IssueDetail, type IssueRow } from '../core.js'
import { formatTime, OPEN_IN_GITEA_TARGET, REFRESH_VARIANT } from './labels.js'

async function listIssues(host: HostBridge): Promise<IssueRow[]> {
  const reply = (await host.call('gitea-issues.list', {})) as GwbResult<{ issues: IssueRow[] }>
  if (!reply.ok) throw new Error(`gitea-issues.list 没成功：${reply.error ?? '回执没写原因'}`)
  return reply.data?.issues ?? []
}

async function readDetail(host: HostBridge, issue: IssueRow): Promise<IssueDetail> {
  const reply = (await host.call('gitea-issues.detail', { repo: issue.repo, number: issue.number })) as GwbResult<IssueDetail>
  if (!reply.ok || reply.data === undefined) throw new Error(`gitea-issues.detail 没成功：${reply.error ?? '回执没写原因'}`)
  return reply.data
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function IssueList({ issues, selectedKey, onSelect }: {
  issues: IssueRow[]
  selectedKey: string | null
  onSelect: (issue: IssueRow) => void
}): ReactElement {
  return (
    <div className="giteaissues:space-y-4 giteaissues:p-3">
      {groupByRepo(issues).map((group) => (
        <section key={group.repo} className="giteaissues:space-y-1">
          <div className="giteaissues:flex giteaissues:items-center giteaissues:gap-2 giteaissues:px-2">
            <span className="giteaissues:truncate giteaissues:text-sm giteaissues:font-semibold">{group.repo}</span>
            <Badge variant="secondary">{group.issues.length}</Badge>
          </div>
          {group.issues.map((issue) => (
            <Button
              key={issueKey(issue)}
              variant={selectedKey === issueKey(issue) ? 'secondary' : 'ghost'}
              className="giteaissues:w-full giteaissues:justify-start giteaissues:gap-2"
              onClick={() => onSelect(issue)}
            >
              <span className="giteaissues:text-muted-foreground">#{issue.number}</span>
              {issue.kind === 'pull' ? <Badge variant="secondary">{KIND_LABEL.pull}</Badge> : null}
              <span className="giteaissues:min-w-0 giteaissues:flex-1 giteaissues:truncate giteaissues:text-left">{issue.title}</span>
              {issue.commentCount > 0 ? <span className="giteaissues:text-muted-foreground">{issue.commentCount} 评论</span> : null}
            </Button>
          ))}
        </section>
      ))}
    </div>
  )
}

function IssueView({ detail }: { detail: IssueDetail }): ReactElement {
  return (
    <article className="giteaissues:space-y-4 giteaissues:p-4">
      <header className="giteaissues:space-y-2">
        <h2 className="giteaissues:text-lg giteaissues:font-semibold">{detail.title}</h2>
        <div className="giteaissues:flex giteaissues:flex-wrap giteaissues:items-center giteaissues:gap-2 giteaissues:text-sm giteaissues:text-muted-foreground">
          <Badge variant="secondary">{KIND_LABEL[detail.kind]}</Badge>
          <span>{detail.repo} #{detail.number}</span>
          <span>{detail.author} 开于 {formatTime(detail.createdAt)}</span>
          <Button variant="link" asChild>
            <a href={detail.url} target={OPEN_IN_GITEA_TARGET} rel="noreferrer">在 gitea 打开</a>
          </Button>
        </div>
      </header>
      <p className="giteaissues:whitespace-pre-wrap giteaissues:break-words giteaissues:text-sm">{detail.body === '' ? '（没有正文）' : detail.body}</p>
      {detail.comments.map((comment, index) => (
        <section key={index} className="giteaissues:space-y-1 giteaissues:border-t giteaissues:pt-3">
          <div className="giteaissues:text-sm giteaissues:text-muted-foreground">{comment.author} · {formatTime(comment.createdAt)}</div>
          <p className="giteaissues:whitespace-pre-wrap giteaissues:break-words giteaissues:text-sm">{comment.body}</p>
        </section>
      ))}
    </article>
  )
}

function IssuesPane({ args }: { args: PaneArgs }): ReactElement {
  const [issues, setIssues] = useState<IssueRow[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<IssueRow | null>(null)
  const [detail, setDetail] = useState<IssueDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setIssues(await listIssues(args.host))
      setListError(null)
    } catch (error) {
      setListError(errorText(error))
    } finally {
      setLoading(false)
    }
  }, [args.host])

  useEffect(() => args.shell.onVisibility((visible) => { if (visible) void refresh() }), [args.shell, refresh])

  const select = useCallback(async (issue: IssueRow) => {
    setSelected(issue)
    setDetail(null)
    setDetailError(null)
    try {
      setDetail(await readDetail(args.host, issue))
    } catch (error) {
      setDetailError(errorText(error))
    }
  }, [args.host])

  return (
    <div className="giteaissues:flex giteaissues:h-full giteaissues:flex-col">
      <div className="giteaissues:flex giteaissues:items-center giteaissues:gap-3 giteaissues:border-b giteaissues:px-4 giteaissues:py-2">
        <span className="giteaissues:font-semibold">开着的 issue 与合并请求</span>
        {issues !== null ? <Badge variant="secondary">{issues.length}</Badge> : null}
        <Button variant={REFRESH_VARIANT} size="sm" disabled={loading} onClick={() => void refresh()} className="giteaissues:ml-auto">
          {loading ? '正在查…' : '刷新'}
        </Button>
      </div>
      {listError !== null ? <p className="giteaissues:px-4 giteaissues:py-2 giteaissues:text-sm giteaissues:text-destructive">{listError}</p> : null}
      <div className="giteaissues:flex giteaissues:min-h-0 giteaissues:flex-1 giteaissues:flex-col giteaissues:@md:flex-row">
        <ScrollArea className="giteaissues:max-h-[40%] giteaissues:border-b giteaissues:@md:max-h-none giteaissues:@md:w-80 giteaissues:@md:border-r giteaissues:@md:border-b-0">
          {issues !== null && issues.length === 0 ? <p className="giteaissues:p-4 giteaissues:text-sm giteaissues:text-muted-foreground">没有开着的 issue 与合并请求</p> : null}
          {issues !== null ? <IssueList issues={issues} selectedKey={selected === null ? null : issueKey(selected)} onSelect={(issue) => void select(issue)} /> : null}
        </ScrollArea>
        <ScrollArea className="giteaissues:min-h-0 giteaissues:flex-1">
          {selected === null ? <p className="giteaissues:p-4 giteaissues:text-sm giteaissues:text-muted-foreground">点一条看正文与评论</p> : null}
          {detailError !== null ? <p className="giteaissues:p-4 giteaissues:text-sm giteaissues:text-destructive">{detailError}</p> : null}
          {selected !== null && detail === null && detailError === null ? <p className="giteaissues:p-4 giteaissues:text-sm giteaissues:text-muted-foreground">正在读…</p> : null}
          {detail !== null ? <IssueView detail={detail} /> : null}
        </ScrollArea>
      </div>
    </div>
  )
}

export function mountPane(args: PaneArgs, container: HTMLElement): PaneHandle {
  const root = createRoot(container)
  root.render(<IssuesPane args={args} />)
  return {
    dispose() {
      root.unmount()
      container.replaceChildren()
    },
  }
}
