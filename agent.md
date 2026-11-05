# 新会话交接入口

> 用户指定的 `agent.md`。根目录 [AGENTS.md](AGENTS.md) 是标准 Agent 自动发现入口，两者分工不同：AGENTS 放长期约束，本文件放状态和开工摘要。

## 一句话任务

在个人 Fork Homepage 上开发**兼容旧配置的服务多地址导航扩展**：右上角切模式，卡片和服务搜索随模式打开地址，单服务右键/更多菜单可临时打开默认或其他地址。不要重写登录，不做用户管理，不引入数据库。

## 重新开启会话时

直接在本仓库目录启动即可，不需要父目录和任何参考应用。建议给 Agent 的起始指令：

> 请先读 AGENTS.md、agent.md、DESIGN.md、SPEC.md、DEVELOPMENT.md，检查当前分支与工作区。以现有代码和规约为准，从尚未完成的最小阶段开始实现多地址导航扩展。保留上游原生认证与旧配置兼容，不提交、不推送、不部署；先报告准备执行的阶段及验证方法。

上述文字是方便用户复制的示例，不是允许未来 Agent 忽略实际新指令。

## 已确认决策

- 主仓：`https://github.com/kanon-H/homepage.git`。
- 上游：`https://github.com/gethomepage/homepage.git`，跟踪 `main`。
- 用 merge / PR 合并上游，不强制覆盖 Fork，不追 dev 做正式基线。
- 认证完全复用现有密码门禁/OIDC，个人场景不需要用户系统。
- 配置继续用 YAML；偏好保存在浏览器，当前没有数据库。
- 如果未来确需数据库，优先 SQLite，并另行设计/确认，不能现在提前引入。
- GitHub Actions 测试和构建 GHCR 镜像；Gitea 单向备份可后续做。

## 当前状态：P2 Provider 与偏好恢复已完成，尚无多地址 UI

当前位于 `feature/multi-address`，跟踪 `origin/feature/multi-address`，HEAD 为 `b584b902d9f750882124a9728518c38e309f6338`。P1 已按用户要求提交并推送；本轮 P2 改动尚未提交或推送，不自动沿用前次推送授权。

2026-11-05 P2 实际变更：

- 新增 `src/utils/network/storage.js` 及测试：固定 key / version 1、JSON 解析、安全读写/删除，处理无 window、storage getter 或操作抛错；Provider 不在初始化或配置回退时写入/删除偏好。
- 新增 `src/utils/contexts/network.jsx` 及 jsdom 测试：每个 Provider 独立的 `useSyncExternalStore` 内存快照，服务端及 hydration 首帧均使用配置默认模式，只有订阅生命周期/显式事件访问浏览器。读取完成或失败均 ready。
- 合法切换立即更新本页内存；写入失败不妨碍切换。storage 事件仅接受该 key / clear 且来自 localStorage，忽略 sessionStorage / 无关事件，无写入反馈循环。
- 配置变化同步派生合法 mode，不先暴露已删除模式；有合法偏好时不因 defaultMode 改变而重置。禁用时不访问存储，重新启用先恢复，StrictMode/卸载清理监听器；无 Provider 的 Hook 返回 ready、禁用状态。
- `src/pages/index.jsx` 仅新增导入和包裹 Index 的页面级 Provider，传入真实 initialSettings；`src/__tests__/pages/index.test.jsx` 新增空 SettingsContext 与旧首页的接入验证，不改 _app、认证或原有导航组件。
- P2 仅提供 ready 合同，真实卡片/搜索/菜单恢复前抑制仍待 P3/P4；测试中的导航合同探针不能代替真实 UI 验收。

P2 验证（Node `v24.22.1` / pnpm `10.34.9`）：

