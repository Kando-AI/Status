# Butus · GitHub 原生 Status Page 模板 测试文档

## 1. 元信息 / 变更记录

| 字段 | 值 |
| --- | --- |
| 状态 | 生效 |
| Owner | bug |
| 关联设计文档 | `docs/DESIGN.md` |
| 被测系统 | Butus 模板仓库(github.com/Bearisbug/Butus)+ 从模板建出的演练实例仓库 |
| 最后更新 | 2026-07-27 |

变更记录(登用例增改,不登执行轮次):

| 日期 | 改动 | 作者 |
| --- | --- | --- |
| 2026-07-27 | 初稿,TC-001~TC-026 | bug |
| 2026-07-28 | §3 与检测用例前置的 mock 端口 8080/8090/8099 → 19080/19090/19099(本机 8080 被既有服务占用);§3 冷启动检验通过并去掉未验证标记 | bug |
| 2026-07-28 | 用户视觉反馈改版:TC-015 步骤 2 预期改为「彩点 + 大字状态」(替代实底横幅)、TC-018 步骤 1 预期改为「日期栏 + 彩色左竖线」样式(对齐 status.openai.com);语义(展示总状态/按月历史)不变,不废弃 ID | bug |
| 2026-07-29 | 新增 TC-027(down 行显示 §14 原因码文案,对应交叉审核修复) | bug |
| 2026-08-09 | 新增 TC-032(图表纵轴刻度可读,对应四位数 ms 标签被裁切缺陷) | bug |
| 2026-08-01 | v2.0:新增 TC-028(中文界面)/TC-029(Logo)/TC-030(维护留言时间线)/TC-031(data 分支);§3 mock 端口 18xxx → 19xxx(本机 18080 被占);fixtures 增 config-local-zh.yml 与 logo.svg | bug |

## 2. 测试范围 / 不测什么

- 覆盖:黑盒功能验收——检测判定(本地跑 checker 对受控目标)、事故/维护生命周期(演练实例仓库真实走通)、状态页 UI(浏览器实测)、对外产物(JSON API/RSS/徽章/Webhook)、模板开箱体验。设计文档 §19 全部 Gherkin 场景均由下方 TC 可操作化,无自动化替代豁免项。
- 不测:

| 不测项 | 归属 |
| --- | --- |
| 判定函数/聚合函数的细粒度分支(等价类内部值) | 代码仓单元测试(策略见设计文档 §19) |
| 页面性能(LCP/Lighthouse) | 设计文档 §3 指标,发布检查单用 Lighthouse 专项测,不入功能用例 |
| Actions cron 准点性 | GitHub 平台行为,不可控(设计文档 §17 已声明),无归属——已知风险 |
| 安全渗透 | 无专项——攻击面仅静态站与公开数据,已知风险(设计文档 §28) |

## 3. 环境与前置

> 冷启动检验:已于 RUN-001 前走通(npm install → mock-target → check:once → seed → build → preview 全链就绪判定通过)。

- 依赖:Node ≥20、npm、git、gh CLI(已 `gh auth login`,用于演练仓库操作)、可脚本化浏览器(遵循运行环境既有约定,本机默认 Microsoft Edge)。
- 安装:仓库根 `npm install`;就绪判定:命令退出码 0。
- 本地受控目标(检测类用例的被测对象):`npm run mock-target` 启动本地模拟服务;就绪判定:`curl -s http://localhost:19080/ok` 返回 200 且响应体含 `ok`。提供路径:`/ok`(200 快速,含关键词 `service-healthy`)、`/slow`(200 但延迟 4500ms)、`/error500`(恒 503)、`/nokeyword`(200 但不含关键词)、`/hang`(挂起 15s 不响应);TCP 监听 `localhost:19090`(可连),`localhost:19099` 保持无监听(拒连)。
- 单轮探测(不等 cron):`npm run check:once -- --config <配置路径>`,数据写入 `data/`;就绪判定:命令退出码 0 且 `data/status.json` 的 `generatedAt` 为本次时间。
- 测试配置 fixtures:`fixtures/config-local.yml`(指向 mock-target 的各监控项,慢阈值 3000ms、超时 10s)、`fixtures/config-invalid.yml`(缺 target 字段)。
- 站点本地构建与预览:`npm run build && npm run preview`;就绪判定:`http://localhost:4321/` 返回 200 HTML。构建读取本地 `data/` 与 `INCIDENTS_FIXTURE=fixtures/incidents.json`(本地无 GitHub API 时的事故数据注入口)。
- 种子数据:`node scripts/seed-data.mjs --aged`(构造 8 天前明细行 + 30 天日汇总,含一个 down_minutes=45 的红日与一段 degraded 黄日);重置:`node scripts/seed-data.mjs --reset`(清空 `data/` 回到无数据基线)。时间敏感数据一律用种子脚本构造,不真等。
- 演练实例仓库(事故/维护/模板类用例):从本模板 `gh repo create <owner>/status-demo --template <本仓库> --public` 建出,配置监控 mock 目标的公网等价物(用 `https://httpstat.us/200` 与 `https://httpstat.us/503` 一类公共回显服务,或维护者控制的真实站点);就绪判定:实例 Actions 页 `checker.run` 至少一次绿勾且 Pages URL 返回 200。
- 测试账号:

