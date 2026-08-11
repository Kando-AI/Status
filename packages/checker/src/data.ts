import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CheckRecordSchema,
  SnapshotSchema,
  SummaryFileSchema,
  type CheckRecord,
  type DailySummary,
  type Snapshot,
  type SummaryFile,
} from '@butus/schema'

export const DETAIL_RETENTION_DAYS = 7
export const CHECK_INTERVAL_MINUTES = 5

export function readSnapshot(dataDir: string): Snapshot | null {
  const file = join(dataDir, 'status.json')
  if (!existsSync(file)) return null
  try {
    return SnapshotSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null // 快照损坏时按冷启动处理,不让整轮失败
  }
}

export function writeSnapshot(dataDir: string, snapshot: Snapshot): void {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, 'status.json'), JSON.stringify(snapshot, null, 2) + '\n')
}

function checksFile(dataDir: string, id: string): string {
  return join(dataDir, 'checks', `${id}.ndjson`)
}

export function readChecks(dataDir: string, id: string): CheckRecord[] {
  const file = checksFile(dataDir, id)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const parsed = CheckRecordSchema.safeParse(JSON.parse(line))
      return parsed.success ? [parsed.data] : []
    })
}

/** 追加本轮明细并裁剪 7 天窗口(REQ-004;幂等重写) */
export function appendAndTrim(dataDir: string, id: string, record: CheckRecord, now: Date): CheckRecord[] {
  const cutoff = now.getTime() - DETAIL_RETENTION_DAYS * 86400_000
  const kept = readChecks(dataDir, id).filter((c) => Date.parse(c.t) >= cutoff)
  kept.push(record)
  mkdirSync(join(dataDir, 'checks'), { recursive: true })
  writeFileSync(checksFile(dataDir, id), kept.map((c) => JSON.stringify(c)).join('\n') + '\n')
  return kept
}

function summaryFilePath(dataDir: string, id: string): string {
  return join(dataDir, 'summary', `${id}.json`)
}

export function readSummary(dataDir: string, id: string): SummaryFile {
  const file = summaryFilePath(dataDir, id)
  if (!existsSync(file)) return { version: 1, monitorId: id, days: [] }
  // 损坏/旧格式不允许把 checker 拖入每轮崩溃的死循环:重置后由明细窗口重建(与 readSnapshot 容错口径一致)
  try {
    const parsed = SummaryFileSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')))
    if (parsed.success) return parsed.data
  } catch {}
  console.error(`[summary] ${id}: corrupt summary file, starting fresh (rebuilt from detail window)`)
  return { version: 1, monitorId: id, days: [] }
}

export function utcDate(iso: string): string {
  return iso.slice(0, 10)
}

/** 由明细聚合日汇总(维护窗口内的探测剔除;docs/DESIGN.md §9 uptimePct 行) */
export function aggregateDay(checks: CheckRecord[], date: string): DailySummary {
  const day = checks.filter((c) => utcDate(c.t) === date && !c.maint)
  const up = day.filter((c) => c.o === 'up').length
  const degraded = day.filter((c) => c.o === 'degraded').length
  const down = day.filter((c) => c.o === 'down').length
  const msValues = day.filter((c) => c.o !== 'down' && c.ms !== null).map((c) => c.ms!)
  return {
    date,
    total: day.length,
    up,
    degraded,
    down_count: down,
    down_minutes: down * CHECK_INTERVAL_MINUTES,
    avg_ms: msValues.length ? Math.round(msValues.reduce((a, b) => a + b, 0) / msValues.length) : null,
    max_ms: msValues.length ? Math.max(...msValues) : null,
  }
}

/**
 * 用明细窗口内的重算结果合并进日汇总文件:仅重算被明细「完整覆盖」的日期,历史日保持不动
 * (TC-008:8 天前明细被裁掉后,其日汇总必须原样保留)
 * 关键:7 天裁剪 cutoff 不对齐 UTC 日边界,正滑出窗口的那一天明细残缺——该日必须排除,
 * 否则完整历史汇总会被残缺数据逐轮覆盖直至失真(审查缺陷 #1)
 */
export function mergeSummary(dataDir: string, id: string, checks: CheckRecord[], now: Date): SummaryFile {
  const existing = readSummary(dataDir, id)
  const cutoffDay = utcDate(new Date(now.getTime() - DETAIL_RETENTION_DAYS * 86400_000).toISOString())
  const datesInWindow = [...new Set(checks.map((c) => utcDate(c.t)))].filter((d) => d > cutoffDay)
  const byDate = new Map(existing.days.map((d) => [d.date, d]))
  for (const date of datesInWindow) byDate.set(date, aggregateDay(checks, date))
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  const merged: SummaryFile = { version: 1, monitorId: id, days }
  mkdirSync(join(dataDir, 'summary'), { recursive: true })
  writeFileSync(summaryFilePath(dataDir, id), JSON.stringify(merged, null, 2) + '\n')
  return merged
}
