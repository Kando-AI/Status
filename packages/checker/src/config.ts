import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { ConfigSchema, resolveMonitors, type Config, type ResolvedMonitor } from '@butus/schema'

export class ConfigError extends Error {}

export function loadConfig(
  path: string,
  opts: { expandSecrets?: boolean } = {}
): { config: Config; monitors: ResolvedMonitor[] } {
  let raw: unknown
  try {
    raw = parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new ConfigError(`cannot read/parse ${path}: ${(err as Error).message}`)
  }
  const parsed = ConfigSchema.safeParse(raw)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new ConfigError(`invalid config ${path}:\n${lines.join('\n')}`)
  }
  // 仅探测场景展开 $SECRET(默认);结构校验场景(CI validate)不展开,否则构建环境没有用户 Secrets 会永久失败(审查缺陷 #3)
  const monitors =
    opts.expandSecrets === false
      ? resolveMonitors(parsed.data)
      : resolveMonitors(parsed.data).map(expandSecrets)
  return { config: parsed.data, monitors }
}

/** headers 值中的 $KEY 引用替换为环境变量;缺失时报错,防静默探测失败(密钥纪律:值不落仓) */
function expandSecrets(m: ResolvedMonitor): ResolvedMonitor {
  if (!m.headers) return m
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(m.headers)) {
    const ref = v.match(/^\$([A-Z0-9_]+)$/)
    if (ref) {
      const val = process.env[ref[1]!]
      if (val === undefined) throw new ConfigError(`monitor "${m.id}": header ${k} references $${ref[1]} but env is not set`)
      headers[k] = val
    } else {
      headers[k] = v
    }
  }
  return { ...m, headers }
}
