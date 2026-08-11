// checker.run 单轮入口(docs/DESIGN.md §12 时序、§17 内部后台任务)
// 用法:tsx packages/checker/src/index.ts [--config status.config.yml] [--data-dir data] [--maintenances <json>]
import { existsSync, readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import {
  nextStatus,
  overallStatus,
  type ActiveMaintenance,
  type Snapshot,
  type SnapshotMonitor,
} from '@butus/schema'
import { ConfigError, loadConfig } from './config.ts'
import { appendAndTrim, mergeSummary, readSnapshot, writeSnapshot } from './data.ts'
import { decideIncidentActions, inMaintenance } from './lifecycle.ts'
import { runAttempts, type ProbeResult } from './probe.ts'
import { syncGitHub } from './github.ts'

const PROBE_CONCURRENCY = 10

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', default: 'status.config.yml' },
      'data-dir': { type: 'string', default: 'data' },
      maintenances: { type: 'string' },
    },
  })
  const dataDir = values['data-dir']!
  const now = new Date()
  const runId = process.env.GITHUB_RUN_ID ?? 'local'

  let loaded
  try {
    loaded = loadConfig(values.config!)
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message)
      return 1
    }
    throw err
  }
  const { monitors } = loaded
  const prev = readSnapshot(dataDir)
  const prevById = new Map(prev?.monitors.map((m) => [m.id, m]) ?? [])

  // 维护窗口来源:GitHub 模式下由 github.ts 读取 Issue;本地模式可用 --maintenances 注入 fixture
  // GitHub API 失败不允许拖垮整轮:降级为本地模式、沿用上次快照的维护窗口,数据照常落盘(§17 降级承诺)
  let gh: Awaited<ReturnType<typeof syncGitHub.prepare>> = null
  let ghFailed = false
  try {
    gh = await syncGitHub.prepare(now, monitors.map((m) => m.id))
  } catch (err) {
    ghFailed = true
    console.error(`[github] prepare failed, degrading to local mode this round: ${(err as Error).message}`)
  }
  let maintenances: ActiveMaintenance[] = gh
    ? gh.activeMaintenances
    : ghFailed
      ? (prev?.activeMaintenances ?? [])
      : []
  if (!gh && !ghFailed && values.maintenances && existsSync(values.maintenances)) {
    maintenances = JSON.parse(readFileSync(values.maintenances, 'utf8')) as ActiveMaintenance[]
  }

  // 并发探测(上限 10,docs/DESIGN.md §15)
  const results = new Map<string, ProbeResult>()
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, monitors.length) }, async () => {
      while (cursor < monitors.length) {
        const m = monitors[cursor++]!
        results.set(m.id, await runAttempts(m, 3, undefined, (l) => console.log(l)))
      }
    })
  )

  const snapshotMonitors: SnapshotMonitor[] = []
  for (const m of monitors) {
    const r = results.get(m.id)!
    const maint = inMaintenance(m.id, maintenances, now)
    const status = nextStatus(r.outcome, maint)
    const prevMon = prevById.get(m.id)
    let openIncident = prevMon?.openIncident ?? null

    const actions = decideIncidentActions(status, openIncident)
    if (gh) {
      try {
        openIncident = await gh.applyActions(m, r, actions, openIncident, now)
      } catch (err) {
        // Issue 动作失败不拖垮整轮:openIncident 保持原值,守卫幂等,下轮重试(§17)
        console.error(`[${m.id}] issue action failed (will retry next round): ${(err as Error).message}`)
      }
    } else if (ghFailed) {
      // 降级轮:Issue 实际没动,引用必须保留,下轮 API 恢复后由守卫幂等补齐(审核二 #1)
      if (actions.openIssue || actions.closeIssue) {
        console.log(`[${m.id}] issue action deferred (GitHub unavailable, will retry next round)`)
      }
    } else {
      if (actions.openIssue) console.log(`[${m.id}] would open incident issue (no GitHub context, skipped)`)
      if (actions.closeIssue) {
        console.log(`[${m.id}] would close incident #${openIncident} (no GitHub context, skipped)`)
        openIncident = null
      }
    }

    const checks = appendAndTrim(
      dataDir,
      m.id,
      { t: now.toISOString(), o: r.outcome, ms: r.ms, reason: r.reason, ...(maint ? { maint: true } : {}) },
      now
    )
    mergeSummary(dataDir, m.id, checks, now)

    snapshotMonitors.push({
      id: m.id,
      name: m.name,
      group: m.group,
      status,
      ms: r.ms,
      reason: r.reason,
      lastCheckedAt: now.toISOString(),
      since: prevMon && prevMon.status === status ? prevMon.since : now.toISOString(),
      openIncident,
    })
    console.log(`[${m.id}] status=${status}${maint ? ' (maintenance)' : ''}`)
  }

  const snapshot: Snapshot = {
    version: 1,
    generatedAt: now.toISOString(),
    runId,
    overall: overallStatus(snapshotMonitors.map((m) => m.status)),
    monitors: snapshotMonitors,
    activeMaintenances: maintenances,
  }
  writeSnapshot(dataDir, snapshot)

  const changed = hasStatusChanged(prev, snapshot)
  console.log(`overall=${snapshot.overall} changed=${changed}`)
  // 供工作流判定是否触发构建(docs/DESIGN.md ADR-005)
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs')
    appendFileSync(process.env.GITHUB_OUTPUT, `status_changed=${changed}\n`)
  }
  return 0
}

function hasStatusChanged(prev: Snapshot | null, next: Snapshot): boolean {
  if (!prev) return true
  if (prev.overall !== next.overall) return true
  // openIncident 也参与比较:状态未变但事故 Issue 开/关的轮次同样要触发重建(审核二 #8)
  const sig = (m: Snapshot['monitors'][number]) => `${m.status}:${m.openIncident ?? ''}`
  const prevMap = new Map(prev.monitors.map((m) => [m.id, sig(m)]))
  return (
    next.monitors.some((m) => prevMap.get(m.id) !== sig(m)) ||
    prev.monitors.length !== next.monitors.length ||
    JSON.stringify(prev.activeMaintenances) !== JSON.stringify(next.activeMaintenances)
  )
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err)
    process.exit(1)
  }
)
