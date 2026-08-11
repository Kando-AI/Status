// 构建时数据装载:配置 + data/ + 事故投影;站点内唯一数据入口(DATA-001)
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import {
  ConfigSchema,
  SnapshotSchema,
  colorForDay,
  resolveMonitors,
  uptimePct,
  type CheckRecord,
  type IncidentsApi,
  type ResolvedMonitor,
  type Snapshot,
  type SummaryApi,
  type SummaryFile,
} from '@butus/schema'
import { fetchIncidentsFromGitHub } from './github-incidents.ts'
import type { Lang } from './i18n'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
// env 传入的相对路径按项目根解析(astro build 的 cwd 是 site/)
const fromRoot = (p: string) => (isAbsolute(p) ? p : join(ROOT, p))
const DATA_DIR = fromRoot(process.env.DATA_DIR ?? 'data')
const CONFIG_PATH = fromRoot(process.env.CONFIG_PATH ?? 'status.config.yml')

export interface SiteData {
  site: { title: string; description?: string; logo?: string; lang: Lang }
  lang: Lang
  /** 页头 Logo:data URI 或外链 URL;未配置/文件缺失为 null(回退默认徽标点,REQ-017) */
  logo: string | null
  monitors: ResolvedMonitor[]
  groups: Array<{ name: string; monitors: ResolvedMonitor[] }>
  snapshot: Snapshot | null
  summaryApi: SummaryApi
  incidents: IncidentsApi
  checksByMonitor: Map<string, CheckRecord[]>
  repo: string | null
  repoUrl: string | null
  rawStatusUrl: string | null
  buildTime: string
}

let cached: SiteData | null = null

export async function loadSiteData(): Promise<SiteData> {
  if (cached) return cached
  const buildTime = new Date().toISOString()

  // 配置(构建侧不展开 $SECRET 引用,密钥只在 checker 侧使用)
  const config = ConfigSchema.parse(parse(readFileSync(CONFIG_PATH, 'utf8')))
  const monitors = resolveMonitors(config)
  const groupNames = [...new Set(monitors.map((m) => m.group))]
  const groups = groupNames.map((name) => ({ name, monitors: monitors.filter((m) => m.group === name) }))

  const snapshot = readJsonSafe(join(DATA_DIR, 'status.json'), (v) => SnapshotSchema.parse(v))

  const checksByMonitor = new Map<string, CheckRecord[]>()
  for (const m of monitors) {
    const file = join(DATA_DIR, 'checks', `${m.id}.ndjson`)
    if (!existsSync(file)) {
      checksByMonitor.set(m.id, [])
      continue
    }
    checksByMonitor.set(
      m.id,
      readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as CheckRecord)
    )
  }

  const incidents = await loadIncidents(buildTime, monitors.map((m) => m.id))
  const summaryApi = buildSummaryApi(monitors, incidents, buildTime)

  // REQ-017:构建时读取 Logo 并内联为 data URI(外链 URL 原样使用;缺失告警回退)
  let logo: string | null = null
  if (config.site.logo) {
    if (/^https?:\/\//.test(config.site.logo)) {
      logo = config.site.logo
    } else {
      const logoPath = fromRoot(config.site.logo)
      if (existsSync(logoPath)) {
        const ext = logoPath.split('.').pop()!.toLowerCase()
        const mime =
          ext === 'svg' ? 'image/svg+xml'
          : ext === 'png' ? 'image/png'
          : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
          : ext === 'webp' ? 'image/webp'
          : 'application/octet-stream'
        logo = `data:${mime};base64,${readFileSync(logoPath).toString('base64')}`
      } else {
        console.error(`[site] logo not found: ${config.site.logo} — falling back to default mark`)
      }
    }
  }

  const repo = process.env.GITHUB_REPOSITORY ?? null
  cached = {
    site: config.site,
    lang: config.site.lang,
    logo,
    monitors,
    groups,
    snapshot,
    summaryApi,
    incidents,
    checksByMonitor,
    repo,
    repoUrl: repo ? `https://github.com/${repo}` : null,
    rawStatusUrl: repo ? `https://raw.githubusercontent.com/${repo}/data/status.json` : null,
    buildTime,
  }
  return cached
}

