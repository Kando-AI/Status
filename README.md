# Butus

**Open-source status pages that run entirely on GitHub.** No servers, no databases, no fees — GitHub Actions probes your services, Issues track incidents, and GitHub Pages serves a fast, modern status page.

- 🎨 Clean, OpenAI-style UI — grouped components, 30-day uptime bars, response-time trends, dark mode
- 🔍 Three check types: HTTP status, keyword assertion (catches "200 but broken"), TCP port
- 🚨 Full incident lifecycle: auto-opened Issues, staged updates (investigating → identified → monitoring), auto-resolve with downtime duration
- 🔧 Scheduled maintenance windows that suppress false alarms
- 📡 JSON API, Atom feed, SVG badges, webhook notifications (Slack-compatible)
- 🔒 Zero telemetry. Your data lives in your repo, publicly auditable.

**Live demo:** https://bearisbug.github.io/butus-demo/ (a real instance created from this template — took ~2 minutes to go live)

## Quick start (≈10 minutes)

1. Click **Use this template** → create a **public** repository.
2. Edit `status.config.yml` — the only file you need to touch:

   ```yaml
   site:
     title: My Status
     description: Live status for my services.

   monitors:
     - name: Website
       group: Main
       target: https://example.com
     - name: API
       group: Main
       type: keyword
       target: https://api.example.com/healthz
       keyword: ok
     - name: Database
       group: Infra
       type: tcp
       target: db.example.com:5432
   ```

3. In **Settings → Pages**, set **Source** to **GitHub Actions**.
4. In the **Actions** tab, enable workflows if prompted, then run **checker.run** once manually.

Your status page is now live at `https://<owner>.github.io/<repo>/` and updates every 5 minutes.

## Configuration reference

| Field | Required | Default | Notes |
| --- | --- | --- | --- |
| `monitors[].name` | ✅ | — | Display name |
| `monitors[].target` | ✅ | — | URL, or `host:port` for `tcp` |
| `monitors[].group` | | `Services` | Section on the page |
| `monitors[].type` | | `http` | `http` / `keyword` / `tcp` |
| `monitors[].keyword` | for `keyword` | — | Response body must contain this text |
| `monitors[].expectedStatus` | | `2xx,3xx` | e.g. `200`, `200-204,401` |
| `monitors[].timeoutMs` | | `10000` | Per-attempt timeout |
| `monitors[].degradedThresholdMs` | | `3000` | Slower (but responding) = degraded |
| `monitors[].headers` | | — | e.g. `Authorization: $API_TOKEN` — `$NAME` reads a repo **Secret**; also add the same secret to the `env:` of the *Run checks* step in `.github/workflows/check.yml` (see the comment there); never commit real values |
| `defaults.*` | | see above | Global fallbacks for timeout/threshold |
| `site.lang` | | `en` | UI language: `en` / `zh` |
| `site.logo` | | — | Repo-relative path or URL; inlined at build, shown in the header |

Invalid configs fail CI with the exact field name — the previous page stays online.

## How it works

- **Checks** run every ~5 minutes via GitHub Actions (cron guarantees no better than 5 min; delays during peak are a GitHub platform behavior). A monitor is `down` only after 3 failed attempts in one round.
- **Data** is committed to a dedicated `data` branch (your `main` history stays clean): raw checks kept 7 days, daily summaries kept forever. That's what powers the 30-day bars and uptime numbers. The branch can be squashed or even deleted at any time without touching your code history.
- **Incidents** are GitHub Issues opened automatically (labels `status-page` + `monitor:<id>`, locked to keep the timeline official). Post comments as public updates; move the stage label through `investigating` → `identified` → `monitoring`. When checks recover, the Issue closes itself with the downtime duration.
- **Maintenance**: open an Issue with the `maintenance` label (use the provided issue template). During the window, affected monitors show blue, no incident Issues are opened, and downtime doesn't count against uptime.
- **The page** rebuilds when status changes, when you touch Issues or config, and hourly as a fallback. Visitors' browsers also fetch the latest snapshot on load, with a "data may be out of date" banner if it's stale.

## Notifications

- **Zero-config**: Watch your repo → GitHub emails you when an incident Issue opens.
- **Webhook**: add a repo Secret `NOTIFY_WEBHOOK_URL`. On incident open/resolve, a JSON payload is POSTed with a top-level `text` field — paste a Slack Incoming Webhook URL and it just works.
- **RSS**: `/feed.xml`.

## API & badges

Everything the page shows is also machine-readable, versioned, and schema-validated (`schema/*.schema.json`):

- `/api/status.json` — current snapshot (also served raw from the repo for real-time reads)
- `/api/summary.json` — 30-day daily aggregates + uptime
- `/api/incidents.json` — incident & maintenance history (90 days)
- `/badge/<monitor-id>.svg`, `/badge/overall.svg` — README badges. Note: GitHub renders badges through its image proxy (camo), which caches for a few minutes — expect minute-level freshness, not real-time.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Checks stopped running | Actions tab → check `checker.run` logs; re-enable the workflow if GitHub disabled it. Recovery = next run green and `status.json` fresh. |
| False positives (page says down, service is fine) | Check the `reason` code in the Issue: tune `timeoutMs`, fix `keyword`, or check if the target rate-limits GitHub's IPs. Close the Issue manually — it won't reopen unless checks fail again. |
| Build/deploy failed | The page keeps its last version. Check `site.build` logs — config errors show the exact field. |

## Limits (by design)

- **Public repos only.** Free unlimited Actions minutes require it, private Pages is Enterprise-only anyway, and your check data/incident history is exactly what a status page publishes. Don't monitor URLs you can't expose.
- **5-minute minimum interval**, sometimes delayed by GitHub's scheduler — this is a status page, not an SLA measurement tool.
- Probes originate from GitHub's infrastructure (mostly US) — single vantage point.
- If GitHub itself has a major outage, your status page (and checks) go down with it.

## Local development

```bash
npm install
npm run mock-target                  # local probe targets on :19080/:19090
npm run check:once -- --config fixtures/config-local.yml
node scripts/seed-data.mjs --aged    # 30 days of demo data
CONFIG_PATH=fixtures/config-local.yml INCIDENTS_FIXTURE=fixtures/incidents.json npm run build
npm run preview                      # http://localhost:4321
npm test && npm run typecheck
```

Live template: https://github.com/Bearisbug/Butus

Design doc: `docs/DESIGN.md` · Test doc: `docs/TEST.md` (in Chinese — the project's living spec).

## License

MIT
