// API-004:Atom feed(事故 + 维护公告)
import type { APIRoute } from 'astro'
import { loadSiteData } from '../lib/data'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const GET: APIRoute = async ({ site }) => {
  const data = await loadSiteData()
  const base = import.meta.env.BASE_URL
  const origin = site?.toString().replace(/\/$/, '') ?? ''
  const url = (path: string) => `${origin}${base}${path}`

  const entries = [
    ...data.incidents.incidents.map((i) => ({
      id: `incident-${i.number}`,
      title: i.stage === 'resolved' ? `[Resolved] ${i.title}` : `[Ongoing] ${i.title}`,
      updated: i.resolvedAt ?? i.startedAt,
      link: url(`incidents/${i.number}/`),
      summary:
        i.stage === 'resolved'
          ? `Resolved after ${i.durationMinutes ?? '?'} minutes.`
          : `Ongoing incident affecting ${i.monitorId}.`,
    })),
    ...data.incidents.maintenances
      .filter((m) => m.state !== 'cancelled')
      .map((m) => ({
        id: `maintenance-${m.number}`,
        title: `[Maintenance] ${m.title}`,
        updated: m.start,
        link: url(`incidents/${m.number}/`),
        summary: `Maintenance window ${m.start} → ${m.end} affecting ${m.monitors.join(', ')}.`,
      })),
  ].sort((a, b) => b.updated.localeCompare(a.updated))

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${esc(data.site.title)} — incidents</title>
  <id>${esc(url(''))}</id>
  <link href="${esc(url(''))}"/>
  <link rel="self" href="${esc(url('feed.xml'))}"/>
  <updated>${entries[0]?.updated ?? data.buildTime}</updated>
${entries
  .map(
    (e) => `  <entry>
    <id>${esc(url(''))}${e.id}</id>
    <title>${esc(e.title)}</title>
    <link href="${esc(e.link)}"/>
    <updated>${e.updated}</updated>
    <summary>${esc(e.summary)}</summary>
  </entry>`
  )
  .join('\n')}
</feed>
`
  return new Response(xml, { headers: { 'content-type': 'application/atom+xml; charset=utf-8' } })
}
