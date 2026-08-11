import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

// ---- 枚举(唯一权威出处:docs/DESIGN.md §9;只增不改义) ----

export const OUTCOMES = ['up', 'degraded', 'down'] as const
// 'unknown' 仅用于空快照(实例尚无任何探测数据)的 overall,checker 判定永不产出它(只增不改义)
export const MONITOR_STATUSES = ['operational', 'degraded', 'down', 'maintenance', 'unknown'] as const
export const REASON_CODES = [
  'timeout',
  'dns_error',
  'conn_refused',
  'tls_error',
  'http_4xx',
  'http_5xx',
  'http_unexpected',
  'keyword_missing',
] as const
export const INCIDENT_STAGES = ['investigating', 'identified', 'monitoring', 'resolved'] as const
export const MAINTENANCE_STATES = ['scheduled', 'active', 'completed', 'cancelled'] as const
export const DAY_COLORS = ['green', 'yellow', 'red', 'blue', 'gray'] as const
export const MONITOR_TYPES = ['http', 'keyword', 'tcp'] as const

export type Outcome = (typeof OUTCOMES)[number]
export type MonitorStatus = (typeof MONITOR_STATUSES)[number]
export type ReasonCode = (typeof REASON_CODES)[number]
export type IncidentStage = (typeof INCIDENT_STAGES)[number]
export type MaintenanceState = (typeof MAINTENANCE_STATES)[number]
export type DayColor = (typeof DAY_COLORS)[number]

// ---- 配置(status.config.yml) ----

const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be a lowercase slug (a-z, 0-9, -)')

export const MonitorConfigSchema = z
  .object({
    name: z.string().min(1),
    id: slug.optional(),
    group: z.string().min(1).default('Services'),
    type: z.enum(MONITOR_TYPES).default('http'),
    target: z.string().min(1),
    keyword: z.string().min(1).optional(),
    expectedStatus: z.string().default('2xx,3xx'),
    headers: z.record(z.string(), z.string()).optional(),
    timeoutMs: z.number().int().min(1000).max(30000).optional(),
    degradedThresholdMs: z.number().int().min(1).optional(),
  })
  .superRefine((m, ctx) => {
    if (m.type === 'keyword' && !m.keyword) {
      ctx.addIssue({ code: 'custom', path: ['keyword'], message: 'keyword is required when type=keyword' })
    }
    if (m.type === 'tcp') {
      const match = m.target.match(/^[^\s:]+:(\d+)$/)
      const port = match ? Number(match[1]) : NaN
      if (!match || port < 1 || port > 65535) {
        ctx.addIssue({ code: 'custom', path: ['target'], message: 'tcp target must be host:port with port 1-65535' })
      }
    }
    if ((m.type === 'http' || m.type === 'keyword') && !/^https?:\/\//.test(m.target)) {
      ctx.addIssue({ code: 'custom', path: ['target'], message: 'http/keyword target must be an http(s) URL' })
    }
    // 表达式语法校验:非法 token(如 "20x")会让监控项永远判 down(REQ-014 拦截)
    const badTokens = m.expectedStatus
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => !isValidStatusToken(t))
    if (badTokens.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedStatus'],
        message: `invalid expectedStatus token(s): ${badTokens.join(', ')} — use Nxx, exact code, or range (e.g. "2xx,3xx", "200-204,401")`,
      })
    }
  })

function isValidStatusToken(token: string): boolean {
  if (/^[1-5]xx$/.test(token)) return true
  if (/^\d{3}$/.test(token)) return true
  const range = token.match(/^(\d{3})-(\d{3})$/)
  return !!range && Number(range[1]) <= Number(range[2])
}

/** 解析 expectedStatus 表达式:"2xx,3xx" / "200" / "200-204" 的逗号组合(docs/DESIGN.md §9;与上方校验同源) */
export function matchExpectedStatus(expr: string, status: number): boolean {
  return expr
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .some((token) => {
      const wildcard = token.match(/^([1-5])xx$/)
      if (wildcard) return Math.floor(status / 100) === Number(wildcard[1])
      const range = token.match(/^(\d{3})-(\d{3})$/)
      if (range) return status >= Number(range[1]) && status <= Number(range[2])
      if (/^\d{3}$/.test(token)) return status === Number(token)
      return false
    })
}

