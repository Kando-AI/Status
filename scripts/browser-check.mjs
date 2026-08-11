// UI 浏览器验证脚本(ui-constraints flow-verification;TC-015~019 的执行工具)
// 用法:node scripts/browser-check.mjs [--out docs/test-runs]
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'docs/test-runs'
const BASE = process.env.PREVIEW_URL ?? 'http://localhost:4321/'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch())
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// ---- 桌面亮色 ----
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const consoleErrors = []
page.on('pageerror', (e) => consoleErrors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))

await page.goto(BASE, { waitUntil: 'networkidle' })
check('首页可访问', (await page.title()).length > 0, await page.title())
check('总横幅存在且有状态', (await page.locator('.banner').getAttribute('data-overall')) !== null,
  `overall=${await page.locator('.banner').getAttribute('data-overall')}`)
const groups = await page.locator('main section[aria-label] ul li[data-monitor]').count()
check('监控行渲染', groups > 0, `${groups} rows`)
const cells = await page.locator('li[data-monitor]').first().locator('.bar-cell').count()
check('30 天色条(30 格)', cells === 30, `${cells} cells`)
const red = await page.locator('.bar-cell[data-color="red"]').count()
const yellow = await page.locator('.bar-cell[data-color="yellow"]').count()
check('红日/黄日渲染(种子数据)', red > 0 && yellow > 0, `red=${red} yellow=${yellow}`)
const uptime = await page.locator('li[data-monitor]').first().locator('.tnum').first().textContent()
check('可用率百分比显示', /\d+\.\d{2}%/.test(uptime ?? ''), uptime?.trim())

// 页头 Logo 渲染(REQ-017,TC-029)
check('页头 Logo 渲染', (await page.locator('header img').count()) === 1)

// down 行显示原因码文案(§14 展示映射,TC-027)
const errLabel = await page.locator('[data-monitor="local-err"] [data-live="status-text"]').textContent()
check('down 行显示原因码(HTTP 5xx error)', errLabel?.includes('HTTP 5xx error') ?? false, errLabel?.trim())

// tooltip:悬停红格 → 浮层卡片淡入,含日期+图标+文案
const redCell = page.locator('.bar-cell[data-color="red"]').first()
await redCell.hover()
await page.waitForTimeout(300)
const tipVisible = await page.locator('#bar-tip.show').isVisible()
const tipText = (await page.locator('#bar-tip').textContent())?.replace(/\s+/g, ' ').trim()
check('色条悬停浮层(日期+45 min down)', tipVisible && /45 min down/.test(tipText ?? ''), tipText)
await page.screenshot({ path: `${OUT}/home-light-tooltip.png` })

// 行展开趋势面板(Recharts 岛屿 client:visible 注水)
const firstBtn = page.locator('.row-toggle').first()
await firstBtn.click()
check('行展开 aria-expanded', (await firstBtn.getAttribute('aria-expanded')) === 'true')
const chart = await page.waitForSelector('li[data-monitor] .recharts-surface', { timeout: 8000 }).catch(() => null)
check('Recharts 图表注水并渲染', chart !== null)
await page.waitForTimeout(1200) // 等 Area 入场动画(400ms)与懒加载分块完成
const curveVisible = await page.locator('.recharts-area-curve').first().isVisible().catch(() => false)
check('图表曲线可见', curveVisible)
// 纵轴刻度必须完整可读(四位数 ms 曾被 YAxis 宽度裁切,"1300ms" 显示成 "300ms")
const axisOk = await page.evaluate(() => {
  const svg = document.querySelector('.recharts-surface')
  if (!svg) return { ok: false, detail: 'no chart' }
  const left = svg.getBoundingClientRect().x
  const clipped = [...svg.querySelectorAll('text')]
    .map((t) => ({ s: t.textContent, x: t.getBoundingClientRect().x }))
    .filter((t) => t.x < left - 0.5)
  return { ok: clipped.length === 0, detail: clipped.map((c) => c.s).join(',') }
})
check('纵轴刻度无裁切', axisOk.ok, axisOk.detail)
await page.screenshot({ path: `${OUT}/home-light-expanded.png`, fullPage: true })

