// GitHub Issue 集成:事故与维护的载体(docs/DESIGN.md §11 SM2/SM3、ADR-004)
import {
  parseMaintenanceMeta,
  type ActiveMaintenance,
  type ResolvedMonitor,
} from '@butus/schema'
import type { IncidentActions } from './lifecycle.ts'
import type { ProbeResult } from './probe.ts'
import { sendWebhook } from './webhook.ts'

const LABEL_MARKER = 'status-page'
const LABEL_MAINTENANCE = 'maintenance'

interface GitHubIssue {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  created_at: string
  html_url: string
  labels: Array<{ name: string }>
}

export interface GitHubContext {
  activeMaintenances: ActiveMaintenance[]
  applyActions(
    m: ResolvedMonitor,
    r: ProbeResult,
    actions: IncidentActions,
    openIncident: number | null,
    now: Date
  ): Promise<number | null>
}

class Api {
  constructor(
    private token: string,
    private repo: string
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `https://api.github.com/repos/${this.repo}${path}`
    // 写操作(POST/PATCH/PUT)单次不重试:响应丢失时重试会重复建单/留言,靠下一轮守卫幂等补齐(§17,审核二 #4)
    const maxAttempts = method === 'GET' ? 3 : 1
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(url, {
          method,
          headers: {
            authorization: `Bearer ${this.token}`,
            accept: 'application/vnd.github+json',
            'content-type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        })
        if (res.status === 204) return undefined as T
        if (res.ok) return (await res.json()) as T
        if (res.status >= 500 && attempt < maxAttempts) throw new Error(`HTTP ${res.status}`)
        throw new Error(`GitHub API ${method} ${path} → HTTP ${res.status}: ${await res.text()}`)
      } catch (err) {
        if (attempt === maxAttempts) throw err
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
      }
    }
    throw new Error('unreachable')
  }
}

async function listOpenStatusIssues(api: Api): Promise<GitHubIssue[]> {
  const all: Array<GitHubIssue & { pull_request?: unknown }> = []
  for (let page = 1; page <= 3; page++) {
    const batch = await api.request<Array<GitHubIssue & { pull_request?: unknown }>>(
      'GET',
      `/issues?state=open&labels=${LABEL_MARKER}&per_page=100&page=${page}`
    )
    all.push(...batch)
    if (batch.length < 100) break
  }
  return all.filter((i) => !i.pull_request) // /issues 端点会混入 PR,剔除
}

/** 实例仓库不会从模板复制标签;首轮确保标签集存在,维护者才能在 UI 里选用(审查缺陷 #5) */
async function ensureLabels(api: Api): Promise<void> {
  try {
    await api.request('GET', `/labels/${LABEL_MARKER}`)
    return // 标记标签已在,视为整套已初始化
  } catch {
    const labels = [
      { name: LABEL_MARKER, color: '6f7a8a', description: 'Managed by the status page' },
      { name: LABEL_MAINTENANCE, color: '3b76d6', description: 'Scheduled maintenance window' },
      { name: 'investigating', color: 'e0343a', description: 'Incident stage' },
      { name: 'identified', color: 'efb047', description: 'Incident stage' },
      { name: 'monitoring', color: '5e6ad2', description: 'Incident stage' },
    ]
    let failures = 0
    for (const l of labels) {
      try {
        await api.request('POST', '/labels', l)
      } catch (err) {
        const msg = (err as Error).message
        if (!msg.includes('422')) {
          // 422=已存在(幂等,忽略);其余(401/403 权限、网络)必须可见,否则维护者在 UI 找不到标签且无线索
          failures++
          console.error(`[labels] failed to create "${l.name}": ${msg}`)
        }
      }
    }
    console.log(
      failures
        ? `[labels] initialization incomplete (${failures} failure(s)) — check workflow issues:write permission`
        : '[labels] initialized status-page label set'
    )
  }
}

function parseMaintenance(issue: GitHubIssue, knownIds: string[]): ActiveMaintenance | null {
  const meta = parseMaintenanceMeta(issue.body) // CRLF 归一 + 围栏匹配 + schema 校验,单一实现在 @butus/schema
  if (!meta) {
    console.error(`[maintenance] issue #${issue.number} has no valid metadata block, ignoring`)
    return null
  }
  // 对照配置校验监控项 id:模板占位符/笔误若静默通过,页面显示维护中但误报抑制不生效(审查缺陷 #6)
  const unknown = meta.monitors.filter((id) => !knownIds.includes(id))
  if (unknown.length) {
    console.error(
      `[maintenance] issue #${issue.number} references unknown monitor id(s): ${unknown.join(', ')} — use ids from status.config.yml`
    )
  }
  return {
    number: issue.number,
    title: issue.title,
    start: meta.start,
    end: meta.end,
    monitors: meta.monitors.filter((id) => knownIds.includes(id)),
  }
}

/** GITHUB_TOKEN + GITHUB_REPOSITORY 存在时进入 GitHub 模式,否则返回 null(本地模式) */
async function prepare(now: Date, knownIds: string[]): Promise<GitHubContext | null> {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPOSITORY
  if (!token || !repo) return null
  const api = new Api(token, repo)

  await ensureLabels(api)
  const open = await listOpenStatusIssues(api)
  const maintenanceIssues = open.filter((i) => i.labels.some((l) => l.name === LABEL_MAINTENANCE))

  // SM3:窗口结束 → 自动关闭(active→completed);未结束的收集为窗口集
  const maintenances: ActiveMaintenance[] = []
  for (const issue of maintenanceIssues) {
    const meta = parseMaintenance(issue, knownIds)
    if (!meta) continue
    if (now.getTime() >= Date.parse(meta.end)) {
      await api.request('POST', `/issues/${issue.number}/comments`, {
        body: `Maintenance window ended at ${meta.end}. Closing automatically.`,
      })
      await api.request('PATCH', `/issues/${issue.number}`, { state: 'closed' })
      console.log(`[maintenance] closed expired window #${issue.number}`)
    } else if (Date.parse(meta.start) <= now.getTime()) {
      maintenances.push(meta)
    }
    // start 在未来的 scheduled 窗口不进快照 activeMaintenances,由站点构建经 API-003 呈现预告
  }

  const openIncidentByMonitor = new Map<string, GitHubIssue>()
  for (const issue of open) {
    const label = issue.labels.find((l) => l.name.startsWith('monitor:'))
    if (label && !issue.labels.some((l) => l.name === LABEL_MAINTENANCE)) {
      openIncidentByMonitor.set(label.name.slice('monitor:'.length), issue)
    }
  }

  return {
    activeMaintenances: maintenances,
    async applyActions(m, r, actions, openIncident, now) {
      // 守卫「无该项 open 事故」以 GitHub 实况为准(快照可能落后,见 §16 竞态表)
      const existing = openIncidentByMonitor.get(m.id) ?? null
      if (actions.openIssue) {
        if (existing) return existing.number // 幂等:已有 open 事故,不重复开
        const startedAt = now.toISOString()
        const issue = await new Api(process.env.GITHUB_TOKEN!, process.env.GITHUB_REPOSITORY!).request<GitHubIssue>(
          'POST',
          '/issues',
          {
            title: `🔴 ${m.name} is down`,
            body: [
              `**${m.name}** (\`${m.id}\`) is down.`,
              '',
              `- Started at: ${startedAt} (UTC)`,
              `- Reason: \`${r.reason ?? 'unknown'}\``,
              `- Run: ${process.env.GITHUB_RUN_ID ?? 'local'}`,
              '',
              '_This issue was opened automatically. Maintainers can post updates below and move the stage label (investigating → identified → monitoring). It will be closed automatically when checks recover._',
            ].join('\n'),
            labels: [LABEL_MARKER, `monitor:${m.id}`, 'investigating'],
          }
        )
        await new Api(process.env.GITHUB_TOKEN!, process.env.GITHUB_REPOSITORY!)
          .request('PUT', `/issues/${issue.number}/lock`, { lock_reason: 'off-topic' })
          .catch((err) => console.error(`[incident] lock failed: ${(err as Error).message}`))
        console.log(`[incident] opened #${issue.number} for ${m.id}`)
        await sendWebhook({
          version: 1,
          event: 'incident_open',
          text: `🔴 ${m.name} is down (${r.reason ?? 'unknown'})`,
          monitor: { id: m.id, name: m.name },
          reason: r.reason,
          startedAt,
          incidentUrl: issue.html_url,
        })
        return issue.number
      }
      if (actions.closeIssue) {
        const issue = existing ?? (openIncident !== null ? await getIssueSafe(openIncident) : null)
        if (!issue || issue.state !== 'open') return null // 幂等:已被人工关闭
        const durationMinutes = Math.max(0, Math.round((now.getTime() - Date.parse(issue.created_at)) / 60000))
        const api = new Api(process.env.GITHUB_TOKEN!, process.env.GITHUB_REPOSITORY!)
        // GITHUB_TOKEN 不能在锁定的 Issue 上留言(403):先解锁→留言→关闭→重新锁定归档(演练 RUN-008 发现)
        await api.request('DELETE', `/issues/${issue.number}/lock`).catch(() => {})
        await api.request('POST', `/issues/${issue.number}/comments`, {
          body: `✅ **Resolved.** ${m.name} recovered after **${durationMinutes} minutes** of downtime.`,
        })
        await api.request('PATCH', `/issues/${issue.number}`, { state: 'closed' })
        await api
          .request('PUT', `/issues/${issue.number}/lock`, { lock_reason: 'resolved' })
          .catch((err) => console.error(`[incident] re-lock failed: ${(err as Error).message}`))
        console.log(`[incident] closed #${issue.number} for ${m.id} (${durationMinutes}min)`)
        await sendWebhook({
          version: 1,
          event: 'incident_resolved',
          text: `✅ ${m.name} recovered after ${durationMinutes} minutes`,
          monitor: { id: m.id, name: m.name },
          reason: null,
          startedAt: issue.created_at,
          resolvedAt: now.toISOString(),
          durationMinutes,
          incidentUrl: issue.html_url,
        })
        return null
      }
      // 无动作分支不认领 existing:operational 监控项下维护者手工开的公告 Issue
      // 一旦被认领,下一轮会被 closeIssue 误关(审核二 #7);真实 down 的认领走 openIssue 分支
      return openIncident
    },
  }

  async function getIssueSafe(number: number): Promise<GitHubIssue | null> {
    try {
      return await api.request<GitHubIssue>('GET', `/issues/${number}`)
    } catch {
      return null
    }
  }
}

export const syncGitHub = { prepare }
