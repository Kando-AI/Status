import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  ConfigSchema,
  colorForDay,
  nextStatus,
  overallStatus,
  uptimePct,
  type ActiveMaintenance,
  type CheckRecord,
  type DailySummary,
} from '@butus/schema'
import { matchExpectedStatus, parseMaintenanceMeta } from '@butus/schema'
import { aggregateDay, appendAndTrim, mergeSummary, readChecks, readSummary } from '../src/data.ts'
import { decideIncidentActions, inMaintenance } from '../src/lifecycle.ts'

const tmp = mkdtempSync(join(tmpdir(), 'status-test-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('expectedStatus 表达式', () => {
  it('通配/精确/区间/组合', () => {
    expect(matchExpectedStatus('2xx,3xx', 200)).toBe(true)
    expect(matchExpectedStatus('2xx,3xx', 302)).toBe(true)
    expect(matchExpectedStatus('2xx,3xx', 404)).toBe(false)
    expect(matchExpectedStatus('2xx,3xx', 503)).toBe(false)
    expect(matchExpectedStatus('200', 200)).toBe(true)
    expect(matchExpectedStatus('200', 201)).toBe(false)
    expect(matchExpectedStatus('200-204,401', 401)).toBe(true)
    expect(matchExpectedStatus('200-204', 204)).toBe(true)
    expect(matchExpectedStatus('200-204', 205)).toBe(false)
    expect(matchExpectedStatus('garbage', 200)).toBe(false)
  })
})

describe('SM1 状态推导(DESIGN §11)', () => {
  it('维护窗口优先于一切判定', () => {
    expect(nextStatus('down', true)).toBe('maintenance')
    expect(nextStatus('up', true)).toBe('maintenance')
  })
  it('无维护时按判定映射', () => {
    expect(nextStatus('up', false)).toBe('operational')
    expect(nextStatus('degraded', false)).toBe('degraded')
    expect(nextStatus('down', false)).toBe('down')
  })
})

describe('SM1/SM2 事故动作守卫(DESIGN §11 迁移表)', () => {
  it('进入 down 且无 open 事故 → 开 Issue', () => {
    expect(decideIncidentActions('down', null)).toEqual({ openIssue: true, closeIssue: false })
  })
  it('已有 open 事故再 down → 不重复开(去重)', () => {
    expect(decideIncidentActions('down', 42)).toEqual({ openIssue: false, closeIssue: false })
  })
  it('恢复到 operational/degraded → 关 Issue', () => {
    expect(decideIncidentActions('operational', 42).closeIssue).toBe(true)
    expect(decideIncidentActions('degraded', 42).closeIssue).toBe(true)
  })
  it('down → maintenance:保持 open 不动作', () => {
    expect(decideIncidentActions('maintenance', 42)).toEqual({ openIssue: false, closeIssue: false })
  })
})

describe('维护窗口判定(SM3 active)', () => {
  const win: ActiveMaintenance = {
    number: 1,
    title: 'db upgrade',
    start: '2026-07-27T10:00:00.000Z',
    end: '2026-07-27T12:00:00.000Z',
    monitors: ['api'],
  }
  it('窗口内且监控项匹配', () => {
    expect(inMaintenance('api', [win], new Date('2026-07-27T11:00:00Z'))).toBe(true)
  })
  it('窗口外/监控项不匹配/end 边界为开区间', () => {
    expect(inMaintenance('api', [win], new Date('2026-07-27T09:59:00Z'))).toBe(false)
    expect(inMaintenance('web', [win], new Date('2026-07-27T11:00:00Z'))).toBe(false)
    expect(inMaintenance('api', [win], new Date('2026-07-27T12:00:00Z'))).toBe(false)
  })
})

describe('整体状态最劣值(DESIGN §9)', () => {
  it('down > maintenance > degraded > operational', () => {
    expect(overallStatus(['operational', 'degraded', 'down', 'maintenance'])).toBe('down')
    expect(overallStatus(['operational', 'maintenance', 'degraded'])).toBe('maintenance')
    expect(overallStatus(['operational', 'degraded'])).toBe('degraded')
    expect(overallStatus(['operational'])).toBe('operational')
    expect(overallStatus([])).toBe('operational')
  })
})

