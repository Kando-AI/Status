// 日期/时长格式化(随 site.lang);UI 文案表在 ./i18n.ts
import type { Lang } from './i18n'

const LOCALE: Record<Lang, string> = { en: 'en-US', zh: 'zh-CN' }

/** 服务端渲染统一 UTC;<time data-local> 由客户端脚本转访客本地时区 */
export function fmtUtc(iso: string, withTime = true): string {
  const d = new Date(iso)
  const date = d.toISOString().slice(0, 10)
  return withTime ? `${date} ${d.toISOString().slice(11, 16)} UTC` : date
}

export function fmtTimeUtc(iso: string): string {
  return `${new Date(iso).toISOString().slice(11, 16)} UTC`
}

export function fmtDay(date: string, lang: Lang = 'en'): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(LOCALE[lang], {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function fmtMonth(yyyymm: string, lang: Lang = 'en'): string {
  return new Date(`${yyyymm}-01T00:00:00Z`).toLocaleDateString(LOCALE[lang], {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function fmtWeekday(day: string, lang: Lang = 'en'): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(LOCALE[lang], { weekday: 'short', timeZone: 'UTC' })
}

const DUR_UNITS: Record<Lang, { min: string; h: string; d: string }> = {
  en: { min: 'min', h: 'h', d: 'd' },
  zh: { min: '分钟', h: '小时', d: '天' },
}

export function fmtDuration(minutes: number, lang: Lang = 'en'): string {
  const u = DUR_UNITS[lang]
  if (minutes < 60) return `${minutes} ${u.min}`
  if (minutes >= 2880) {
    const d = Math.floor(minutes / 1440)
    const h = Math.floor((minutes % 1440) / 60)
    return h ? `${d} ${u.d} ${h} ${u.h}` : `${d} ${u.d}`
  }
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} ${u.h} ${m} ${u.min}` : `${h} ${u.h}`
}

/** 展示前清洗 Issue 正文:剥 HTML 注释与 ```yaml 元数据围栏(模板脚手架不给访客看) */
export function cleanIssueBody(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```ya?ml\r?\n[\s\S]*?```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
