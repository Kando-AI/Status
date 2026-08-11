# Butus · 项目约定

## 功能开发纪律
本项目以设计文档 `docs/DESIGN.md` 为单一事实源,以测试文档 `docs/TEST.md` 为验收执行脚本与台账。任何功能新增或改动,必须按此序:先更新设计文档,再改实现代码,再同步测试文档中受影响的用例,并按测试文档执行测试(范围按其回归策略)、在其执行记录中登记轮次。仅改实现代码而未同步两份文档、或未执行并登记测试的改动,视为未完成;设计文档已正确覆盖本次改动(如实现追齐设计的缺陷修复)时,设计文档可不动,在交付说明注明即可。更新设计文档时保持其既有章节结构、ID 约定与 Mermaid 图,状态图与迁移表、图与正文保持一致;更新测试文档时保持用例格式与 TC→REQ 追溯,执行记录只增不改。

## 密钥纪律
运行时密钥只进 `.env`(已 gitignore),仓内只放 `.env.example` 登记「键名 + 用途 + 获取方式」;跨项目共享密钥集中存于 Bitwarden(item 名 = 键名),读取用 `bw get password <键名>` 管道直写、任何输出不回显值;主密码与解锁只由人执行,Agent 不询问主密码、不打印任何密钥值;发现仓内明文密钥立即停下提示轮换(git 历史同样已泄漏)。部署期密钥(模板实例的 NOTIFY_WEBHOOK_URL、探测鉴权头)走 GitHub Secrets,配置文件中仅以 `$SECRET_NAME` 引用键名。

## 项目形态备忘
- 本仓库是「模板产品」:交付物是可 Use this template 的 GitHub 仓库,无中心化部署;GitHub Pages 部署属于模板自身功能(实例侧自动生效),不走服务器 CI/CD。
- 技术栈:npm workspaces + TypeScript;`packages/schema`(zod 单源)、`packages/checker`(探测器)、`site/`(Astro + React 岛屿 + Tailwind)。
- 全部数据结构改动必须从 `packages/schema` 出发(JSON Schema 由它生成,禁手写第二份)。
