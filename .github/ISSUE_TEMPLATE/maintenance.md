---
name: Scheduled maintenance
about: Announce a maintenance window (shows on the status page, suppresses alerts)
title: 'Maintenance: <what you are doing>'
labels: ['status-page', 'maintenance']
---

<!-- Describe the maintenance for your users here. -->

We will be performing scheduled maintenance. Short interruptions are expected.

<!-- Required metadata — edit monitors/start/end (UTC, ISO 8601). Keep the yaml fence.
     Replace <monitor-id> with real monitor ids from status.config.yml (unknown ids are
     ignored with a warning in the checker logs, and alert suppression will NOT apply). -->

```yaml
monitors:
  - <monitor-id>
start: 2026-01-01T02:00:00Z
end: 2026-01-01T04:00:00Z
```
