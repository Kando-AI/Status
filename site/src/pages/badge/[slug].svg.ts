// API-005:SVG 状态徽章(单监控项 + overall)
import type { APIRoute, GetStaticPaths } from 'astro'
import { loadSiteData } from '../../lib/data'

const COLORS: Record<string, string> = {
  operational: '#10a37f',
  degraded: '#d9a03c',
  down: '#e0343a',
  maintenance: '#3b76d6',
  unknown: '#8b8b96',
}
const TEXT: Record<string, string> = {
  operational: 'operational',
  degraded: 'degraded',
  down: 'down',
  maintenance: 'maintenance',
  unknown: 'unknown',
}

export const getStaticPaths: GetStaticPaths = async () => {
  const data = await loadSiteData()
  return [...data.monitors.map((m) => ({ params: { slug: m.id } })), { params: { slug: 'overall' } }]
}

export const GET: APIRoute = async ({ params }) => {
  const data = await loadSiteData()
  const slug = params.slug!
  const label = slug === 'overall' ? 'status' : slug
  const status =
    (slug === 'overall'
      ? data.snapshot?.overall
      : data.snapshot?.monitors.find((m) => m.id === slug)?.status) ?? 'unknown'

  const value = TEXT[status]!
  const color = COLORS[status]!
  const lw = 6 + label.length * 6.6
  const vw = 6 + value.length * 6.6
  const w = Math.round(lw + vw)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${label}: ${value}">
  <clipPath id="r"><rect width="${w}" height="20" rx="3"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${Math.round(lw)}" height="20" fill="#555"/>
    <rect x="${Math.round(lw)}" width="${Math.round(vw)}" height="20" fill="${color}"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${Math.round(lw / 2)}" y="14">${label}</text>
    <text x="${Math.round(lw + vw / 2)}" y="14">${value}</text>
  </g>
</svg>
`
  return new Response(svg, { headers: { 'content-type': 'image/svg+xml; charset=utf-8' } })
}