| 角色 | 账号 | 获取方式 |
| --- | --- | --- |
| 维护者 | gh CLI 当前登录账号 | `gh auth status` 确认 |
| 访客 | 无需账号(匿名浏览器窗口) | — |

- Webhook 捕获:`https://webhook.site` 临时地址(或本地 `npm run mock-webhook` 打印收到的 POST),避免真实通知副作用。
- 证据目录:`docs/test-runs/`(截图/响应体/日志摘录落此处,引用写项目根相对路径)。

## 4. 用例库

### 检测判定(本地)

#### `TC-001` HTTP 探测判定 up — 对应 `REQ-001` · 级别: 冒烟 · 执行者: AI

前置:mock-target 已就绪;`data/` 已重置;使用 `fixtures/config-local.yml` 中 `local-ok` 项(target=`http://localhost:19080/ok`)。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 执行 `npm run check:once` | 退出码 0 |
| 2 | 查看 `data/checks/local-ok.ndjson` 末行 | `outcome` 为 `up`,`ms` 为 0~3000 的整数,`reason` 为空值 |
| 3 | 查看 `data/status.json` | `monitors[]` 中 `id=local-ok` 的 `status` 为 `operational`,`generatedAt` 为本次执行时间(±2 分钟) |

后置:无(数据保留供后续用例)。

#### `TC-002` HTTP 5xx 判定 down 与原因码 — 对应 `REQ-001` · 级别: 冒烟 · 执行者: AI

前置:mock-target 已就绪;使用 `local-err` 项(target=`http://localhost:19080/error500`)。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 执行 `npm run check:once` 并计时 | 该项在单轮内重试:日志出现 3 次对 `/error500` 的尝试记录,间隔约 5s |
| 2 | 查看 `data/checks/local-err.ndjson` 末行 | `outcome` 为 `down`,`reason` 为 `http_5xx` |
| 3 | 查看 `data/status.json` | 该项 `status` 为 `down` |

后置:无。

#### `TC-003` 慢响应判定 degraded — 对应 `REQ-001` · 级别: 回归 · 执行者: AI

前置:mock-target 已就绪;使用 `local-slow` 项(target=`/slow`,慢阈值 3000ms)。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 执行 `npm run check:once` | 退出码 0,无 Issue 类动作日志 |
| 2 | 查看该项明细末行 | `outcome` 为 `degraded`,`ms` 大于 3000 |
| 3 | 查看 `data/status.json` | 该项 `status` 为 `degraded` |

后置:无。

#### `TC-004` 关键词缺失判 down — 对应 `REQ-002` · 级别: 回归 · 执行者: AI

前置:使用 `local-nokw` 项(type=keyword,target=`/nokeyword`,keyword=`service-healthy`)。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 执行 `npm run check:once` | 该项明细末行 `outcome` 为 `down`,`reason` 为 `keyword_missing` |

后置:无。

#### `TC-005` 关键词命中判 up — 对应 `REQ-002` · 级别: 回归 · 执行者: AI

前置:使用 `local-kw` 项(type=keyword,target=`/ok`,keyword=`service-healthy`)。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 执行 `npm run check:once` | 该项明细末行 `outcome` 为 `up`,`reason` 为空值 |

后置:无。

#### `TC-006` TCP 端口连通判 up — 对应 `REQ-003` · 级别: 回归 · 执行者: AI

前置:使用 `local-tcp` 项(type=tcp,target=`localhost:19090`)。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 执行 `npm run check:once` | 该项明细末行 `outcome` 为 `up` |

后置:无。

#### `TC-007` TCP 拒连判 down — 对应 `REQ-003` · 级别: 回归 · 执行者: AI

前置:使用 `local-tcp-dead` 项(type=tcp,target=`localhost:19099`,该端口无监听)。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 执行 `npm run check:once` | 该项明细末行 `outcome` 为 `down`,`reason` 为 `conn_refused` |

