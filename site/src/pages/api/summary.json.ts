// API-002:30 天日汇总 + 色条颜色 + 可用率
import type { APIRoute } from 'astro'
import { loadSiteData } from '../../lib/data'

export const GET: APIRoute = async () => {
  const data = await loadSiteData()
  return Response.json(data.summaryApi)
}
