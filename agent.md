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

## 当前状态：P0 本地开发基线已完成，多地址功能尚未实现

2026-11-05 经用户授权执行 P0，当前位于 `feature/multi-address`，HEAD 仍为 `2e5f10134ae3961bb936d3e7c441f9a1f4a4bf4f`，未提交。原有 5 份规划文档仍为未跟踪文件，必须保留。

实际验证：

- Node `v24.22.1` / Corepack `0.36.0` / pnpm `10.34.9`。通过 `corepack pnpm@10.34.9` 执行，没有增加 packageManager 字段、升级依赖或改写锁文件。
- `corepack pnpm@10.34.9 install --frozen-lockfile`：通过。
- `corepack pnpm@10.34.9 lint`：首次 120 秒超时；延长到 600 秒重跑通过，无 Lint 错误。
- `corepack pnpm@10.34.9 test`：573 个测试文件、1902 项测试通过，耗时 108.42 秒。已有两条 Vitest 警告：`src/utils/proxy/http.test.js` 与 `src/components/favicon.test.jsx` 的嵌套 `vi.unmock` 会被提升，未来 Vitest 版本可能报错；未修改原有测试。
- `corepack pnpm@10.34.9 build`：在虚构配置和临时密码认证环境下通过，Next.js `16.4.1`，生成 standalone 产物。
- 运行 `python3 config/p0-baseline/run-baseline.py`，通过真实 standalone 服务的 HTTP 冒烟：健康检查、登录页、错误/正确密码、Session、登录后首页/服务/书签/SSR 数据、配置校验、退出后重新受限、Host 拒绝及 private/no-store 响应头。临时实例仅绑定 `127.0.0.1:3307`，验证后已停止。
- 配置、脚本及证据位于 `config/p0-baseline/`，被 Git 忽略且被 Docker context 排除。仅使用 `.invalid` 虚构域名；随机密码、认证密钥和 Cookie 仅在验证进程内存中，不写文件或日志。
- 本地 Python 验证脚本主动 LSP 检查：1 个文件 clean、0 条诊断；`py_compile` 通过。5 份规划文档的换行、尾部空白、代码围栏与本地链接检查通过；更新的 `agent.md`、`DESIGN.md`、`DEVELOPMENT.md` 主动 LSP 均未收到语言服务答复（inconclusive），不能记为 LSP 通过。业务源码未修改。

未执行：添加 upstream、联网确认/修改 GitHub 默认分支与保护规则（需要额外授权）；真实浏览器交互、OIDC、HTTPS/反向代理/CDN 验收（本次仅 HTTP 基线，不能视为 SPEC 全量验收）。当前未发现失败基线，未进入 P1，未提交、推送、发布或部署。

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

所有新增配置字段都是待实现能力，当前在 YAML 中填入不会自动获得设计中的界面。

## 初始核查快照（2026-11-05）

- 分支 `main` 跟踪 `origin/main`，HEAD `2e5f10134ae3961bb936d3e7c441f9a1f4a4bf4f`，标签 `v2.7.0`。
- 编写文档前工作区干净，origin 是用户 Fork。
- 尚未配置 upstream，尚未修改 GitHub 默认分支或分支保护。
- 本地 `origin/HEAD -> origin/dev`；GitHub 真实当前默认分支仍需按需联网确认。
- Node `v24.22.1`，有 corepack；shell 未发现 pnpm，未安装 node_modules。
- 上游已有认证与相关回归测试，不需要重新开发。

快照仅供定位。下次先检查当前状态，不要自动回退到上述 commit。

## 建议下一步

本地 P0 基线已建立，等待用户确认进入 **P1：纯配置模型和解析测试**：

1. 在现有 `feature/multi-address` 分支新增纯配置规范化、地址解析及测试，按 SPEC 覆盖 T01～T14 的相关部分。
2. 将新增地址过滤接入共同服务响应链路，覆盖嵌套分组，不改认证、Widget 白名单或原始 href。
3. 沿用 Node `v24.22.1` / pnpm `10.34.9`，完成聚焦测试、全量回归、Lint 和生产构建后更新交接。

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