后置:无。

#### `TC-008` 明细 7 天裁剪与日汇总保留 — 对应 `REQ-004` · 级别: 回归 · 执行者: AI

前置:执行 `node scripts/seed-data.mjs --aged`(注入 8 天前明细行与对应日汇总)。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 记录种子后某监控项 ndjson 行数与最老时间戳 | 存在 8 天前的行 |
| 2 | 执行 `npm run check:once` | 退出码 0 |
| 3 | 再查该 ndjson | 8 天前的行已消失,最老行时间戳在 7 天内 |
| 4 | 查 `data/summary/` 对应文件 | 8 天前那天的日汇总行仍在,数值未变 |

后置:`node scripts/seed-data.mjs --reset`。

#### `TC-009` 超时判 down — 对应 `REQ-001` · 级别: 边缘 · 执行者: AI

前置:使用 `local-hang` 项(target=`/hang`,timeoutMs=10000)。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 执行 `npm run check:once` | 该项每次尝试约 10s 后放弃,明细末行 `outcome` 为 `down`,`reason` 为 `timeout` |

后置:无。

### 事故与维护(演练实例仓库)

#### `TC-010` 故障自动开 Issue(锁定+去重) — 对应 `REQ-005` · 级别: 回归 · 执行者: 皆可

前置:演练实例就绪;某监控项 target 指向恒 503 的地址(改配置 push)。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 手动触发 checker workflow(或等下一轮),看 run 日志 | 判定 down,日志含创建 Issue 动作 |
| 2 | 打开实例仓库 Issues 列表 | 存在新 open Issue,带 `status-page`、`monitor:<id>`、`investigating` 标签,正文含起始时间(UTC)、原因码 `http_5xx`、runId |
| 3 | 以访客身份(无写权限账号)查看该 Issue | 显示已锁定(locked),无法评论 |
| 4 | 再次手动触发 checker workflow | 无第二个 Issue 建立,原 Issue 保持唯一 |

后置:保留故障状态供 TC-011。

#### `TC-011` 恢复自动关 Issue 含时长 — 对应 `REQ-005` · 级别: 回归 · 执行者: 皆可

前置:先执行 TC-010(存在 open 事故 Issue);把该监控项 target 改回恒 200 地址并 push。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 手动触发 checker workflow | run 日志含关闭 Issue 动作 |
| 2 | 查看该 Issue | 状态 closed,末条留言为系统恢复留言,含持续分钟数(与实际故障时长一致,±5 分钟) |
| 3 | 打开实例状态页首页 | 该监控项恢复绿色 operational,进行中事故横幅消失 |

后置:无。

#### `TC-012` 进展标签与留言渲染时间线 — 对应 `REQ-006` · 级别: 回归 · 执行者: 皆可

前置:先执行 TC-010(存在 open 事故 Issue)。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 维护者把 Issue 标签 `investigating` 换为 `identified`,并留言「Root cause identified: db pool exhausted」 | 操作成功,Issue 事件触发 site.build(Actions 页可见新 run) |
| 2 | 构建完成后打开该事故的详情页(`/incidents/<issue 号>`) | 时间线按时间序出现 investigating、identified 两个阶段节点与该条留言全文,各带时间戳 |

后置:无。

#### `TC-013` 维护窗口抑制误报 — 对应 `REQ-007` · 级别: 回归 · 执行者: 皆可

前置:演练实例某监控项当前 operational 且无 open 事故;按模板格式开维护 Issue:标签 `maintenance`,正文 YAML 含该监控项 id、start=当前时间前 5 分钟、end=当前时间后 2 小时。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 把该监控项 target 改为恒 503 并 push,手动触发 checker | run 日志判定失败但无创建事故 Issue 动作;Issues 列表无新 Issue |
| 2 | 打开状态页首页 | 该监控项显示蓝色 maintenance 态,页面有维护公告横幅 |
| 3 | 查看 `/api/status.json` | 该项 `status` 为 `maintenance`,`activeMaintenances[]` 含该窗口 |

后置:保留状态供 TC-014。

#### `TC-014` 维护窗口结束自动关闭 — 对应 `REQ-007` · 级别: 边缘 · 执行者: 皆可

前置:先执行 TC-013;编辑维护 Issue 正文把 end 改为当前时间前 1 分钟(构造已过期窗口,不真等 2 小时)。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 手动触发 checker workflow | 该维护 Issue 被自动关闭 |
| 2 | 打开状态页首页 | 维护横幅消失;该监控项按真实探测结果显示(target 仍 503 → 转入故障流程,新事故 Issue 建立) |