- frozen install、Lint、生产构建通过，依赖和锁文件未改。
- 聚焦回归：13 文件 / 282 测试通过；完整 Vitest：579 文件 / 2142 测试通过（比 P1 新增 71 项），耗时 105.06 秒，保留两条原有 vi.unmock 警告。
- 新增 storage / Provider 的 69 项测试包含 renderToString + hydrateRoot 首帧一致且无 recoverable hydration 错误、StrictMode 监听器平衡、存储异常、多标签页模拟事件和配置变化。另有 2 项首页集成测试。新模块行覆盖 100%、分支 95.45%、函数 100%。
- 复用 `python3 config/p1-baseline/run-baseline.py` 在 P2 代码上构建并通过虚构多地址配置的 standalone HTTP 回归：登录/退出、SSR/API、权限、过滤与私有缓存响应头；仅监听 loopback，结束已停止。日志中的 P1 字样来自复用脚本，不是新一轮浏览器偏好验收。
- 证据归档在被 Git/Docker 忽略的 `config/p2-baseline/evidence/`；HTTP 脚本仍位于 p1-baseline，认证密钥/随机密码/Cookie 不落盘。
- 主动诊断覆盖 6 个代码文件和 4 份更新文档：5 个代码文件 clean；首页保留 4 条既有静态规则警告与 1 条既有提示，无新增错误；4 份文档无语言服务答复（inconclusive），未计为 LSP 通过。代码 Prettier、git diff --check 和 Markdown 换行/尾空白/围栏/本地链接检查通过。

未完成：P3 真实链接/搜索/模式切换器、P4 菜单、P5 完整浏览器/反代验收、P6 CI/CD；P0 外部仓库设置仍待单独授权。没有真实跨标签页浏览器、触屏、OIDC 或反代验收；上游主题/颜色等自身的存储容错不在本阶段改动范围。本轮未进入 P3、未提交推送、未发布部署。

### P1 配置模型、纯解析与响应过滤记录（历史）

P1 验证时 HEAD 为 `dd145355`，随后本阶段源码与文档已按用户要求提交并推送为 `b584b902`。

2026-11-05 P1 实际变更：

- 新增 `src/utils/network/config.js`：全局配置规范化、服务地址校验、递归不可变响应过滤。
- 新增 `src/utils/network/resolver.js`：地址来源、fallback、保留原生 hasLink 语义、有序菜单候选；没有 DOM、存储或网络请求。
- 新增 `src/utils/network/server.js`：服务端脱敏诊断，通过现有 logger 输出并按上一轮诊断集合去重；不保存模式或服务列表。
- `src/utils/config/api-response.js` 仅增加导入及最终响应过滤调用。SSR/API 共用过滤，不修改 Widget 白名单、认证、缓存、监控、发现语法或书签行为。
- 新增 4 个测试文件（network 下 3 个、config 下 `network-response.test.js`），覆盖 SPEC T01～T14 的纯逻辑/配置链路部分；不代表卡片、搜索和恢复等 UI 已验收。
- 扩展关闭/全局错误时不转发服务的 network 数据，保留原始 href 与其他扩展命名空间；启用时仅替换响应副本内经过校验的 addresses。无可用原始 href 的服务仍不启用多地址。

P1 验证证据（Node `v24.22.1` / pnpm `10.34.9`）：

- frozen install、Lint、生产构建全部通过，依赖声明与锁文件未变。
- 聚焦配置/页面/认证/API 回归：20 文件、400 测试通过；完整 Vitest：577 文件、2071 测试通过（新增 169 项），耗时 106.00 秒；仅保留 P0 已有的两条 `vi.unmock` 警告。
- 新模块聚焦覆盖率：行 100%，分支 99.23%，函数 100%；不以覆盖率代替功能验收。
- `python3 config/p1-baseline/run-baseline.py`：带虚构多地址配置构建并启动 loopback standalone 实例，验证登录前首页/API/SSR 不泄漏默认及备用地址，登录后 SSR/API 相同、非法/带凭据候选不转发、默认 href 未改、Widget 密钥不泄漏、validate 不被非致命警告阻断、退出后受限。临时实例已停止。
- 证据在被 Git/Docker 忽略的 `config/p1-baseline/evidence/`；测试脚本/配置也在同目录，随机认证凭据和 Cookie 只在内存。
- 主动 LSP 检查 13 个文件：7 个新增 JS 及本地 Python 脚本共 8 个 clean；唯一接入文件仍有 2 条既有无效 await 提示及 3 条既有静态规则警告，无新增错误。4 份更新文档无语言服务答复（inconclusive），不能记为 LSP 通过。Prettier 代码检查、Python py_compile 和 Markdown 换行/尾空白/围栏/本地链接检查通过。

