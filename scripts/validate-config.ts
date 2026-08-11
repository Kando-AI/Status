// REQ-014 配置校验关卡:非法配置在此失败,拦截部署(docs/DESIGN.md §24)
import { ConfigError, loadConfig } from '../packages/checker/src/config.ts'

const path = process.argv[2] ?? 'status.config.yml'
try {
  const { monitors } = loadConfig(path, { expandSecrets: false })
  console.log(`config OK: ${monitors.length} monitor(s) — ${monitors.map((m) => m.id).join(', ')}`)
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message)
    process.exit(1)
  }
  throw err
}