后置:把 target 改回正常地址,触发一轮恢复,清理事故 Issue。

#### `TC-027` down 行显示失败原因文案 — 对应 `REQ-001`、`REQ-008` · 级别: 回归 · 执行者: AI

前置:mock-target 就绪;对 `fixtures/config-local.yml` 执行过一轮 `check:once`(local-err 为 down/http_5xx);用本地数据构建并预览。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 打开首页,查看 local-err 行状态文字 | 显示 `Down · HTTP 5xx error`(§14 展示映射;未知原因码显示原样字符串) |
| 2 | 查看 local-hang 行 | 显示 `Down · Request timed out` |

后置:无。

#### `TC-028` 中文界面渲染 — 对应 `REQ-016` · 级别: 回归 · 执行者: AI

前置:使用 `fixtures/config-local-zh.yml`(site.lang: zh)构建到独立输出目录。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | `CONFIG_PATH=fixtures/config-local-zh.yml PAGES_BASE=/ npm run build -w site -- --outDir /tmp/butus-zh` | 构建成功 |
| 2 | 检索产物 HTML | 首页/历史页文案为中文(如「全部系统运行正常」「事故历史」「近期事故」),日期与时长中文格式;lang 缺省的构建仍为英文 |

后置:无。

#### `TC-029` 站点 Logo 渲染与回退 — 对应 `REQ-017` · 级别: 回归 · 执行者: AI

前置:`fixtures/config-local.yml` 已配置 site.logo=fixtures/logo.svg;构建并预览。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 打开首页查看页头 | 显示 Logo 图片(内联 data URI),替代默认徽标点 |
| 2 | 将 logo 配置改为不存在的路径重新构建 | 构建成功不失败,日志含 logo not found 告警,页头回退默认徽标点 |

后置:恢复配置。

#### `TC-030` 维护公告留言时间线 — 对应 `REQ-018` · 级别: 回归 · 执行者: AI

前置:事故 fixture 中维护 #9 含一条维护者留言;构建并预览。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 打开 `/incidents/9/` | 时间线含「Maintenance announced」开场节点与该留言(Update from maintainer),按时间排列 |
| 2 | 打开 `/history` | 该维护条目的摘要取自最新留言内容 |

后置:无。

#### `TC-031` 检测数据落 data 分支 — 对应 `REQ-004` · 级别: 回归 · 执行者: 皆可

前置:演练实例已上线并跑过 ≥2 轮 checker(数据分支场景须真实 GitHub)。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 查看实例仓库分支列表与 `data` 分支内容 | 存在 `data` 分支,根目录含 status.json、checks/、summary/;首轮自动创建 |
| 2 | 查看 main 分支提交历史 | 无任何 `checks:` 数据提交,只有人写的提交 |
| 3 | 访问状态页并对照 raw 地址 `raw.githubusercontent.com/<repo>/data/status.json` | 页面实时刷新正常,raw 返回最新快照 |

后置:无。

#### `TC-032` 响应时间图表纵轴刻度可读 — 对应 `REQ-008` · 级别: 回归 · 执行者: AI

前置:构造响应时间达 ~1300ms 的数据(四位数 ms),构建并预览,展开该监控项趋势面板。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 查看纵轴三个刻度 | 自下而上单调递增(如 `0 ms` / `650 ms` / `1.30 s`);≥1000ms 以秒紧凑显示,无任何刻度文本被 SVG 左边界裁切 |
| 2 | 查看面板表头与悬停提示 | 平均/峰值与刻度同一格式口径(如「平均 1.13 s · 峰值 1.28 s」) |

后置:无。

### 状态页 UI(浏览器)

#### `TC-015` 首页分组/状态/色条/可用率渲染 — 对应 `REQ-008` · 级别: 冒烟 · 执行者: AI

前置:`node scripts/seed-data.mjs --aged` 注入 30 天数据(含红日/黄日);`npm run build && npm run preview` 就绪。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 浏览器打开 `http://localhost:4321/` | 页面按配置分组显示区块,每个监控项一行:名称、状态点(绿)、30 格色条、可用率百分比(两位小数) |
| 2 | 检查顶部状态区 | 全部正常时显示绿色状态点 + All systems operational 大字标题,下方带最近检测时间(2026-07 视觉改版:状态色由彩点承载,不再用实底色块横幅) |
| 3 | 截图存证 | `docs/test-runs/` 下留存首页截图 |

后置:无。

#### `TC-016` 暗色模式 — 对应 `REQ-008` · 级别: 回归 · 执行者: 皆可

