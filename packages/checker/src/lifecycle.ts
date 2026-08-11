import type { ActiveMaintenance, MonitorStatus } from '@butus/schema'

/** 维护窗口在 now 时刻是否覆盖某监控项(SM3 active 判定) */
export function inMaintenance(monitorId: string, maintenances: ActiveMaintenance[], now: Date): boolean {
  return maintenances.some(
    (m) =>
      m.monitors.includes(monitorId) &&
      Date.parse(m.start) <= now.getTime() &&
      now.getTime() < Date.parse(m.end)
  )
}

export interface IncidentActions {
  openIssue: boolean
  closeIssue: boolean
}

/**
 * SM1 动作列(docs/DESIGN.md §11 迁移表):
 * - 进入 down 且无 open 事故 → 开 Issue
 * - 从 down 离开到 operational/degraded → 关 Issue
 * - down → maintenance:保持 open,不动作
 */
export function decideIncidentActions(
  next: MonitorStatus,
  openIncident: number | null
): IncidentActions {
  return {
    openIssue: next === 'down' && openIncident === null,
    closeIssue: openIncident !== null && (next === 'operational' || next === 'degraded'),
  }
}
