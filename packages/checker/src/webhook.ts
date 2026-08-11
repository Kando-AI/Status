import type { WebhookPayload } from '@butus/schema'

/** API-006:at-most-once,失败重试 1 次后放弃并记日志(docs/DESIGN.md §8/§17) */
export async function sendWebhook(payload: WebhookPayload): Promise<void> {
  const url = process.env.NOTIFY_WEBHOOK_URL
  if (!url) {
    console.log(`[webhook] NOTIFY_WEBHOOK_URL not set, skipping ${payload.event}`)
    return
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) return
      console.error(`[webhook] attempt ${attempt} got HTTP ${res.status}`)
    } catch (err) {
      console.error(`[webhook] attempt ${attempt} failed: ${(err as Error).message}`)
    }
  }
  console.error(`[webhook] giving up on ${payload.event} (at-most-once)`)
}