前置:同 TC-015 预览就绪。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 点击页面主题切换控件 | 背景切换为深色系,文字对比度可读,状态色(绿/黄/红/蓝)仍可分辨 |
| 2 | 刷新页面 | 暗色选择被记住(不闪回亮色) |
| 3 | 截图存证 | 留存暗色首页截图 |

后置:切回亮色。

#### `TC-017` 30 天色条悬停细节与红日 — 对应 `REQ-008` · 级别: 回归 · 执行者: AI

前置:同 TC-015(种子含一个 down_minutes=45 的红日与 degraded 黄日)。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 找到含红日的监控项色条 | 30 格中对应日期格为红色,黄日格为黄色,其余绿色 |
| 2 | 悬停红色格 | tooltip 显示该 UTC 日期与宕机分钟数(45 minutes 或等义文案) |

后置:无。

#### `TC-018` 事故历史页按月分组 — 对应 `REQ-009` · 级别: 回归 · 执行者: AI

前置:`INCIDENTS_FIXTURE=fixtures/incidents.json`(含上月与本月各一条 resolved 事故)构建预览。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 打开 `/history` | 事故按月份分组倒序,月内按日分组:左侧日期栏(日数字+星期),每条带彩色左竖线(红=进行中/黄=已解决/蓝=维护),显示标题、最新进展摘要、右侧时间,元信息行含影响监控项与持续时长 |
| 2 | 点击其中一条 | 进入 `/incidents/<号>` 详情页,时间线完整 |

后置:无。

#### `TC-019` 客户端刷新降级横幅 — 对应 `REQ-015` · 级别: 回归 · 执行者: AI

前置:预览就绪;用浏览器自动化把对 raw 快照地址的请求拦截为失败(或将本地快照 `generatedAt` 改为 20 分钟前后重新构建)。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 打开首页 | 页面正常渲染构建时数据,不白屏、控制台无未捕获异常 |
| 2 | 观察页面提示区 | 出现「数据可能滞后」等义的横幅提示 |

后置:解除拦截/恢复快照。

#### `TC-020` 视觉观感与动效验收 — 对应 `REQ-008` · 级别: 回归 · 执行者: 人工

前置:预览就绪(亮/暗两态可切)。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 对照 status.openai.com 逐区块浏览首页/历史页/详情页 | 布局密度、层级、留白、色彩观感达到同级现代感,无明显「模板感/AI 味」 |
| 2 | 操作展开趋势面板、悬停色条、切换主题 | 过渡自然,无跳闪 |

后置:无。

### 对外产物

#### `TC-021` JSON API schema 校验 — 对应 `REQ-010` · 级别: 冒烟 · 执行者: AI

前置:构建完成(dist 产物在);`npm run validate:api`(ajv 对 dist 下三个 JSON 跑 schema 校验)可用。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 执行 `npm run validate:api` | 退出码 0,输出三个文件均 valid,`version` 字段为 1 |
| 2 | curl 预览地址 `/api/status.json` | 200,`monitors[]` 数量与配置一致 |

后置:无。

#### `TC-022` RSS feed 条目 — 对应 `REQ-011` · 级别: 回归 · 执行者: AI

前置:同 TC-018(事故 fixture 构建)。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | curl `/feed.xml` | 合法 Atom XML,含 fixture 中两条事故条目,entry 链接指向对应 `/incidents/<号>` |

后置:无。

#### `TC-023` 状态徽章 — 对应 `REQ-012` · 级别: 回归 · 执行者: AI

前置:构造快照中某监控项 `status` 为 `down`(种子或 fixture)后构建。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | curl `/badge/<该项 id>.svg` | 返回 SVG,文案含 down,主色为红 |
| 2 | curl `/badge/overall.svg` | 整体徽章为红色 down(最劣值规则) |

后置:无。

#### `TC-024` Webhook 通知与未配置跳过 — 对应 `REQ-013` · 级别: 回归 · 执行者: 皆可

前置:演练实例未配置 `NOTIFY_WEBHOOK_URL`;准备 webhook.site 捕获地址。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 在未配置状态下触发一次故障(参照 TC-010 前置) | checker run 日志显示通知步骤跳过,run 不失败 |
| 2 | 在实例 Secrets 配置捕获地址,恢复后再触发一次故障 | 捕获端收到 POST:JSON 顶层含 `text`(人读摘要)、`event` 为 `incident_open`、`monitor.id`、`reason`、`incidentUrl` |
| 3 | 恢复目标,触发恢复轮 | 捕获端收到 `event` 为 `incident_resolved` 的 POST,含 `durationMinutes` |

后置:清理演练故障状态。

