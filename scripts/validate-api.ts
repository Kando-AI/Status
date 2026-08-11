// REQ-010 部署门:构建产物过 zod 单源 schema 校验后才允许部署(docs/DESIGN.md §24)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { IncidentsApiSchema, SnapshotSchema, SummaryApiSchema } from '@butus/schema'

const dist = process.argv[2] ?? 'site/dist'
const targets = [
  ['api/status.json', SnapshotSchema],
  ['api/summary.json', SummaryApiSchema],
  ['api/incidents.json', IncidentsApiSchema],
] as const

let failed = false
for (const [file, schema] of targets) {
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync(join(dist, file), 'utf8')))
    if (parsed.success) {
      console.log(`${file}: valid (version=${(parsed.data as { version: number }).version})`)
    } else {
      failed = true
      console.error(`${file}: INVALID`)
      for (const i of parsed.error.issues.slice(0, 10)) console.error(`  - ${i.path.join('.')}: ${i.message}`)
    }
  } catch (err) {
    failed = true
    console.error(`${file}: ${(err as Error).message}`)
  }
}
process.exit(failed ? 1 : 0)
