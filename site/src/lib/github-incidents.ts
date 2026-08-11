// 构建时把 GitHub Issues 投影为 API-003(docs/DESIGN.md ADR-004、§8)
// 请求量:1 次列表 + 每条窗口内事故 2 次(comments+events);常规实例事故稀少,远低于 1000/h 限额
import {
  parseMaintenanceMeta,
  type Incident,
  type IncidentStage,
  type IncidentUpdate,
  type IncidentsApi,
  type MaintenanceRecord,
} from '@butus/schema'

const WINDOW_DAYS = 90
const STAGES = ['investigating', 'identified', 'monitoring'] as const

interface Issue {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  created_at: string
  closed_at: string | null
  html_url: string
  labels: Array<{ name: string }>
  user: { login: string }
  pull_request?: unknown
}

async function gh<T>(token: string, repo: string, path: string): Promise<T> {
  // §17:10s/次,失败重试 2 次指数退避
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`GitHub API ${path} → HTTP ${res.status}`)
      return (await res.json()) as T
    } catch (err) {
      if (attempt >= 3) throw err
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)))
    }
  }
}

export async function fetchIncidentsFromGitHub(
  token: string,
  repo: string,
  buildTime: string,
  knownIds: string[] = []
): Promise<IncidentsApi> {
  const cutoff = Date.parse(buildTime) - WINDOW_DAYS * 86400_000
  const issues: Issue[] = []
  try {
    // 分页至多 3 页(300 条,90 天窗口足够)
    for (let page = 1; page <= 3; page++) {
      const batch = await gh<Issue[]>(token, repo, `/issues?state=all&labels=status-page&per_page=100&page=${page}`)
      issues.push(...batch)
      if (batch.length < 100) break
    }
  } catch (err) {
    // 列表读不到就让构建失败:Pages 保留上一版页面(§17 等效「复用上次产物」),
    // 决不能把空事故集当成事实上线(正在宕机却显示 No incidents,审查缺陷 #3)
    throw new Error(`[incidents] failed to list issues after retries: ${(err as Error).message}`)
  }
  const inWindow = issues.filter(
    (i) => !i.pull_request && (i.state === 'open' || Date.parse(i.created_at) >= cutoff)
  )

  const DETAIL_LIMIT = 40 // §15:明细(comments+events)拉取上限,超出退化为仅开/关记录
  let detailFetched = 0
  let detailSkipped = 0
  const incidents: Incident[] = []
  const maintenances: MaintenanceRecord[] = []
  for (const issue of inWindow) {
    const labels = issue.labels.map((l) => l.name)
    if (labels.includes('maintenance')) {
      const withDetails = detailFetched < DETAIL_LIMIT
      if (withDetails) detailFetched++
      else detailSkipped++
      const rec = await projectMaintenance(token, repo, issue, buildTime, knownIds, withDetails)
      if (rec) maintenances.push(rec)
    } else if (labels.some((l) => l.startsWith('monitor:'))) {
      const withDetails = detailFetched < DETAIL_LIMIT
      if (withDetails) detailFetched++
      else detailSkipped++
      incidents.push(await projectIncident(token, repo, issue, withDetails))
    }
  }
  if (detailSkipped > 0) {
    console.error(`[incidents] detail fetch capped at ${DETAIL_LIMIT}; ${detailSkipped} older incident(s) show open/close records only`)
  }
  incidents.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  maintenances.sort((a, b) => b.start.localeCompare(a.start))
  return { version: 1, generatedAt: buildTime, incidents, maintenances }
}