describe('明细裁剪与日汇总(REQ-004)', () => {
  const now = new Date('2026-07-27T08:00:00.000Z')
  it('8 天前的明细被裁掉,7 天内保留;历史日汇总不动', () => {
    const dir = join(tmp, 'trim')
    const old: CheckRecord = { t: '2026-07-19T08:00:00.000Z', o: 'up', ms: 100, reason: null }
    const recent: CheckRecord = { t: '2026-07-26T08:00:00.000Z', o: 'up', ms: 110, reason: null }
    appendAndTrim(dir, 'm1', old, new Date('2026-07-19T08:01:00.000Z'))
    mergeSummary(dir, 'm1', readChecks(dir, 'm1'), new Date('2026-07-19T08:01:00.000Z')) // 老日期的日汇总在裁剪发生前已生成
    appendAndTrim(dir, 'm1', recent, new Date('2026-07-26T08:01:00.000Z'))
    const kept = appendAndTrim(dir, 'm1', { t: now.toISOString(), o: 'up', ms: 120, reason: null }, now)
    expect(kept.map((c) => c.t)).not.toContain(old.t)
    expect(kept).toHaveLength(2)
    mergeSummary(dir, 'm1', kept, now)
    const summary = readSummary(dir, 'm1')
    const oldDay = summary.days.find((d) => d.date === '2026-07-19')
    expect(oldDay).toBeDefined()
    expect(oldDay!.total).toBe(1) // 历史日保持原值,不被重算清零
  })
  it('正滑出窗口的边界残缺日不覆盖完整历史汇总(审查缺陷 #1 回归)', () => {
    const dir = join(tmp, 'boundary')
    // Day X(2026-07-20)当天:完整 4 条含 1 次 down,当天聚合
    const dayX: CheckRecord[] = [
      { t: '2026-07-20T02:00:00.000Z', o: 'up', ms: 100, reason: null },
      { t: '2026-07-20T08:00:00.000Z', o: 'down', ms: 50, reason: 'http_5xx' },
      { t: '2026-07-20T14:00:00.000Z', o: 'up', ms: 110, reason: null },
      { t: '2026-07-20T20:00:00.000Z', o: 'up', ms: 120, reason: null },
    ]
    for (const c of dayX) appendAndTrim(dir, 'm2', c, new Date(c.t))
    mergeSummary(dir, 'm2', readChecks(dir, 'm2'), new Date('2026-07-20T21:00:00.000Z'))
    expect(readSummary(dir, 'm2').days.find((d) => d.date === '2026-07-20')!.down_count).toBe(1)
    // 7 天后 12:00:cutoff=07-20T12:00,Day X 前半天明细被裁,只剩 2 条 up
    const later = new Date('2026-07-27T12:00:00.000Z')
    const kept = appendAndTrim(dir, 'm2', { t: later.toISOString(), o: 'up', ms: 90, reason: null }, later)
    expect(kept.filter((c) => c.t.startsWith('2026-07-20'))).toHaveLength(2) // 确认明细已残缺
    mergeSummary(dir, 'm2', kept, later)
    const day = readSummary(dir, 'm2').days.find((d) => d.date === '2026-07-20')!
    expect(day.total).toBe(4) // 完整历史保留,未被残缺数据(2 条)覆盖
    expect(day.down_count).toBe(1)
  })
  it('维护窗口内探测不计入汇总(uptimePct 分母剔除)', () => {
    const checks: CheckRecord[] = [
      { t: '2026-07-27T01:00:00.000Z', o: 'up', ms: 100, reason: null },
      { t: '2026-07-27T02:00:00.000Z', o: 'down', ms: 50, reason: 'http_5xx', maint: true },
      { t: '2026-07-27T03:00:00.000Z', o: 'down', ms: 60, reason: 'http_5xx' },
    ]
    const day = aggregateDay(checks, '2026-07-27')
    expect(day.total).toBe(2)
    expect(day.down_count).toBe(1)
    expect(day.down_minutes).toBe(5)
  })
})

describe('色条颜色与可用率(DESIGN §9 派生规则)', () => {
  const base: DailySummary = { date: '2026-07-01', total: 288, up: 288, degraded: 0, down_count: 0, down_minutes: 0, avg_ms: 100, max_ms: 200 }
  it('green/yellow/red/blue/gray', () => {
    expect(colorForDay(base, false)).toBe('green')
    expect(colorForDay({ ...base, degraded: 3 }, false)).toBe('yellow')
    expect(colorForDay({ ...base, down_count: 2, down_minutes: 10 }, false)).toBe('yellow')
    expect(colorForDay({ ...base, down_count: 9, down_minutes: 45 }, false)).toBe('red')
    expect(colorForDay(base, true)).toBe('blue')
    expect(colorForDay(undefined, false)).toBe('gray')
    expect(colorForDay({ ...base, total: 0 }, false)).toBe('gray')
  })
  it('30 天可用率(维护已剔除,两位小数)', () => {
    const days = [base, { ...base, down_count: 9, down_minutes: 45 }]
    expect(uptimePct(days)).toBe(98.44)
    expect(uptimePct([])).toBe(100)
  })
})