P1 结束时尚未进入 P2，功能与文档随后已授权提交推送；当前 P2 状态以上方记录为准。P0 外部设置及 P3～P6 仍未完成。

### P0 本地基线验证记录（历史）

P0 验证时位于 `feature/multi-address`，当时 HEAD 为 `2e5f1013`，文档尚未提交；随后用户已授权提交并推送为 `dd145355`。

P0 实际验证：

- Node `v24.22.1` / Corepack `0.36.0` / pnpm `10.34.9`。通过 `corepack pnpm@10.34.9` 执行，没有增加 packageManager 字段、升级依赖或改写锁文件。
- `corepack pnpm@10.34.9 install --frozen-lockfile`：通过。
- `corepack pnpm@10.34.9 lint`：首次 120 秒超时；延长到 600 秒重跑通过，无 Lint 错误。
- `corepack pnpm@10.34.9 test`：573 个测试文件、1902 项测试通过，耗时 108.42 秒。已有两条 Vitest 警告：`src/utils/proxy/http.test.js` 与 `src/components/favicon.test.jsx` 的嵌套 `vi.unmock` 会被提升，未来 Vitest 版本可能报错；未修改原有测试。
- `corepack pnpm@10.34.9 build`：在虚构配置和临时密码认证环境下通过，Next.js `16.4.1`，生成 standalone 产物。
- 运行 `python3 config/p0-baseline/run-baseline.py`，通过真实 standalone 服务的 HTTP 冒烟：健康检查、登录页、错误/正确密码、Session、登录后首页/服务/书签/SSR 数据、配置校验、退出后重新受限、Host 拒绝及 private/no-store 响应头。临时实例仅绑定 `127.0.0.1:3307`，验证后已停止。
- 配置、脚本及证据位于 `config/p0-baseline/`，被 Git 忽略且被 Docker context 排除。仅使用 `.invalid` 虚构域名；随机密码、认证密钥和 Cookie 仅在验证进程内存中，不写文件或日志。
- 本地 Python 验证脚本主动 LSP 检查：1 个文件 clean、0 条诊断；`py_compile` 通过。5 份规划文档的换行、尾部空白、代码围栏与本地链接检查通过；更新的 `agent.md`、`DESIGN.md`、`DEVELOPMENT.md` 主动 LSP 均未收到语言服务答复（inconclusive），不能记为 LSP 通过。业务源码未修改。

未执行：添加 upstream、联网确认/修改 GitHub 默认分支与保护规则（需要额外授权）；真实浏览器交互、OIDC、HTTPS/反向代理/CDN 验收（本次仅 HTTP 基线，不能视为 SPEC 全量验收）。P0 结束时未发现失败基线，当时未进入 P1、未提交、推送、发布或部署；后续状态以上方 P1 记录为准。

### 初始规划文档交付记录（保留历史）

最初新增文件：

| 文件             | 作用                                        |
| ---------------- | ------------------------------------------- |
| `AGENTS.md`      | 自动发现的仓库约束与阅读顺序                |
| `agent.md`       | 本交接入口                                  |
| `DESIGN.md`      | 实际代码地图、范围、模块设计、安全边界      |
| `SPEC.md`        | 配置/解析/恢复/菜单/搜索合同，30 个验收场景 |
| `DEVELOPMENT.md` | P0～P6 任务、测试命令、合并、CI/CD 和回滚   |

**没有**修改业务源码、依赖、认证、Actions 或远程配置；没有安装依赖、运行应用测试或构建镜像；没有提交、推送、发布、部署。文档静态校验不等于功能验收。

本轮文档校验：5 个文件的相互链接、已存在源码路径引用、结尾换行、尾部空白与代码围栏检查通过；4 段 YAML 及全部 JSON 示例解析通过。对 5 个 Markdown 文件的主动 LSP 检查均未得到语言服务有效答复，结果为 inconclusive，不能记为静态诊断通过。