export const ConfigSchema = z
  .object({
    site: z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      logo: z.string().optional(),
      lang: z.enum(['en', 'zh']).default('en'),
    }),
    defaults: z
      .object({
        timeoutMs: z.number().int().min(1000).max(30000).default(10000),
        degradedThresholdMs: z.number().int().min(1).default(3000),
      })
      .prefault({}),
    monitors: z.array(MonitorConfigSchema).min(1),
  })
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>()
    cfg.monitors.forEach((m, i) => {
      const id = m.id ?? slugify(m.name)
      if (seen.has(id)) {
        ctx.addIssue({ code: 'custom', path: ['monitors', i, 'id'], message: `duplicate monitor id "${id}"` })
      }
      if (id === 'overall') {
        ctx.addIssue({ code: 'custom', path: ['monitors', i, 'id'], message: `"overall" is reserved (badge path /badge/overall.svg)` })
      }
      seen.add(id)
    })
  })

export type MonitorConfig = z.infer<typeof MonitorConfigSchema>
export type Config = z.infer<typeof ConfigSchema>

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'monitor'
  )
}

/** 配置解析后的规范化监控项(id/超时等已回填默认值) */
export interface ResolvedMonitor {
  id: string
  name: string
  group: string
  type: (typeof MONITOR_TYPES)[number]
  target: string
  keyword?: string
  expectedStatus: string
  headers?: Record<string, string>
  timeoutMs: number
  degradedThresholdMs: number
}

export function resolveMonitors(cfg: Config): ResolvedMonitor[] {
  return cfg.monitors.map((m) => ({
    id: m.id ?? slugify(m.name),
    name: m.name,
    group: m.group,
    type: m.type,
    target: m.target,
    keyword: m.keyword,
    expectedStatus: m.expectedStatus,
    headers: m.headers,
    timeoutMs: m.timeoutMs ?? cfg.defaults.timeoutMs,
    degradedThresholdMs: m.degradedThresholdMs ?? cfg.defaults.degradedThresholdMs,
  }))
}

// ---- 明细(data/checks/<id>.ndjson 每行) ----

export const CheckRecordSchema = z.object({
  t: z.iso.datetime(),
  o: z.enum(OUTCOMES),
  ms: z.number().int().min(0).nullable(),
  reason: z.enum(REASON_CODES).nullable(),
  /** 该次探测发生在维护窗口内(不计入可用率分母) */
  maint: z.boolean().optional(),
})
export type CheckRecord = z.infer<typeof CheckRecordSchema>

// ---- 日汇总(data/summary/<id>.json) ----

export const DailySummarySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  total: z.number().int().min(0),
  up: z.number().int().min(0),
  degraded: z.number().int().min(0),
  down_count: z.number().int().min(0),
  down_minutes: z.number().int().min(0),
  avg_ms: z.number().int().min(0).nullable(),
  max_ms: z.number().int().min(0).nullable(),
})
export type DailySummary = z.infer<typeof DailySummarySchema>

export const SummaryFileSchema = z.object({
  version: z.literal(1),
  monitorId: z.string(),
  days: z.array(DailySummarySchema),
})
export type SummaryFile = z.infer<typeof SummaryFileSchema>

// ---- 快照(data/status.json = API-001) ----

export const SnapshotMonitorSchema = z.object({
  id: z.string(),
  name: z.string(),
  group: z.string(),
  status: z.enum(MONITOR_STATUSES),
  ms: z.number().int().min(0).nullable(),
  reason: z.enum(REASON_CODES).nullable(),
  lastCheckedAt: z.iso.datetime(),
  /** 当前状态开始的时间 */
  since: z.iso.datetime(),
  /** 进行中事故的 Issue 号 */
  openIncident: z.number().int().nullable(),
})

export const ActiveMaintenanceSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  monitors: z.array(z.string()),
})

export const SnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.iso.datetime(),
  runId: z.string(),
  overall: z.enum(MONITOR_STATUSES),
  monitors: z.array(SnapshotMonitorSchema),
  activeMaintenances: z.array(ActiveMaintenanceSchema),
})
export type Snapshot = z.infer<typeof SnapshotSchema>
export type SnapshotMonitor = z.infer<typeof SnapshotMonitorSchema>
export type ActiveMaintenance = z.infer<typeof ActiveMaintenanceSchema>

// ---- 汇总 API(/api/summary.json = API-002) ----

export const SummaryApiDaySchema = DailySummarySchema.extend({
  color: z.enum(DAY_COLORS),
})
export const SummaryApiSchema = z.object({
  version: z.literal(1),
  generatedAt: z.iso.datetime(),
  windowDays: z.literal(30),
  monitors: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      group: z.string(),
      uptimePct: z.number().min(0).max(100),
      days: z.array(SummaryApiDaySchema),
    })
  ),
})
export type SummaryApi = z.infer<typeof SummaryApiSchema>