### 模板与配置

#### `TC-025` 模板 10 分钟上线 — 对应 `REQ-014` · 级别: 回归 · 执行者: 皆可

前置:gh CLI 已登录;计时开始。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | `gh repo create <owner>/status-demo-2 --template <本模板仓库> --public` | 仓库建立 |
| 2 | 仅编辑 `status.config.yml`(站点名 + 2 个监控项)并 push,按 README 开启 Pages | 无需改任何其他文件 |
| 3 | 等首轮 Actions 完成,访问 Pages URL | 状态页可访问,显示配置的监控项与真实状态;从步骤 1 到此 ≤10 分钟 |

后置:删除演练仓库 status-demo-2(或保留作长期演练实例)。

#### `TC-026` 非法配置拦截不部署 — 对应 `REQ-014` · 级别: 回归 · 执行者: AI

前置:演练实例正常在线,记录当前页面内容;本地把 `fixtures/config-invalid.yml` 内容(某监控项缺 `target`)替换实例配置并 push。

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 查看该 push 触发的 Actions run | 配置校验步骤失败,错误信息指明缺失字段名与所在监控项;site.build 未执行部署 |
| 2 | 刷新实例状态页 | 页面仍为上一版内容,未损坏 |
| 3 | revert 该 commit | 校验通过,部署恢复 |

后置:无。

## 5. 回归策略

- **全量轮**(全部用例):首次成稿、里程碑(M1~M5 各收口一轮)、跨功能域改动、地基变更(数据 schema/工作流结构/环境)。
- **局部轮**(受影响用例 + 全部冒烟级):单一功能改动。受影响用例 = 本次改动触及的 `REQ-*` 反查对应 TC;无 REQ 变更的改动按触及功能域圈定;影响面不确定时升级全量轮。
- **复测轮**(上轮失败用例 + 全部冒烟级):修复失败项之后。
- **人工收口轮**(仅上轮「待人工」用例,当前即 TC-020):AI 轮后由人工补测收口。
- 冒烟集:TC-001、TC-002、TC-015、TC-021(本地即可跑,独立证明「探测→判定→数据→页面→API」主链路)。

## 6. 执行记录

轮次汇总:

| 轮次 | 日期 | 被测版本 | 执行者 | 范围 | 结果 |
| --- | --- | --- | --- | --- | --- |
| RUN-001 | 2026-07-28 | 工作区(首个 commit 前;commit 后在此补钉 hash) | AI(Claude Code:CLI + Playwright/Edge) | 全量 | 通过 17/26 · 阻塞 8 · 待人工 1 |
| RUN-002 | 2026-07-28 | 工作区(视觉改版后,首个 commit 前) | AI(Claude Code:CLI + Playwright/Edge) | 局部(视觉改版触及 REQ-008/009 → TC-015~020,顺带复验 TC-019;+ 冒烟级 TC-001、TC-002、TC-015、TC-021) | 通过 8/9 · 待人工 1 |
| RUN-003 | 2026-07-28 | 工作区(交互迭代后:悬停浮层卡片/Recharts 图表/入场动效/行高亮几何修复) | AI(Claude Code:CLI + Playwright/Edge) | 局部(REQ-008 → TC-015~020 + 冒烟级 TC-001、TC-002、TC-015、TC-021) | 通过 8/9 · 待人工 1 |
| RUN-004 | 2026-07-28 | 工作区(边缘加固 + 审查修复:汇总边界日/CRLF 维护解析/并发组/客户端重试等 11 项) | AI(Claude Code:CLI + Playwright/Edge) | 局部(REQ-001/004/008/010/014/015 → TC-001~009、TC-015~021、TC-026 本地部分 + 全部冒烟级) | 通过 8/9 · 待人工 1 |
| RUN-005 | 2026-07-29 | 工作区(交叉审核 12 项修复后) | AI(Claude Code:CLI + Playwright/Edge) | 局部(REQ-001/003/005/007/008/010/014 → TC-001~009、TC-015~019、TC-021、TC-026 本地部分、TC-027 + 全部冒烟级) | 通过 9/10 · 待人工 1 |
| RUN-006 | 2026-07-29 | 工作区(第二轮 bug-hunt 15 项修复后,出厂 data/ 已清空) | AI(Claude Code:CLI + Playwright/Edge) | 局部(REQ-005/006/007/008/009/010/015 → TC-010~019 本地可测部分、TC-021、TC-027 + 全部冒烟级) | 通过 9/10 · 待人工 1 |
| RUN-007 | 2026-08-01 | 工作区(v2.0:Butus 定名 + data 分支 + i18n + Logo + 维护留言,首个 commit 前) | AI(Claude Code:CLI + Playwright/Edge + Lighthouse) | 局部(REQ-004/008/016/017/018 → TC-008、TC-015~019、TC-021、TC-027~030 + 全部冒烟级) | 通过 12/13 · 待人工 1 |
| RUN-008 | 2026-08-01 | 982a6de~cea7e0f(github.com/Bearisbug/Butus 真实演练) | AI(gh CLI + 真实 Actions/Issues/Pages/webhook.site) | 演练(承接 RUN-001 阻塞项:TC-010~014、TC-024、TC-025、TC-026、TC-031) | 通过 8/9 · 失败 1 |
| RUN-009 | 2026-08-01 | 含 lock 修复的 main 头部 | AI(gh CLI + Playwright/Edge) | 复测(RUN-008:TC-011 + 全部冒烟级) | 通过 5/5 |
| RUN-010 | 2026-08-09 | 工作区(图表纵轴裁切修复) | AI(Claude Code:CLI + Playwright/Edge) | 局部(REQ-008 → TC-015~019、TC-027、TC-029、TC-030、TC-032 + 全部冒烟级) | 通过 10/10 |

