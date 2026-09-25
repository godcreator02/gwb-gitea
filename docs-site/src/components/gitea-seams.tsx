'use client'
/**
 * gwb-gitea 的接缝图：虚线框是插件包，框外是它连着的东西；每条跨过插件边界的线带一个编号。
 * 点编号高亮两端并在图下显示这条接缝的契约，点一个框只留下和它相连的接缝。
 * 编号与首页正文、docfirst.config.mjs 里 GiteaSeams 的机读文字一一对应，改一处三处一起改。
 */
import { useState } from 'react'

type EndId = 'agent' | 'commands' | 'settings' | 'skills' | 'handler' | 'core' | 'gitea' | 'disk'

interface Seam {
  n: number
  from: EndId
  to: EndId
  path: string
  badge: [number, number]
  onDisk?: boolean
  title: string
  carries: string
  owner: string
}

const SEAMS: Seam[] = [
  {
    n: 1,
    from: 'commands',
    to: 'handler',
    path: 'M210,118 H300',
    badge: [255, 118],
    title: '命令总线 → gitea.http 的处理函数',
    carries: 'commands.register({ name, description, usage }, handler)；handler 收到的 args 是 unknown，回 { ok: true, data } 或 { ok: false, error }',
    owner: '命令名、参数形状与回执字段由本插件定；登记要求（name、description、usage 非空）由命令总线定，缺了登记时抛错、插件加载失败',
  },
  {
    n: 2,
    from: 'settings',
    to: 'handler',
    path: 'M210,218 H250 V150 H300',
    badge: [250, 190],
    title: '设置 → 每次调用读地址与 token',
    carries: 'settings.define 两项：base-url（string）、token（secret）；每次调用 settings.get 现读，改了设置下一次调用就生效',
    owner: '键名与类型由本插件定；分区（gitea）由设置插件按条目 id 最后一段算出，存到哪个文件由设置插件管',
  },
  {
    n: 3,
    from: 'skills',
    to: 'handler',
    path: 'M210,318 H270 V176 H300',
    badge: [270, 290],
    title: '说明书插件 → 登记说明书目录',
    carries: 'gwbSkills.register(new URL("../skills/", import.meta.url))；目录下每个子目录是一份说明书，本包只有 gitea',
    owner: '本插件只交目录；收集子目录、按名字读由说明书插件负责。它没装时命令照常，只是 skill.list 里没有 gitea',
  },
  {
    n: 4,
    from: 'handler',
    to: 'gitea',
    path: 'M470,130 H560',
    badge: [515, 130],
    title: '处理函数 → gitea 实例的 REST API',
    carries: 'fetch(<base-url>/api/v1/<path>?<query>)，头 authorization: token <token>；body 是 JSON 或 multipart；超时 60 秒，带 file 的 10 分钟',
    owner: 'API 路径与状态码的含义由 gitea 定，插件不解释；2xx、4xx、5xx 都原样交回，只有没发出去才回 ok: false',
  },
  {
    n: 5,
    from: 'handler',
    to: 'disk',
    path: 'M470,170 H520 V300 H560',
    badge: [520, 240],
    onDisk: true,
    title: '处理函数 → 本机文件',
    carries: 'fs.readFileSync(file.path) 读进 multipart 的一个字段（缺省 attachment），文件名缺省取路径的最后一段',
    owner: '文件在哪由调用方给；读不到（路径错、没权限）和网络错误一样回 ok: false',
  },
]

const AGENT_SEAM = { path: 'M110,40 V96', badge: [110, 68] as [number, number] }

interface Box {
  id: EndId
  x: number
  y: number
  w: number
  h: number
  title: string
  detail: string
}

const BOXES: Box[] = [
  { id: 'agent', x: 40, y: 8, w: 140, h: 32, title: 'agent', detail: 'MCP 入口 run' },
  { id: 'commands', x: 40, y: 96, w: 170, h: 44, title: '命令总线', detail: 'gwbCommands' },
  { id: 'settings', x: 40, y: 196, w: 170, h: 44, title: '设置', detail: 'gwbSettings' },
  { id: 'skills', x: 40, y: 296, w: 170, h: 44, title: '说明书', detail: 'gwbSkills（局部注入）' },
  { id: 'handler', x: 300, y: 96, w: 170, h: 94, title: '命令处理', detail: 'index.ts · sendToGitea' },
  { id: 'core', x: 300, y: 250, w: 170, h: 90, title: '检查参数与整理回执', detail: 'core.ts' },
  { id: 'gitea', x: 560, y: 108, w: 170, h: 44, title: 'gitea 实例', detail: '/api/v1 · HTTPS' },
  { id: 'disk', x: 560, y: 278, w: 170, h: 44, title: '本机文件', detail: 'file.path' },
]

function seamTouches(seam: Seam, id: EndId): boolean {
  return seam.from === id || seam.to === id
}

