// API-003:事故与维护投影(源 = GitHub Issues)
import type { APIRoute } from 'astro'
import { loadSiteData } from '../../lib/data'

export const GET: APIRoute = async () => {
  const data = await loadSiteData()
  return Response.json(data.incidents)
}