明细(仅登非「通过」项):

| 轮次 | 用例 | 结果 | 现象 / 证据 | 跟进 |
| --- | --- | --- | --- | --- |
| RUN-001 | TC-010 | 阻塞 | 演练实例仓库未建(项目尚未发布到 GitHub),事故/维护链路无法真实走通 | 仓库发布后跑「发布演练轮」(RUN-002) |
| RUN-001 | TC-011 | 阻塞 | 同 TC-010 | 同上 |
| RUN-001 | TC-012 | 阻塞 | 同 TC-010 | 同上 |
| RUN-001 | TC-013 | 阻塞 | 同 TC-010 | 同上 |
| RUN-001 | TC-014 | 阻塞 | 同 TC-010 | 同上 |
| RUN-001 | TC-024 | 阻塞 | 同 TC-010(webhook 逻辑单测已覆盖跳过分支,真实投递待演练) | 同上 |
| RUN-001 | TC-025 | 阻塞 | 同 TC-010(Use this template 需真实模板仓库) | 同上 |
| RUN-001 | TC-026 | 阻塞 | 同 TC-010;本地等价校验已过:`validate:config` 对 `fixtures/config-invalid.yml` 报 `monitors.1.target` 缺失 | 同上 |
| RUN-001 | TC-020 | 待人工 | 视觉观感为主观判定;AI 侧证据:`docs/test-runs/home-light-expanded.png`、`home-dark.png`、`home-mobile.png` | 待用户按 TC-020 步骤人工验收 |

| RUN-002 | TC-020 | 待人工 | 改版后观感仍属主观判定;AI 侧证据:`docs/test-runs/` 全套新截图(改版后覆盖旧图) | 待用户人工验收 |

| RUN-003 | TC-020 | 待人工 | 主观观感;AI 侧证据:`docs/test-runs/` 全套最新截图(浮层卡片见 `home-light-tooltip.png`,Recharts 图表见 `home-light-expanded.png`) | 待用户人工验收 |

RUN-003 通过项证据:浏览器断言 22/22(新增「悬停浮层卡片含日期+图标+文案」与「Recharts 曲线可见」两项);冒烟:check:once 全判定正确、validate:api 三文件 valid;懒加载图表分块 gzip ≈165KB(预算 ≤220KB,`client:visible` 不阻塞首屏)。

| RUN-004 | TC-020 | 待人工 | 主观观感;新增超长标题/长 URL 边缘态截图 `docs/test-runs/edge-long-mobile.png`、`edge-long-incident-mobile.png` | 待用户人工验收 |
| RUN-005 | TC-020 | 待人工 | 主观观感不变 | 待用户人工验收 |

| RUN-006 | TC-020 | 待人工 | 主观观感不变 | 待用户人工验收 |

| RUN-007 | TC-020 | 待人工 | 主观观感(新增 Logo/中文态) | 待用户人工验收 |
| RUN-008 | TC-011 | 失败 | 步骤 1:预期恢复留言+关闭,实际 GITHUB_TOKEN 对锁定 Issue 留言 403(run 30692429381 日志);降级路径正确保留 openIncident | 修复于 main(解锁→留言→关闭→重新锁定),RUN-009 复测通过 |