export function GiteaSeams() {
  const [selectedSeam, setSelectedSeam] = useState<number | null>(1)
  const [selectedBox, setSelectedBox] = useState<EndId | null>(null)

  const activeSeam = SEAMS.find((seam) => seam.n === selectedSeam)

  function isSeamLit(seam: Seam): boolean {
    if (selectedBox !== null) return seamTouches(seam, selectedBox)
    return selectedSeam === seam.n
  }

  function isBoxLit(id: EndId): boolean {
    if (selectedBox !== null) return id === selectedBox || SEAMS.some((seam) => seamTouches(seam, selectedBox) && seamTouches(seam, id))
    if (activeSeam === undefined) return true
    return id === activeSeam.from || id === activeSeam.to
  }

  function pickSeam(n: number) {
    setSelectedBox(null)
    setSelectedSeam(n)
  }

  function pickBox(id: EndId) {
    setSelectedSeam(null)
    setSelectedBox((current) => (current === id ? null : id))
  }

  return (
    <div className="not-prose my-6 rounded-xl border border-fd-border bg-fd-card p-3 text-fd-foreground">
      <svg viewBox="0 0 760 380" role="img" aria-label="gwb-gitea 插件与它连着的五条接缝" className="w-full">
        <rect x={24} y={80} width={202} height={280} rx={10} fill="none" className="stroke-fd-border" strokeDasharray="5 4" />
        <text x={32} y={372} fontSize={11} className="fill-fd-muted-foreground">工作台里的别的插件</text>
        <rect x={284} y={80} width={202} height={280} rx={10} fill="none" className="stroke-fd-muted-foreground" strokeDasharray="5 4" />
        <text x={292} y={372} fontSize={11} className="fill-fd-muted-foreground">@godcreator/gwb-gitea · plugins/gitea</text>
        <path d="M385,190 V250" fill="none" className="stroke-fd-border" strokeWidth={1.2} />

        <path d={AGENT_SEAM.path} fill="none" className="stroke-fd-muted-foreground" strokeWidth={1.2} markerEnd="url(#gitea-arrow)" />
        <defs>
          <marker id="gitea-arrow" viewBox="0 0 8 8" refX={7} refY={4} markerWidth={7} markerHeight={7} orient="auto">
            <path d="M0,0 L8,4 L0,8 z" className="fill-fd-muted-foreground" />
          </marker>
        </defs>

        {SEAMS.map((seam) => (
          <path
            key={`line-${seam.n}`}
            d={seam.path}
            fill="none"
            strokeWidth={isSeamLit(seam) ? 2.4 : 1.2}
            strokeDasharray={seam.onDisk ? '5 4' : undefined}
            style={{ stroke: isSeamLit(seam) ? 'var(--gitea-seam-accent)' : 'var(--color-fd-border)', transition: 'stroke 200ms, stroke-width 200ms' }}
          />
        ))}

        {BOXES.map((box) => (
          <g
            key={box.id}
            onClick={() => pickBox(box.id)}
            style={{ cursor: 'pointer', opacity: isBoxLit(box.id) ? 1 : 0.35, transition: 'opacity 200ms' }}
          >
            <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={8} className="fill-fd-background stroke-fd-border" strokeWidth={1} />
            <text x={box.x + box.w / 2} y={box.y + box.h / 2 - 6} textAnchor="middle" fontSize={13} fontWeight={600} className="fill-fd-foreground">
              {box.title}
            </text>
            <text x={box.x + box.w / 2} y={box.y + box.h / 2 + 11} textAnchor="middle" fontSize={10.5} fontFamily="ui-monospace, monospace" className="fill-fd-muted-foreground">
              {box.detail}
            </text>
          </g>
        ))}

        {SEAMS.map((seam) => (
          <g key={`badge-${seam.n}`} onClick={() => pickSeam(seam.n)} style={{ cursor: 'pointer' }}>
            <circle
              cx={seam.badge[0]}
              cy={seam.badge[1]}
              r={11}
              className="fill-fd-background"
              strokeWidth={1.6}
              style={{ stroke: isSeamLit(seam) ? 'var(--gitea-seam-accent)' : 'var(--color-fd-muted-foreground)', transition: 'stroke 200ms' }}
            />
            <text x={seam.badge[0]} y={seam.badge[1]} textAnchor="middle" dominantBaseline="central" fontSize={11.5} fontWeight={700} className="fill-fd-foreground">
              {seam.n}
            </text>
          </g>
        ))}
      </svg>

      <div className="mt-2 flex flex-wrap gap-2">
        {SEAMS.map((seam) => (
          <button
            key={`button-${seam.n}`}
            type="button"
            onClick={() => pickSeam(seam.n)}
            className={`rounded-md border px-2 py-1 text-xs ${selectedSeam === seam.n ? 'border-[var(--gitea-seam-accent)] bg-[var(--gitea-seam-accent-soft)]' : 'border-fd-border'}`}
          >
            {seam.n} · {seam.title}
          </button>
        ))}
      </div>

      <div className="mt-3 min-h-28 rounded-lg border border-fd-border bg-fd-background p-3 text-sm">
        {activeSeam !== undefined ? (
          <>
            <p className="font-semibold">
              接缝 {activeSeam.n}：{activeSeam.title}
            </p>
            <p className="mt-1">
              <span className="text-fd-muted-foreground">传什么：</span>
              {activeSeam.carries}
            </p>
            <p className="mt-1">
              <span className="text-fd-muted-foreground">谁负责：</span>
              {activeSeam.owner}
            </p>
          </>
        ) : (
          <p className="text-fd-muted-foreground">
            {selectedBox !== null ? '只留下了和这个框相连的接缝，再点一次恢复。' : '点一个编号看这条接缝的契约。'}
          </p>
        )}
      </div>
      <p className="mt-2 text-xs text-fd-muted-foreground">实线是代码调用，虚线是读磁盘上的文件；插件框里两个方块之间的线是包内调用，不算接缝。</p>
    </div>
  )
}
