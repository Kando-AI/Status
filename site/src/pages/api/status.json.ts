// API-001 构建产物(实时读走 raw 同 schema 文件)
import type { APIRoute } from 'astro'
import { emptySnapshot, loadSiteData } from '../../lib/data'

export const GET: APIRoute = async () => {
  const data = await loadSiteData()
  return Response.json(data.snapshot ?? emptySnapshot(data.buildTime))
}