function readJsonSafe<T>(path: string, parseFn: (v: unknown) => T): T | null {
  if (!existsSync(path)) return null
  try {
    return parseFn(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

async function loadIncidents(buildTime: string, knownIds: string[]): Promise<IncidentsApi> {
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY) {
    return fetchIncidentsFromGitHub(process.env.GITHUB_TOKEN, process.env.GITHUB_REPOSITORY, buildTime, knownIds)
  }
  const fixture = process.env.INCIDENTS_FIXTURE ? fromRoot(process.env.INCIDENTS_FIXTURE) : null
  if (fixture && existsSync(fixture)) {
    return JSON.parse(readFileSync(fixture, 'utf8')) as IncidentsApi
  }
  return { version: 1, generatedAt: buildTime, incidents: [], maintenances: [] }
}

/** API-002:30 天窗口 + 色条颜色 + 可用率(色/率规则唯一出处在 @butus/schema) */
function buildSummaryApi(monitors: ResolvedMonitor[], incidents: IncidentsApi, buildTime: string): SummaryApi {
  const days30 = [...Array(30)].map((_, i) => {
    const d = new Date(Date.parse(buildTime) - (29 - i) * 86400_000)
    return d.toISOString().slice(0, 10)
  })
  return {
    version: 1,
    generatedAt: buildTime,
    windowDays: 30,
    monitors: monitors.map((m) => {
      const summary = readJsonSafe(join(DATA_DIR, 'summary', `${m.id}.json`), (v) => v as SummaryFile)
      const byDate = new Map((summary?.days ?? []).map((d) => [d.date, d]))
      const maintDates = maintenanceDates(m.id, incidents)
      const days = days30.map((date) => {
        const day = byDate.get(date)
        return {
          date,
          total: day?.total ?? 0,
          up: day?.up ?? 0,
          degraded: day?.degraded ?? 0,
          down_count: day?.down_count ?? 0,
          down_minutes: day?.down_minutes ?? 0,
          avg_ms: day?.avg_ms ?? null,
          max_ms: day?.max_ms ?? null,
          color: colorForDay(day, maintDates.has(date)),
        }
      })
      const windowDays = days30.map((date) => byDate.get(date)).filter((d) => d !== undefined)
      return { id: m.id, name: m.name, group: m.group, uptimePct: uptimePct(windowDays), days }
    }),
  }
}

function maintenanceDates(monitorId: string, incidents: IncidentsApi): Set<string> {
  const dates = new Set<string>()
  for (const mt of incidents.maintenances) {
    // scheduled(未开始)不染色:未来的窗口不能把当天已发生的宕机红日提前盖成蓝(审核二 #3)
    if (!mt.monitors.includes(monitorId) || mt.state === 'cancelled' || mt.state === 'scheduled') continue
    for (let t = Date.parse(mt.start); t < Date.parse(mt.end); t += 86400_000) {
      dates.add(new Date(t).toISOString().slice(0, 10))
    }
    dates.add(new Date(Date.parse(mt.end) - 1).toISOString().slice(0, 10))
  }
  return dates
}

/** 当前状态优先快照,无数据时回落 null(页面显示 pending first check) */
export function monitorStatus(data: SiteData, id: string) {
  return data.snapshot?.monitors.find((m) => m.id === id) ?? null
}

export function emptySnapshot(buildTime: string): Snapshot {
  // 无任何探测数据时 overall=unknown:对 API 消费者不假绿,与徽章/首页口径一致(审核二 #13)
  return { version: 1, generatedAt: buildTime, runId: 'build', overall: 'unknown', monitors: [], activeMaintenances: [] }
}
