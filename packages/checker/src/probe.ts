import { connect } from 'node:net'
import { matchExpectedStatus, type Outcome, type ReasonCode, type ResolvedMonitor } from '@butus/schema'

export interface ProbeResult {
  outcome: Outcome
  ms: number | null
  reason: ReasonCode | null
}

const MAX_BODY_BYTES = 1024 * 1024

/** 单次探测(不含重试;重试语义见 runAttempts) */
export async function probeOnce(m: ResolvedMonitor): Promise<ProbeResult> {
  if (m.type === 'tcp') return probeTcp(m)
  return probeHttp(m)
}

async function probeHttp(m: ResolvedMonitor): Promise<ProbeResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), m.timeoutMs)
  const started = performance.now()
  try {
    // 跟随重定向,按最终响应判定(防 http→https 跳转致关键词断言假阳性;docs/DESIGN.md §9)
    const res = await fetch(m.target, {
      redirect: 'follow',
      headers: m.headers,
      signal: controller.signal,
    })
    let ms = Math.round(performance.now() - started)
    if (!matchExpectedStatus(m.expectedStatus, res.status)) {
      await res.body?.cancel()
      const reason: ReasonCode =
        res.status >= 500 ? 'http_5xx' : res.status >= 400 ? 'http_4xx' : 'http_unexpected'
      return { outcome: 'down', ms, reason }
    }
    if (m.type === 'keyword') {
      const body = await readBodyCapped(res)
      ms = Math.round(performance.now() - started)
      if (!body.includes(m.keyword!)) return { outcome: 'down', ms, reason: 'keyword_missing' }
    } else {
      await res.body?.cancel()
    }
    return ms > m.degradedThresholdMs
      ? { outcome: 'degraded', ms, reason: null }
      : { outcome: 'up', ms, reason: null }
  } catch (err) {
    return { outcome: 'down', ms: Math.round(performance.now() - started), reason: classifyFetchError(err) }
  } finally {
    clearTimeout(timer)
  }
}

async function readBodyCapped(res: Response): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    text += decoder.decode(value, { stream: true })
    if (bytes >= MAX_BODY_BYTES) {
      await reader.cancel()
      break
    }
  }
  return text
}

function classifyFetchError(err: unknown): ReasonCode {
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return 'timeout'
    const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause
    const code = cause?.code ?? ''
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns_error'
    if (code.startsWith('ERR_TLS') || code.startsWith('CERT_') || /certificate/i.test(cause?.message ?? ''))
      return 'tls_error'
    if (code === 'UND_ERR_CONNECT_TIMEOUT') return 'timeout'
  }
  return 'conn_refused'
}

function probeTcp(m: ResolvedMonitor): Promise<ProbeResult> {
  const [host, portStr] = m.target.split(':')
  const port = Number(portStr)
  const started = performance.now()
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: m.timeoutMs })
    const done = (r: ProbeResult) => {
      socket.destroy()
      resolve(r)
    }
    socket.on('connect', () => {
      const ms = Math.round(performance.now() - started)
      done(ms > m.degradedThresholdMs ? { outcome: 'degraded', ms, reason: null } : { outcome: 'up', ms, reason: null })
    })
    socket.on('timeout', () => done({ outcome: 'down', ms: Math.round(performance.now() - started), reason: 'timeout' }))
    socket.on('error', (err: NodeJS.ErrnoException) => {
      const reason: ReasonCode =
        err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN' ? 'dns_error' : 'conn_refused'
      done({ outcome: 'down', ms: Math.round(performance.now() - started), reason })
    })
  })
}

/** 同轮重试语义:最多 attempts 次,仅 down 触发重试,任何非 down 立即采纳(docs/DESIGN.md §11 连败确认) */
export async function runAttempts(
  m: ResolvedMonitor,
  attempts = 3,
  delayMs = Number(process.env.RETRY_DELAY_MS ?? 5000),
  log: (line: string) => void = () => {}
): Promise<ProbeResult> {
  let last: ProbeResult = { outcome: 'down', ms: null, reason: null }
  for (let i = 1; i <= attempts; i++) {
    last = await probeOnce(m)
    log(`[${m.id}] attempt ${i}/${attempts}: ${last.outcome}${last.reason ? ` (${last.reason})` : ''} ${last.ms ?? '-'}ms`)
    if (last.outcome !== 'down') return last
    if (i < attempts) await new Promise((r) => setTimeout(r, delayMs))
  }
  return last
}