初始交付时所有新增字段均待实现；目前 P1/P2 已提供解析、响应过滤和偏好状态，但在 YAML 中填入仍不会获得设计中的切换器或菜单，须完成后续阶段。

## 初始核查快照（2026-11-05）

- 分支 `main` 跟踪 `origin/main`，HEAD `2e5f10134ae3961bb936d3e7c441f9a1f4a4bf4f`，标签 `v2.7.0`。
- 编写文档前工作区干净，origin 是用户 Fork。
- 尚未配置 upstream，尚未修改 GitHub 默认分支或分支保护。
- 本地 `origin/HEAD -> origin/dev`；GitHub 真实当前默认分支仍需按需联网确认。
- Node `v24.22.1`，有 corepack；shell 未发现 pnpm，未安装 node_modules。
- 上游已有认证与相关回归测试，不需要重新开发。

快照仅供定位。下次先检查当前状态，不要自动回退到上述 commit。

## 建议下一步

P2 已建立偏好恢复合同，下一步经用户确认进入 **P3：真实链接、模式切换与搜索联动**：

1. 图标/标题使用同一纯解析结果；只有可扩展服务在 ready 前抑制 href，其余旧服务/书签照常。
2. 顶部信息区增加模式切换器，无 Widget 时也显示；消费 useNetwork，不另建模式状态。
3. 服务搜索使用不可变派生链接，面板已打开时也随模式更新；ready 前不可绕过保护，书签/搜索引擎/手动 URL 不变。
4. 新增英文/简中文案，完成组件和页面回归，不提前混入 P4 菜单。

内部约定：内置 default 的 `label: null` 留给 UI i18n；菜单候选为 `{ id, label, href, current }`，fallback 说明使用解析结果；ready 抑制由 P3/P4 真实导航组件实现，不能混入纯解析器。

P0 外部仓库设置仍单独待授权；不能将本地旧 `origin/HEAD -> origin/dev` 当成 GitHub 实时默认分支。不要一口气改全部页面和 CI；每阶段有证据后再更新状态。

## 容易踩坑的关键点

1. `SettingsProvider` 初始为空，`Home` Effect 才注入配置。Provider 设计应接收首页真实 initialSettings，不能先写默认偏好覆盖已有选择。
2. 卡片图标和标题有两处 href；QuickLaunch 是另一条导航链，不能漏掉。
3. 原始 href 不变；Widget URL、ping、siteMonitor 与浏览器导航模式无关。
4. 规范使用 `extensions.network`，保留 `default` 模式；旧配置不启用扩展。
5. v1 书签不做多地址，搜索引擎/访问 URL 也不套用模式规则。
6. 卡片含 `overflow-clip`，菜单要避免裁剪；右键不能覆盖 Widget/统计区域操作。
7. 恢复前不让可扩展服务误开默认地址；存储失败仍要完成 ready。
8. `/api/validate` 现有错误会阻断首页，不应直接塞入非致命网络警告。
9. 上游镜像任务限定官方仓库，不能认为 Fork 后自动能发布；Docker `CI=true` 要求已有构建产物。
10. GitHub GITHUB_TOKEN 创建 PR 后不一定触发其他普通工作流，自动同步须验证 CI 确实被触发。
11. 当前测试/构建 pnpm 9/10 不一致；Docker 非 CI 用 latest；正式发布需锁定工具。
12. 当前 Docker license label 与根 GPL v3 不一致，发布前核实修正。
13. 普通 `.env` 不保证被 Git 忽略，`.env*.local` 也不保证被 Docker context 排除，不提交真实秘密。
14. 所有“功能完成”“测试通过”“发布成功”必须附实际证据，不能从文档推断。

## 后续交接如何更新

每次开发结束，更新本文件的当前阶段/状态和实际验证摘要，保留历史事实与计划的区别。若接口行为发生变化，同步更新 SPEC；架构变化同步 DESIGN；工具、流程、命令变化同步 DEVELOPMENT。不要把 AGENTS 扩成不断增长的运行日志。
