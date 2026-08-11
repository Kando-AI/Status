// 由 zod 单源生成 JSON Schema 文件到 /schema(docs/DESIGN.md §24;禁手写第二份)
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  ConfigSchema,
  IncidentsApiSchema,
  MaintenanceMetaSchema,
  SnapshotSchema,
  SummaryApiSchema,
  WebhookPayloadSchema,
} from '../src/index.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const outDir = join(root, 'schema')
mkdirSync(outDir, { recursive: true })

const targets: Array<[string, z.ZodType]> = [
  ['config.schema.json', ConfigSchema],
  ['status.schema.json', SnapshotSchema],
  ['summary.schema.json', SummaryApiSchema],
  ['incidents.schema.json', IncidentsApiSchema],
  ['maintenance.schema.json', MaintenanceMetaSchema],
  ['webhook.schema.json', WebhookPayloadSchema],
]

for (const [file, schema] of targets) {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })
  writeFileSync(join(outDir, file), JSON.stringify(json, null, 2) + '\n')
  console.log(`generated schema/${file}`)
}