RUN-010 通过项证据:缺陷复现——1300ms 刻度文本 x=290 < SVG 左边界 296(裁切后读作「300ms」);修复后刻度为 `0 ms / 650 ms / 1.30 s` 全部 x ≥ 边界。单元测试 23/23;tsc + astro check 零错误;浏览器断言 29/29(新增「纵轴刻度无裁切」几何断言,后续自动防回归);validate:api 三文件 valid。

RUN-009 通过项证据:TC-011 真实复测——Issue #1 closed+locked,恢复留言「recovered after 9 minutes」,webhook incident_resolved(9min);冒烟级本地 28/28 浏览器断言全过。

RUN-008 通过项证据(全部真实环境,仓库 Bearisbug/Butus):TC-010 Issue #1 自动开(labels status-page/monitor:drill/investigating,locked=true,正文含 UTC 起始/dns_error/runId),二次 dispatch 无重复;TC-012 换标签+留言双触发 site.build,线上 /incidents/1/ 时间线含 Identified 节点与留言全文;TC-013 维护窗口 #2 内探测连败零新 Issue,快照 drill=maintenance/activeMaintenances 含 #2;TC-014 窗口过期自动留言关闭 #2、事故 #3 正确重开;TC-024 webhook.site 捕获 incident_open(dns_error)与 incident_resolved(9min);TC-025 模板实例 butus-demo 从建仓到真实状态上线 2 分 05 秒(≤10 分钟);TC-026 非法配置被 validate 关卡拦截(报 monitors.3.target)且线上页面保持 200;TC-031 data 分支首轮自动创建、main 提交史零数据 commit、raw 实时可读。

RUN-007 通过项证据:单元测试 23/23(新增 site.lang 校验);tsc + astro check 零错误;浏览器断言 28/28(新增 Logo 渲染、维护留言时间线两项);中文构建 5 组关键文案检索命中;validate:api 三文件 valid;Lighthouse 实测 mobile 100 分/LCP 0.9s、desktop 100 分/LCP 0.2s(`docs/test-runs/lighthouse-{mobile,desktop}.json`),达 §3 目标(≥95/<2s)。TC-031 待演练轮(需真实 GitHub)。

RUN-006 通过项证据:单元测试 22/22;tsc + astro check 双零错误;浏览器断言 26/26(新增维护详情页语义、正文清洗、快照年龄自适应新鲜度三组);validate:api 三文件 valid;出厂 `data/` 已清空仅存 .gitkeep(§23 检查单项就绪)。第二轮 bug-hunt 15 项(14 确认 + 1 存疑)全部修复,含 2 项 v2 记录(维护留言时间线、logo 渲染)不修。

RUN-005 通过项证据:单元测试 22/22(新增 tcp 端口范围、expectedStatus 语法、CRLF 维护解析三组回归);tsc + astro check 双零错误(typecheck 首次覆盖 site/scripts);浏览器断言 23/23(新增 TC-027 原因码展示);validate:api 三文件 valid。交叉审核 12 项发现全部修复。

RUN-004 通过项证据:单元测试 19/19(新增「边界残缺日不覆盖历史汇总」回归);浏览器断言 22/22;check:once 实测全判定正确;validate:api 三文件 valid;超长标题(CJK+无空格串)与长 URL 移动端零横向溢出。审查报告 11 项发现全部处置:高危 2 项修复(汇总失真/CRLF)、中危 4 项修复($SECRET 校验断链/部署并发/标签初始化/滞后横幅),低危 5 项修复(出厂数据清理入 §23 检查单、Issue 分页、阶段标签取最新、http_unexpected 原因码、schema 漂移 CI 关卡)。

RUN-002 通过项证据:浏览器断言 21/21(`scripts/browser-check.mjs`,覆盖 TC-015~019 步骤)+ 新截图 `docs/test-runs/home-light-expanded.png`、`home-light-tooltip.png`、`home-dark.png`、`history.png`、`incident-12.png`、`home-mobile.png`、`home-stale-banner.png`;冒烟:check:once 实测 local-ok=operational / local-err=down(http_5xx),validate:api 三文件 valid,`/api/status.json` monitors=8。

RUN-001 通过项证据:检测判定 `docs/test-runs/run-001-checker.log`、`run-001-checker-assert.txt`(TC-001~007、009)、`run-001-tc008.txt`(TC-008);UI `docs/test-runs/home-light-tooltip.png`、`home-light-expanded.png`、`home-dark.png`、`history.png`、`incident-12.png`、`home-mobile.png`、`home-stale-banner.png` + 浏览器断言 21/21(TC-015~019,脚本 `scripts/browser-check.mjs`);对外产物 `run-001-api.txt`(TC-021/022)、`run-001-badge.txt`(TC-023)。

## 7. 遗留问题

无。