// 实时刷新脚本已跑(footer note)
await page.waitForTimeout(500)
const note = await page.locator('#refresh-note').textContent()
check('实时刷新已执行(Live·updated)', note?.includes('Live') ?? false, note ?? '')
// 按快照实际年龄断言(>15min 应显示横幅,否则应隐藏),消除时间脆弱性(审核二 #14)
const snapMeta = await fetch(`${BASE}api/status.json`).then((r) => r.json()).catch(() => null)
const snapFresh = snapMeta && Date.now() - Date.parse(snapMeta.generatedAt) <= 15 * 60_000
const staleHidden = await page.locator('#stale-banner').isHidden()
check(
  snapFresh ? '新鲜数据下无滞后横幅' : '过期数据下滞后横幅出现',
  snapFresh ? staleHidden : !staleHidden,
  `snapshot age ok=${snapFresh}`
)

// ---- 暗色模式 ----
await page.locator('#theme-toggle').click()
await page.waitForTimeout(200)
check('暗色 data-theme 生效', (await page.getAttribute('html', 'data-theme')) === 'dark')
const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)
check('暗色背景变深', bg !== 'rgb(255, 255, 255)', bg)
await page.screenshot({ path: `${OUT}/home-dark.png`, fullPage: true })
await page.reload({ waitUntil: 'networkidle' })
check('暗色选择持久化', (await page.getAttribute('html', 'data-theme')) === 'dark')
await page.locator('#theme-toggle').click() // 切回亮色

// ---- 历史页 ----
await page.goto(`${BASE}history/`, { waitUntil: 'networkidle' })
const months = await page.locator('main section[aria-label]').count()
check('历史页按月分组', months >= 2, `${months} month sections`)
await page.screenshot({ path: `${OUT}/history.png`, fullPage: true })

// ---- 维护详情页语义与正文清洗(审核二 #2/#5) ----
await page.goto(`${BASE}incidents/9/`, { waitUntil: 'networkidle' })
const maintBody = (await page.textContent('body')) ?? ''
check('维护页无「Incident detected」文案', !maintBody.includes('Incident detected'))
check('维护页显示 Maintenance announced', maintBody.includes('Maintenance announced'))
check('正文不含模板注释/yaml 围栏', !maintBody.includes('<!--') && !maintBody.includes('```'))
check('维护留言进时间线(REQ-018)', maintBody.includes('Window extended by 30 minutes') && maintBody.includes('Update from maintainer'))

// ---- 事故详情页 ----
await page.goto(`${BASE}incidents/12/`, { waitUntil: 'networkidle' })
const timeline = await page.locator('ol li').count()
check('事故时间线节点', timeline >= 3, `${timeline} updates`)
const bodyText = await page.textContent('body')
check('阶段节点与留言渲染', (bodyText?.includes('Identified') && bodyText?.includes('connection pool')) ?? false)
await page.screenshot({ path: `${OUT}/incident-12.png`, fullPage: true })

// ---- 移动端视口 ----
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
await mobile.goto(BASE, { waitUntil: 'networkidle' })
const hOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
check('移动端无横向溢出', !hOverflow)
await mobile.screenshot({ path: `${OUT}/home-mobile.png`, fullPage: true })

// ---- 滞后横幅降级(TC-019:拦截快照请求) ----
const blocked = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await blocked.route('**/api/status.json', (r) => r.abort())
await blocked.goto(BASE, { waitUntil: 'load' })
await blocked.waitForTimeout(1500)
check('拦截快照后滞后横幅出现', await blocked.locator('#stale-banner').isVisible())
const rows = await blocked.locator('li[data-monitor]').count()
check('降级后仍渲染构建时数据', rows > 0, `${rows} rows`)
await blocked.screenshot({ path: `${OUT}/home-stale-banner.png` })

check('无 console 错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
