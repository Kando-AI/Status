// 种子数据(docs/TEST.md §3):--aged 造 30 天日汇总(含红/黄日)+ 含 8 天前行的明细 + 快照;--reset 清空
// 用法:node scripts/seed-data.mjs --aged [--config fixtures/config-local.yml] [--down <monitorId>]
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { parse } from 'yaml'
import { readFileSync } from 'node:fs'

const { values } = parseArgs({
  options: {
    aged: { type: 'boolean', default: false },
    reset: { type: 'boolean', default: false },
    config: { type: 'string', default: 'fixtures/config-local.yml' },
    'data-dir': { type: 'string', default: 'data' },
    down: { type: 'string' },
  },
})
const dataDir = values['data-dir']

if (values.reset) {
  rmSync(join(dataDir, 'checks'), { recursive: true, force: true })
  rmSync(join(dataDir, 'summary'), { recursive: true, force: true })
  rmSync(join(dataDir, 'status.json'), { force: true })
  console.log('data/ reset')
  process.exit(0)
}
if (!values.aged) {
  console.error('nothing to do: pass --aged or --reset')
  process.exit(1)
}

const cfg = parse(readFileSync(values.config, 'utf8'))
const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'monitor' // 与 @status/schema slugify 兜底一致
const monitors = cfg.monitors.map((m) => ({
  id: m.id ?? slug(m.name),
  name: m.name,
  group: m.group ?? 'Services',
}))

const now = new Date()
const DAY = 86400_000
const iso = (t) => new Date(t).toISOString()
const utcDay = (t) => iso(t).slice(0, 10)

mkdirSync(join(dataDir, 'checks'), { recursive: true })
mkdirSync(join(dataDir, 'summary'), { recursive: true })

monitors.forEach((m, idx) => {
  const isFirst = idx === 0
  // 30 天日汇总:全绿,第一个监控项在 5 天前有红日(down 45 分钟)、12 天前有黄日(degraded)
  const days = []
  for (let back = 29; back >= 0; back--) {
    const date = utcDay(now.getTime() - back * DAY)
    let day = { date, total: 288, up: 288, degraded: 0, down_count: 0, down_minutes: 0, avg_ms: 120, max_ms: 480 }
    if (isFirst && back === 5) day = { ...day, up: 279, down_count: 9, down_minutes: 45 }
    if (isFirst && back === 12) day = { ...day, up: 264, degraded: 24 }
    days.push(day)
  }
  writeFileSync(
    join(dataDir, 'summary', `${m.id}.json`),
    JSON.stringify({ version: 1, monitorId: m.id, days }, null, 2) + '\n'
  )

  // 明细:近 2 天每 30 分钟一条(降采样,够画趋势)+ 8 天前 3 条(供 TC-008 验证裁剪)
  const lines = []
  for (let i = 0; i < 3; i++) {
    lines.push({ t: iso(now.getTime() - 8 * DAY + i * 300_000), o: 'up', ms: 100 + i, reason: null })
  }
  for (let t = now.getTime() - 2 * DAY; t <= now.getTime() - 300_000; t += 1800_000) {
    const ms = 90 + Math.round(60 * Math.abs(Math.sin(t / 7200_000)))
    lines.push({ t: iso(t), o: 'up', ms, reason: null })
  }
  writeFileSync(join(dataDir, 'checks', `${m.id}.ndjson`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
})

const snapshot = {
  version: 1,
  generatedAt: iso(now.getTime()),
  runId: 'seed',
  overall: values.down ? 'down' : 'operational',
  monitors: monitors.map((m) => ({
    id: m.id,
    name: m.name,
    group: m.group,
    status: values.down === m.id ? 'down' : 'operational',
    ms: 120,
    reason: values.down === m.id ? 'http_5xx' : null,
    lastCheckedAt: iso(now.getTime()),
    since: iso(now.getTime() - 3 * DAY),
    openIncident: values.down === m.id ? 101 : null,
  })),
  activeMaintenances: [],
}
writeFileSync(join(dataDir, 'status.json'), JSON.stringify(snapshot, null, 2) + '\n')
console.log(`seeded ${monitors.length} monitors (aged)${values.down ? `, down=${values.down}` : ''}`)