async function projectIncident(token: string, repo: string, issue: Issue, withDetails = true): Promise<Incident> {
  const monitorId = issue.labels.find((l) => l.name.startsWith('monitor:'))!.name.slice('monitor:'.length)
  // 多阶段标签并存时取最靠后的阶段(维护者常忘摘旧标签,审查缺陷 #9)
  const stage: IncidentStage =
    issue.state === 'closed'
      ? 'resolved'
      : (([...STAGES].reverse().find((s) => issue.labels.some((l) => l.name === s)) ??
          'investigating') as IncidentStage)

  const updates: IncidentUpdate[] = [
    { at: issue.created_at, author: issue.user.login, kind: 'opened', body: issue.body ?? '', stage: 'investigating' },
  ]
  try {
    if (!withDetails) throw Object.assign(new Error('detail budget exhausted'), { skipLog: true })
    const comments = await gh<Array<{ created_at: string; body: string; user: { login: string } }>>(
      token, repo, `/issues/${issue.number}/comments?per_page=100`)
    for (const c of comments) updates.push({ at: c.created_at, author: c.user.login, kind: 'comment', body: c.body })
    const events = await gh<Array<{ event: string; created_at: string; label?: { name: string }; actor: { login: string } }>>(
      token, repo, `/issues/${issue.number}/events?per_page=100`)
    for (const e of events) {
      // 建单时刻附带的标签也会产生 labeled 事件,与 opened 节点重复,跳过 ±5s 内的(审核二 #9)
      if (
        e.event === 'labeled' && e.label && (STAGES as readonly string[]).includes(e.label.name) &&
        Math.abs(Date.parse(e.created_at) - Date.parse(issue.created_at)) > 5000
      ) {
        updates.push({ at: e.created_at, author: e.actor.login, kind: 'stage', body: '', stage: e.label.name as IncidentStage })
      }
    }
  } catch (err) {
    if (!(err as { skipLog?: boolean }).skipLog) {
      console.error(`[incidents] #${issue.number} detail fetch failed: ${(err as Error).message}`)
    }
  }
  if (issue.closed_at) {
    updates.push({ at: issue.closed_at, author: 'system', kind: 'resolved', body: '', stage: 'resolved' })
  }
  updates.sort((a, b) => a.at.localeCompare(b.at))

  const durationMinutes = issue.closed_at
    ? Math.max(0, Math.round((Date.parse(issue.closed_at) - Date.parse(issue.created_at)) / 60000))
    : null
  return {
    number: issue.number,
    title: issue.title,
    monitorId,
    stage,
    startedAt: issue.created_at,
    resolvedAt: issue.closed_at,
    durationMinutes,
    updates,
  }
}

async function projectMaintenance(
  token: string,
  repo: string,
  issue: Issue,
  buildTime: string,
  knownIds: string[],
  withDetails: boolean
): Promise<MaintenanceRecord | null> {
  const meta = parseMaintenanceMeta(issue.body) // 与 checker 侧共用 @butus/schema 的唯一实现
  if (!meta) {
    console.error(`[maintenance] issue #${issue.number} has no valid metadata block, skipped`)
    return null
  }
  // 与 checker 侧同口径:未知 monitor id 过滤并告警,防两份 API 自相矛盾(审核二 #11)
  if (knownIds.length) {
    const unknown = meta.monitors.filter((id) => !knownIds.includes(id))
    if (unknown.length) {
      console.error(`[maintenance] issue #${issue.number} references unknown monitor id(s): ${unknown.join(', ')}`)
      meta.monitors = meta.monitors.filter((id) => knownIds.includes(id))
    }
  }
  const now = Date.parse(buildTime)
  const state =
    issue.state === 'closed'
      ? Date.parse(issue.closed_at!) < Date.parse(meta.start)
        ? 'cancelled'
        : 'completed'
      : now < Date.parse(meta.start)
        ? 'scheduled'
        : now < Date.parse(meta.end)
          ? 'active'
          : 'completed'
  // REQ-018:维护公告的留言同样渲染进时间线(与事故同机制;1 次 comments 调用,共享明细预算)
  const updates: IncidentUpdate[] = [
    { at: issue.created_at, author: issue.user.login, kind: 'opened', body: issue.body ?? '' },
  ]
  if (withDetails) {
    try {
      const comments = await gh<Array<{ created_at: string; body: string; user: { login: string } }>>(
        token, repo, `/issues/${issue.number}/comments?per_page=100`)
      for (const c of comments) updates.push({ at: c.created_at, author: c.user.login, kind: 'comment', body: c.body })
    } catch (err) {
      console.error(`[maintenance] #${issue.number} comments fetch failed: ${(err as Error).message}`)
    }
  }
  updates.sort((a, b) => a.at.localeCompare(b.at))
  return {
    number: issue.number,
    title: issue.title,
    state,
    start: meta.start,
    end: meta.end,
    monitors: meta.monitors,
    updates,
  }
}