describe('配置校验(REQ-014)', () => {
  it('缺 target 报错并指明字段', () => {
    const r = ConfigSchema.safeParse({ site: { title: 'x' }, monitors: [{ name: 'a' }] })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join('.') === 'monitors.0.target')).toBe(true)
    }
  })
  it('keyword 类型缺 keyword 报错;tcp target 格式校验;重复 id 报错', () => {
    expect(
      ConfigSchema.safeParse({ site: { title: 'x' }, monitors: [{ name: 'a', type: 'keyword', target: 'https://x.com' }] }).success
    ).toBe(false)
    expect(
      ConfigSchema.safeParse({ site: { title: 'x' }, monitors: [{ name: 'a', type: 'tcp', target: 'no-port' }] }).success
    ).toBe(false)
    expect(
      ConfigSchema.safeParse({
        site: { title: 'x' },
        monitors: [
          { name: 'Same Name', target: 'https://x.com' },
          { name: 'Same Name', target: 'https://y.com' },
        ],
      }).success
    ).toBe(false)
  })
  it('tcp 端口越界被拒(1~65535,审查缺陷 #2)', () => {
    const mk = (target: string) =>
      ConfigSchema.safeParse({ site: { title: 'x' }, monitors: [{ name: 'db', type: 'tcp', target }] }).success
    expect(mk('localhost:99999')).toBe(false)
    expect(mk('localhost:0')).toBe(false)
    expect(mk('localhost:5432')).toBe(true)
    expect(mk('localhost:65535')).toBe(true)
  })
  it('expectedStatus 非法表达式被拒(审查缺陷 #5)', () => {
    const mk = (expr: string) =>
      ConfigSchema.safeParse({ site: { title: 'x' }, monitors: [{ name: 'a', target: 'https://x.com', expectedStatus: expr }] }).success
    expect(mk('20x')).toBe(false)
    expect(mk('garbage')).toBe(false)
    expect(mk('299-200')).toBe(false)
    expect(mk('2xx,3xx')).toBe(true)
    expect(mk('200-204,401')).toBe(true)
  })
  it('维护元数据解析:CRLF 正文可解析,非法/缺失返回 null(审查缺陷 #2 回归)', () => {
    const crlf = 'Some intro\r\n\r\n```yaml\r\nmonitors:\r\n  - api\r\nstart: 2026-07-29T02:00:00Z\r\nend: 2026-07-29T04:00:00Z\r\n```\r\n'
    const meta = parseMaintenanceMeta(crlf)
    expect(meta).not.toBeNull()
    expect(meta!.monitors).toEqual(['api'])
    expect(parseMaintenanceMeta('no fence here')).toBeNull()
    expect(parseMaintenanceMeta('```yaml\nmonitors: []\nstart: bad\nend: bad\n```')).toBeNull()
    expect(parseMaintenanceMeta(null)).toBeNull()
  })
  it('保留 id "overall" 被拒(徽章路径冲突)', () => {
    expect(
      ConfigSchema.safeParse({ site: { title: 'x' }, monitors: [{ name: 'Overall', id: 'overall', target: 'https://x.com' }] }).success
    ).toBe(false)
  })
  it('site.lang 枚举校验与默认值(REQ-016)', () => {
    const mk = (site: object) => ConfigSchema.safeParse({ site, monitors: [{ name: 'a', target: 'https://x.com' }] })
    expect(mk({ title: 'x', lang: 'zh' }).success).toBe(true)
    expect(mk({ title: 'x', lang: 'fr' }).success).toBe(false)
    const r = mk({ title: 'x' })
    expect(r.success && r.data.site.lang === 'en').toBe(true)
  })
  it('最小合法配置通过并回填默认值', () => {
    const r = ConfigSchema.safeParse({ site: { title: 'x' }, monitors: [{ name: 'A', target: 'https://x.com' }] })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.defaults.timeoutMs).toBe(10000)
      expect(r.data.monitors[0]!.group).toBe('Services')
      expect(r.data.monitors[0]!.expectedStatus).toBe('2xx,3xx')
    }
  })
})