// ---- 事故投影(/api/incidents.json = API-003) ----

export const IncidentUpdateSchema = z.object({
  at: z.iso.datetime(),
  author: z.string(),
  kind: z.enum(['opened', 'comment', 'stage', 'resolved']),
  body: z.string(),
  stage: z.enum(INCIDENT_STAGES).optional(),
})

export const IncidentSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  monitorId: z.string(),
  stage: z.enum(INCIDENT_STAGES),
  startedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  durationMinutes: z.number().int().min(0).nullable(),
  updates: z.array(IncidentUpdateSchema),
})

export const MaintenanceRecordSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  state: z.enum(MAINTENANCE_STATES),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  monitors: z.array(z.string()),
  updates: z.array(IncidentUpdateSchema),
})

export const IncidentsApiSchema = z.object({
  version: z.literal(1),
  generatedAt: z.iso.datetime(),
  incidents: z.array(IncidentSchema),
  maintenances: z.array(MaintenanceRecordSchema),
})
export type Incident = z.infer<typeof IncidentSchema>
export type IncidentUpdate = z.infer<typeof IncidentUpdateSchema>
export type MaintenanceRecord = z.infer<typeof MaintenanceRecordSchema>
export type IncidentsApi = z.infer<typeof IncidentsApiSchema>

// ---- 维护 Issue 正文元数据(YAML 块) ----

export const MaintenanceMetaSchema = z.object({
  monitors: z.array(z.string()).min(1),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
})
export type MaintenanceMeta = z.infer<typeof MaintenanceMetaSchema>

/**
 * 从维护 Issue 正文解析元数据(checker 与站点共用的唯一实现,防两侧解析口径分裂)。
 * GitHub Web UI 提交的 body 是 CRLF,先归一化再匹配 ```yaml 围栏;非法/缺失返回 null。
 */
export function parseMaintenanceMeta(body: string | null | undefined): MaintenanceMeta | null {
  const block = (body ?? '').replace(/\r\n/g, '\n').match(/```ya?ml\n([\s\S]*?)```/)
  if (!block) return null
  const parsed = MaintenanceMetaSchema.safeParse(parseYaml(block[1]!))
  return parsed.success ? parsed.data : null
}

// ---- Webhook 载荷(API-006) ----

export const WebhookPayloadSchema = z.object({
  version: z.literal(1),
  event: z.enum(['incident_open', 'incident_resolved']),
  text: z.string(),
  monitor: z.object({ id: z.string(), name: z.string() }),
  reason: z.enum(REASON_CODES).nullable(),
  startedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().optional(),
  durationMinutes: z.number().int().min(0).optional(),
  incidentUrl: z.string(),
})
export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>

// ---- 共享派生逻辑(单一出处,checker 与站点共用) ----

/** SM1:由上一状态 + 本轮判定 + 维护窗口推导新状态(docs/DESIGN.md §11) */
export function nextStatus(outcome: Outcome, inMaintenance: boolean): MonitorStatus {
  if (inMaintenance) return 'maintenance'
  if (outcome === 'up') return 'operational'
  if (outcome === 'degraded') return 'degraded'
  return 'down'
}

/** 整体状态 = 最劣值:down > maintenance > degraded > operational(docs/DESIGN.md §9) */
export function overallStatus(statuses: MonitorStatus[]): MonitorStatus {
  const order: MonitorStatus[] = ['down', 'maintenance', 'degraded', 'operational']
  for (const s of order) if (statuses.includes(s)) return s
  return 'operational'
}

/** 色条日颜色(docs/DESIGN.md §9,纯派生) */
export function colorForDay(day: DailySummary | undefined, isMaintenanceDay: boolean): DayColor {
  if (isMaintenanceDay) return 'blue'
  if (!day || day.total === 0) return 'gray'
  if (day.down_minutes >= 30) return 'red'
  if (day.down_minutes > 0 || day.degraded > 0) return 'yellow'
  return 'green'
}

/** 30 天可用率(维护窗口内探测已在聚合时剔除) */
export function uptimePct(days: DailySummary[]): number {
  let total = 0
  let down = 0
  for (const d of days) {
    total += d.total
    down += d.down_count
  }
  if (total === 0) return 100
  return Math.round(((total - down) / total) * 10000) / 100
}
