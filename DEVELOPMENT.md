# 二开实施、测试与上游维护手册

> 本文全部路径相对仓库根目录。新会话直接在本目录启动，无需父目录或其他项目。
> 当前正式发布方向：不采用预览版快速路线；仅P5手机兼容验证延期，非手机P5及其余必需验收完成后再正式交付多地址Docker Hub镜像，见SPEC12.1和本文14。正式规划已保存；最新继续F03本地工具开发与回归，尚未提交/推送，不自动合并、运行Actions或发布。P1～P4及P5自动化已完成，其余状态按13～14逐项保留。P6 自动化基础已合入 main，功能分支同步 main 后 c89b6a93 的真实 CI 通过；Docker Hub 发布基础已独立提交89f0a542、创建Draft PR #4并核实真实应用CI成功，尚未合入main/启用；原feature13项另获本轮提交/推送授权，实际新head CI另核。真实镜像构建、发布/拉取/回滚与上游写入仍待验证。第 13 节为当前后续工作追踪表，第 5/9 节保留历史阶段证据，不能用旧记录代签新交付。

## 1. 阅读顺序

1. [AGENTS.md](AGENTS.md)：自动加载的仓库级协作约束。
2. [agent.md](agent.md)：简明会话交接、当前状态和下一步。
3. [DESIGN.md](DESIGN.md)：背景、实际代码地图与架构。
4. [SPEC.md](SPEC.md)：字段、行为、异常边界和验收合同。
5. 本文：实施阶段、命令、CI/CD、上游集成和回滚。

本文不是修改上游全部开发流程的许可。保留 `CONTRIBUTING.md`、项目许可证和原有风格。

## 2. 开始前先检查

以下命令从本仓库执行，只读检查：

```bash
pwd
git status --short --branch
git remote -v
git branch -vv
git log -1 --format='%H %s'
git describe --tags --always
node --version
command -v pnpm || true
command -v corepack || true
```

首次文档核查快照：`main@2e5f1013`，包版本/标签 `2.7.0` / `v2.7.0`，`origin` 指向 `kanon-H/homepage`；没有 `upstream`。存在本地 `dev` 分支，远程默认引用指向 `origin/dev`，但开发明确以 `main` 为准。

不要执行 `git reset --hard`、`git clean -fd`、强推、删除其他人的分支或自动隐藏用户改动。发现工作区有变更，先读取差异并保留。

## 3. 基础配置与 P0 外部记录

2026-11-06 已按用户明确确认的“main＋基础保护”完成下述基础设置；必需 CI 检查名的绑定留待 P6，不冒充已经完成的 CI 门禁。

### 3.1 官方 upstream（已完成）

已核查无同名 remote 后执行：

```bash
git remote add -t main upstream https://github.com/gethomepage/homepage.git
git fetch --no-tags upstream main
git remote set-head upstream main
```

结果：fetch refspec 仅 `+refs/heads/main:refs/remotes/upstream/main`，来源为 `2e5f10134ae3961bb936d3e7c441f9a1f4a4bf4f`（v2.7.0），与原基线相同。官方 GitHub 默认仍是 dev，但本项目明确选其 main 稳定来源，不跟随开发默认分支。

上述不是要求未来重复添加 remote；已存在时先检查 URL，不盲目覆盖。origin 保留用户 Fork，本地 main/功能分支仍跟踪 origin；没有 checkout、merge、rebase 或移动分支。

### 3.2 GitHub 默认分支与基础保护（已完成）

2026-11-06 先用 REST API 与 Git 传输核查 Fork `kanon-H/homepage` 实际默认为 dev、main 未保护且无 ruleset，再按用户确认改为 main 并创建基础保护。重新读取 API 及 `git ls-remote --symref origin HEAD` 均确认 main；随后执行：

```bash
git remote set-head origin -a
```

该命令只刷新本地引用，不会改变 GitHub 网站设置；本次网站设置由 API 单独完成并核实。本地 origin/HEAD 已为 origin/main，upstream/HEAD 明确选 upstream/main，旧 dev 引用仅保留为历史，不代表当前 Fork 默认分支。

main 当前基础保护：

- 必须通过 PR；required approvals=0，个人可合并自己的 PR，不强制找第二人审批。
- enforce_admins=true，管理员也受约束；allow_force_pushes=false、allow_deletions=false。
- required_linear_history=false，allow_merge_commit=true，允许保留合并历史。仓库 squash/rebase 开关保留原值；**上游集成 PR 必须使用 merge commit、不 squash**，不是看到开关允许就随意选择。
- **CI 已在 P6 后续绑定**：P0 当时按用户安排为 required_status_checks=null；本轮确认最新 PR 真实 CI 成功后，按新授权绑定 `Fork verification`、github-actions App 15368、strict=true。完整保护和独立状态检查接口均读回正确，其余规则不变；失败负例后续已获授权验证并清理，检查缺失等场景未独立演练，不扩大结论，详见 10.2。

初次 PATCH 返回 HTTP 500 后，先重新用 API/传输确认仍 dev/未保护再重试；成功响应均 200，之后再读取验证策略。GitHub TLS 偶发握手中断均保留证据、使用原请求重试，没有关闭证书校验。现有认证凭据只在内存用于已授权的 Fork API，不打印/落盘；脱敏审计位于被 Git/Docker 忽略的 `config/p0-external/evidence/`。

P0 元数据配置时没有移动任何分支提交：main/origin/main/upstream/main 均保持 `2e5f1013`；二开当时在 feature/multi-address 的 `d5ade7b6`，尚未通过 PR 合入 main。后续 P0 交接文档提交不等于合入 main。GitHub 设置变更不是代码合并、CI 运行或发布/部署。

### 3.3 工具版本

上游当前存在工具版本差异：

| 文件                                   | 已观察到的 pnpm 选择                            |
| -------------------------------------- | ----------------------------------------------- |
| `.github/workflows/test.yml`           | pnpm 9                                          |
| `.github/workflows/lint.yml`           | pnpm 10                                         |
| `.github/workflows/docker-publish.yml` | pnpm 10                                         |
| 原 `Dockerfile` 非 CI 路径             | `pnpm@latest`（保留上游）                       |
| 新 `Dockerfile.fork` / Fork 发布任务   | `10.34.9`，Node `24.22.1`，基础镜像 digest 固定 |
| `package.json`                         | 未声明 packageManager                           |

锁文件格式是 9.0，不代表必须用 pnpm 9。二开专用 CI 建议验证后统一到一个固定的 pnpm 10 补丁版本和 Node 24；版本在选型验证前不能写成“已经固定”。不要无故升级上游全部依赖或重写锁文件。

初始核查时只有 Node 和 corepack，没有 pnpm 和 node_modules。2026-11-05 的 P0 已验证 Node `v24.22.1` / Corepack `0.36.0` / pnpm `10.34.9`，后续开发使用 `corepack pnpm@10.34.9 <命令>`。P6 新增的 fork-ci.yml 已固定 Node `24.22.1` / pnpm `10.34.9`；继承工作流只加官方仓库门禁，工具选择未改，package.json / 锁文件未改。固定版本的 PR CI 已在 GitHub 真实运行验证，不能据此声称全部上游 CI 或 Docker 构建已统一。

首次建立环境时，可先以 Corepack 试运行：

```bash
corepack pnpm@10 --version
corepack pnpm@10 install --frozen-lockfile
```

这是建立基线的试运行方式，不是可复现发布的最终精确版本锁定。确定版本后，开发环境和 CI 必须使用同一精确版本。安装可能下载依赖并执行生命周期脚本，离线、权限、registry 问题须如实报告，不可假称通过。

如果安装更新了锁文件，先停下来核查工具版本、源配置和差异，不自动提交依赖大改。

## 4. 当前源码阅读地图

| 区域         | 必读文件                                                              | 注意事项                                    |
| ------------ | --------------------------------------------------------------------- | ------------------------------------------- |
| 首页入口     | `src/pages/index.jsx`                                                 | Wrapper / Index / Home；SSR、顶部、搜索条目 |
| App Provider | `src/pages/_app.jsx`                                                  | SettingsProvider 默认可能是空对象           |
| 设置状态     | `src/utils/contexts/settings.jsx`                                     | Home Effect 再注入 initialSettings          |
| 服务卡片     | `src/components/services/item.jsx`                                    | 图标、标题两处链接；统计和 Widget 不可误伤  |
| 搜索         | `src/components/quicklaunch.jsx`                                      | `openCurrentItem` 使用 result.href          |
| 书签         | `src/components/bookmarks/item.jsx`                                   | v1 不做多地址                               |
| 配置加载     | `src/utils/config/config.js`                                          | CONF_DIR、环境替换                          |
| 服务解析     | `src/utils/config/service-helpers.js`                                 | 递归分组、发现、Widget 字段清洗             |
| 响应组装     | `src/utils/config/api-response.js`                                    | 服务与书签来源不同                          |
| 首页缓存     | `src/utils/config/dashboard.js`                                       | 缓存与浏览器模式必须无关                    |
| 服务 API     | `src/pages/api/services/index.js`                                     | withAuth 不能去掉                           |
| 认证边界     | `src/utils/auth.js`、`src/proxy.js`                                   | Handler 401 和入口重定向不同                |
| 校验         | `src/pages/api/validate.js`                                           | 现有错误数组会影响整页，别塞非致命警告      |
| 翻译         | `public/locales/en/common.json`、`public/locales/zh-Hans/common.json` | 不使用 zh-CN 目录                           |
| 测试工具     | `src/test-utils/render-with-providers.jsx`                            | 兼容新增 Provider 缺省行为                  |

先读最新代码再修改。上游合并后函数、结构、版本可能变化，不按旧行号机械套补丁。

## 5. 分阶段实施计划

P0 本地基线与基础外部设置、P1～P4 功能、P5 自动化与文档已完成；P5 剩余验收/兼容问题仍未完成；P6 CI 基础已提交推送且 PR 真实运行通过，必需 CI 配置、绿色正例及失败负例已核验，同步/发布仍未完成。阶段记录是当时的历史证据，后续浏览器与工具状态以 P5 记录为准。

### P0：建立可信开发基线

- [x] 核查分支/remote/工作区，确认用户允许的改动范围。
- [x] 配置 upstream 仅跟踪官方 main；2026-11-06 用户另行授权并确认 main＋基础保护，Fork 默认 main/PR 基础保护与本地 HEAD 引用均已核实，详见第 3 节；CI 检查名绑定待 P6。
- [x] 在功能分支 `feature/multi-address` 开发；P0 时 HEAD 为 `2e5f1013`，随后文档按用户要求提交并推送为 `dd145355`。
- [x] 安装锁文件依赖，记录 Node `v24.22.1` / pnpm `10.34.9`，package.json 与锁文件无变化。
- [x] 在未改功能前运行 Lint、Vitest、生产构建，记录上游已有失败。
- [x] 创建仅包含虚构域名的开发配置，启用原生密码登录，以 standalone HTTP 实例验证基线。

2026-11-05 实际证据：

| 命令 / 检查                                       | 结果                                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `corepack pnpm@10.34.9 install --frozen-lockfile` | 通过，未改锁文件                                                                                                                         |
| `corepack pnpm@10.34.9 lint`                      | 首次 120 秒超时；600 秒时限重跑通过                                                                                                      |
| `corepack pnpm@10.34.9 test`                      | 573 文件 / 1902 测试通过，108.42 秒                                                                                                      |
| `corepack pnpm@10.34.9 build`                     | 虚构配置、原生密码认证环境下通过，Next.js 16.4.1 standalone                                                                              |
| `python3 config/p0-baseline/run-baseline.py`      | 构建并启动仅 loopback 的临时 standalone 实例；登录/错误密码/退出、首页/API/SSR 数据权限、Host、private/no-store 和配置校验通过，随后停止 |
| Python 脚本静态检查                               | `py_compile` 与主动 LSP 均通过；未修改业务源码                                                                                           |
| 文档检查                                          | 5 份文档的换行、尾部空白、围栏及本地链接通过；3 份更新文档的主动 LSP 无语言服务答复（inconclusive），未计为通过                          |

Vitest 有两条既有嵌套 `vi.unmock` 提升警告，位于 `src/utils/proxy/http.test.js` 和 `src/components/favicon.test.jsx`，没有失败测试，未为消除警告修改上游测试。

复现入口与虚构 YAML 位于被 Git/Docker 忽略的 `config/p0-baseline/`。脚本使用 Python 标准库，在内存生成随机密码、认证密钥并维护 Cookie；凭据不落盘。日志留在 `/tmp/homepage-p0-{install,lint,test,build,smoke,server}.log`，副本保存于 `config/p0-baseline/evidence/`。脚本复制 public/static 到 standalone，临时服务只监听 `127.0.0.1:3307` 并在结束时停止，不是生产部署。该本地目录不会随 Git 分发，未来 CI 不能依赖其存在。

初次 P0 当时没有真实浏览器可执行程序，未做浏览器渲染/交互、OIDC、HTTPS 或反代/CDN；HTTP 响应头通过不等于反代缓存验收。外部设置当时未完成，后于 2026-11-06 按第 3 节用户方案补齐基础配置；后续功能/验收证据分别见 P1～P5，不伪装成初次基线的结果。

验收：已能区分“上游已有问题”“环境问题”和“新增回归”；无密钥进 Git。

### P1：纯配置模型与解析

- [x] 新建 `src/utils/network/config.js`、`resolver.js` 及测试。
- [x] 按 SPEC 实现启用规则、保留 default、ID/label/地址校验和脱敏诊断。
- [x] 实现不可变地址选择、fallback 和菜单候选。
- [x] 接入服务响应清洗，确保 SSR 和 API 同源，覆盖嵌套服务。
- [x] 不改 Widget 白名单、不直接将警告塞进现有 validate 错误数组。

2026-11-05 P1 验收：SPEC T01～T14 的纯逻辑与配置链路部分已覆盖；T07 的真实链接/搜索、T14 的页面搜索派生等 UI 部分仍待后续阶段，不能将整张验收矩阵勾为完成。

实际命令均使用 Node `v24.22.1`、`corepack pnpm@10.34.9`：

| 检查            | 命令 / 结果                                                                                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 依赖            | `install --frozen-lockfile` 通过，package.json / 锁文件不变                                                                                                                                                                                           |
| 聚焦回归        | `exec vitest run src/utils/network src/utils/config src/__tests__/pages/api/services/index.test.js src/__tests__/pages/index.test.jsx src/utils/auth.test.js src/proxy.test.js src/__tests__/pages/api/auth-boundary.test.js`：20 文件 / 400 测试通过 |
| 完整回归        | `test`：577 文件 / 2071 测试通过，106.00 秒，比 P0 新增 169 项；两条原有 vi.unmock 警告未改                                                                                                                                                           |
| Lint            | `lint` 通过                                                                                                                                                                                                                                           |
| 覆盖率          | `exec vitest run src/utils/network src/utils/config/network-response.test.js --coverage --coverage.include='src/utils/network/*.js'`：169 测试通过；新模块行 100%、分支 99.23%、函数 100%                                                             |
| 生产构建与 HTTP | `python3 config/p1-baseline/run-baseline.py` 执行 `build` 并用虚构多地址配置验证 standalone 的 SSR/API 同源过滤、原始 href、旧相对链接、其他扩展保留、Widget 密钥、认证/private cache 及非致命 validate，全部通过；仅监听 loopback，结束停止          |
| 主动诊断与格式  | 7 个新增 JS 和本地 Python 脚本共 8 个 clean；api-response.js 保留 2 条既有 await 提示和 3 条既有规则警告，无新增错误；4 份更新文档 LSP 无答复（inconclusive）；代码 Prettier、Python py_compile 和 Markdown 静态检查通过                              |

本地配置、复现脚本和证据副本位于 Git/Docker 已忽略的 `config/p1-baseline/`，原始日志为 `/tmp/homepage-p1-{install,focused,coverage,lint,test,build,smoke,server}.log`。脚本不持久化随机认证凭据或 Cookie，不依赖真实配置。

开发中新增集成测试先遇到 Kubernetes 模块初始化读取虚构路径的问题，通过 mock 外部发现模块解决；随后按实际 Widget 白名单完整字段修正新测试预期，未改弱原有断言。最终聚焦及全量测试均通过。

内部接口约定见 DESIGN：纯规范化不记录日志；server.js 仅缓存当前模块实例上一轮脱敏警告集合，不保存浏览器模式。不同路由构建包/进程可各自输出首次警告，不承诺全部署只输出一次。没有引入依赖或改动认证、发现语法、Widget 白名单、浏览器 UI、存储、Actions。

未运行真实浏览器、OIDC、HTTPS/反代缓存验收；这些仍属后续阶段。P1 改动随后已按用户要求提交/推送为 `b584b902`；当前 P2 状态见下一节。

### P2：Provider 与偏好恢复

- [x] 新建安全 storage 适配和 `NetworkProvider` / Hook。
- [x] 页面级 Provider 接收真实 `initialSettings`。
- [x] 完成 SSR 首帧、ready、存储失败、StrictMode、多标签页和配置变更处理。
- [x] 无 Provider 时返回禁用状态，兼容上游独立组件测试。

2026-11-05 P2 验收：SPEC T15～T20 的 storage/Provider 生命周期部分已覆盖；T16 真实卡片和搜索入口的 ready 抑制仍待 P3，不能标为整个场景已完成。多标签页通过合成 localStorage 事件测试，未替代真实浏览器跨标签页验收。

实际命令均使用 Node `v24.22.1`、`corepack pnpm@10.34.9`：

| 检查            | 命令 / 结果                                                                                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 依赖            | `install --frozen-lockfile` 通过，package.json / 锁文件未改                                                                                                                                                                                                  |
| 聚焦回归        | `exec vitest run src/utils/network src/utils/contexts src/__tests__/pages/index.test.jsx src/__tests__/pages/_app.test.jsx src/components/services/item.test.jsx src/components/quicklaunch.test.jsx`：13 文件 / 282 测试通过                                |
| 完整回归        | `test`：579 文件 / 2142 测试通过，105.06 秒，比 P1 新增 71 项；仅保留两条原有 vi.unmock 警告                                                                                                                                                                 |
| Lint            | `lint` 通过                                                                                                                                                                                                                                                  |
| 覆盖率          | `exec vitest run src/utils/network/storage.test.js src/utils/contexts/network.test.jsx --coverage --coverage.include='src/utils/network/storage.js' --coverage.include='src/utils/contexts/network.jsx'`：69 测试通过；新模块行 100%、分支 95.45%、函数 100% |
| 生产构建与 HTTP | 在 P2 代码上复用 `python3 config/p1-baseline/run-baseline.py`，构建和 standalone 登录/退出、权限、SSR/API 同源、过滤及 private/no-store 回归全部通过，临时服务结束停止                                                                                       |
| 主动诊断与格式  | 6 个代码文件检查，5 个 clean；index.jsx 保留 4 条既有静态规则警告及 1 条提示，无新增错误；4 份文档 LSP 无答复（inconclusive），未计为通过；代码 Prettier、git diff --check、Markdown 静态检查通过                                                            |

修改范围：新增 storage.js / storage.test.js、contexts/network.jsx / network.test.jsx；首页仅导入并用 NetworkProvider 包裹 Index；首页测试增加 2 项接入验证，未弱化现有断言。开发时发现新测试探针在 Render 赋值触发 React Hooks 纯度规则，已改为布局 Effect 暴露测试状态；未关闭 Lint 规则。

实现采用 React 原生 useSyncExternalStore，每个 Provider 自有快照；SSR/首帧不读取浏览器，订阅阶段恢复，用户事件显式写回。storage 的 parse/read/write/remove 返回安全降级结果；Provider 不在初始化、无效值回退或禁用时调用删除。重新启用需再次恢复；配置变化保留合法偏好，非法当前 ID 在同一 Render 就回退。不读写 YAML/SWR/服务器共享数据，不引入依赖。

本轮日志为 `/tmp/homepage-p2-{install,focused,coverage,lint,test,build,smoke,server}.log`，证据副本在 Git/Docker 忽略的 `config/p2-baseline/evidence/`。HTTP 回归复用 p1-baseline 的配置和脚本，因此日志 PASS 文案仍带 P1 字样；构建/服务日志从该脚本原路径复制为 P2 证据，未覆盖已归档的 P1 证据。本轮没有单独新增 Python 脚本。

没有真实浏览器跨标签页、触屏、OIDC、HTTPS 或反代/CDN 验收；本阶段测试仅保证网络扩展的存储容错，未改动上游 Theme/Color 等自身的存储代码，全页禁用存储的浏览器兼容性仍需后续核查。UI 仍使用上游原始 href，偏好尚不改变真实导航。P2 后续已按用户要求提交/推送为 `73d36b37`；P3 状态见下一节。

验收：不在 Render 读 window，不先写默认偏好，不污染共享缓存。

### P3：真实链接、模式切换与搜索联动

- [x] 卡片图标和标题使用相同解析结果；恢复前避免误开默认地址。
- [x] 右上方模式选择器，无 Widget 时也显示；原生 select 可键盘访问，已实现宽度限制及换行布局。
- [x] 服务搜索结果以不可变派生条目使用当前地址。
- [x] 搜索面板打开后模式变更立即生效，ready 保护一致。
- [x] 普通书签、搜索引擎、手动 URL 不变化。
- [x] 新增英文和简中文案，不改模式标签语义。
- [ ] 完整人工浏览器验收：P5 已补充 Chromium 原生操作/多标签页自动化及用户 macOS Cmd/原生菜单反馈；物理手机基础触屏已反馈，但小米/QQ 的同页导航差异及其他未覆盖场景仍未解决，不能用部分通过代替全验收。

2026-11-05 P3 已实现并自动化覆盖 SPEC T07/T08/T16/T22/T26/T27/T30 中的卡片、搜索、恢复与文案部分。菜单相关部分待 P4，T26 手机实际布局及原生导航仍未验收；不标记整个 v1 完成。

实际命令使用 Node `v24.22.1` / `corepack pnpm@10.34.9`：

| 检查          | 命令 / 结果                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 依赖          | `install --frozen-lockfile` 通过，依赖声明/锁文件无变化                                                                                                                                                                                                                                                                                                              |
| 聚焦回归      | `exec vitest run src/utils/network src/utils/contexts/network.test.jsx src/components/network src/components/services/item.test.jsx src/components/quicklaunch.test.jsx src/__tests__/pages/index.test.jsx src/__tests__/pages/_app.test.jsx`：11 文件 / 313 测试通过                                                                                                |
| 完整回归      | `test`：581 文件 / 2180 测试通过，比 P2 新增 38 项，105.37 秒，仅两条已有 vi.unmock 警告                                                                                                                                                                                                                                                                             |
| Lint          | `lint` 通过                                                                                                                                                                                                                                                                                                                                                          |
| 覆盖率        | `exec vitest run src/utils/network/navigation.test.js src/components/network src/components/services/item.test.jsx src/components/quicklaunch.test.jsx src/__tests__/pages/index.test.jsx --coverage --coverage.include='src/utils/network/navigation.js' --coverage.include='src/components/network/mode-switcher.jsx'`：81 项通过；两个新增模块行/分支/函数均 100% |
| 生产构建/SSR  | `python3 config/p3-baseline/run-baseline.py`：构建通过；enabled / disabled / legacy 三种配置分别启动临时 standalone，原生选择器与 SSR 恢复保护、旧链接/书签/target、认证/private cache、SSR/API 原始快照一致均通过；三个实例结束停止                                                                                                                                 |
| 文案          | 真实 i18next 资源测试 en、zh-Hans、缺失语言回退；配置标签不作为 key/HTML 解释                                                                                                                                                                                                                                                                                        |
| 主动诊断/格式 | 17 文件：9 clean，4 文件有 13 条既有 advisory，4 文档无语言服务答复（inconclusive）；另有 1 项有说明的 no-open-redirect 单点例外，未计为 clean；代码 Prettier、Python py_compile、JSON/文档静态及 git diff --check 通过                                                                                                                                              |

修改范围：新增 navigation.js / navigation.test.js、mode-switcher.jsx / mode-switcher.test.jsx，接入服务卡片、首页、QuickLaunch 并扩充其测试；只改 en / zh-Hans 的 3 个同名文案。P1/P2 核心、认证、Widget 白名单、后端连接、书签组件、依赖及 Actions 不变。

实现/测试注意：

- 导航适配层与原 resolver 分离；卡片和服务搜索复用同一个 ready 资格规则。搜索先筛选原始 href 后派生，恢复中的结果不消失，仅清空副本 href 并禁用按钮；打开入口显式检查 href，不自动排队、不切换原始 href。
- 卡片测试使用真实 SSR/hydration，检查从未附上默认 href 而是直接恢复到已保存的 LAN；Widget 节点、统计展开状态和 target/rel 不被模式切换改写。
- 新 QuickLaunch 测试在 jsdom 中沿用现有 DOM 结果定位：该环境不加载 Tailwind，原有嵌套 dialog 的结果无法由默认 role 查询取得；未为测试改动上游模态语义，未弱化既有断言。
- 既有 window.open 外部启动器触发 no-open-redirect 静态规则：已复核其为用户主动导航（SPEC SRCH-01），不是认证回调；新增备用地址仍由 P1 严格校验。使用逐调用点 pi-lens-ignore 并保留说明，不全局关闭规则，也不以同源限制破坏旧服务/书签/用户输入 URL。该位置是有理由的规则例外，不算“检测器确认 clean”。

本地脚本、虚构配置和证据位于 Git/Docker 忽略的 `config/p3-baseline/`；原日志 `/tmp/homepage-p3-{install,focused,coverage,lint,test,build,smoke}.log` 及 `server-{enabled,disabled,legacy}.log` 归档到 evidence/。临时服务只监听 `127.0.0.1:3307`，随机认证密钥/密码/Cookie 不落盘。本次生产 SSR 验证使用 HTMLParser 读取真实响应，不是浏览器水合、布局或原生点击验证。

P3 后续已按用户要求提交/推送为 `3f7aed7e`（含保留的 JSON 格式调整），本轮 P4 状态见下一节；未发布部署。主动诊断中的 advisory 来自 QuickLaunch/首页既有代码，以及翻译内已有 pyload/criticals 等字段的拼写提示，未为消除提示改动上游字段。后续先安排真实浏览器环境补验，P4 是否开始需用户确认。

### P4：服务菜单与无障碍

- [x] 右键仅导航区接管，Widget/统计操作保持原生。
- [x] 可见更多按钮、菜单 Portal/视口定位。
- [x] 默认/备用地址链接、当前来源标记、复制当前地址。
- [x] 单菜单互斥、滚动/外部点击关闭、焦点恢复、按键事件隔离。
- [x] Clipboard 失败提示、Shift+右键回退。
- [ ] 完整人工菜单验收：P5 已补齐 Chromium 原生操作/几何/焦点自动化及用户 macOS 原生菜单、手机触屏基础反馈；小米/QQ 同页导航差异和未覆盖交互仍待解决，触屏模拟不代替完整物理验收。

2026-11-05 P4 代码与自动化验收：覆盖 SPEC T21～T25 及菜单侧 T07/T08/T16/T22/T30 的相关部分；真实浏览器要求仍未完成，不宣称完整 v1 已完成。

实际命令使用 Node `v24.22.1` / `corepack pnpm@10.34.9`：

| 检查          | 命令 / 结果                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 依赖          | `install --frozen-lockfile` 通过，package.json / 锁文件不变                                                                                                                                                                                                                                                                                                                                                                              |
| 聚焦回归      | `exec vitest run src/components/network src/utils/network src/utils/contexts/network.test.jsx src/components/services/item.test.jsx src/components/quicklaunch.test.jsx src/__tests__/pages/index.test.jsx src/__tests__/pages/_app.test.jsx`：13 文件 / 362 测试通过                                                                                                                                                                    |
| 完整回归      | `test`：583 文件 / 2229 测试通过，比 P3 新增 49 项，107.95 秒；仅两条原有 vi.unmock 警告                                                                                                                                                                                                                                                                                                                                                 |
| Lint          | `lint` 通过                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 覆盖率        | `exec vitest run src/components/network/service-menu.test.jsx src/utils/network/menu-position.test.js src/components/services/item.test.jsx src/utils/contexts/network.test.jsx --coverage --coverage.include='src/components/network/service-menu.jsx' --coverage.include='src/utils/contexts/service-menu.jsx' --coverage.include='src/utils/network/menu-position.js'`：4 文件 / 102 测试通过；新模块行 100%、分支 94.3%、函数 97.72% |
| 生产构建/SSR  | 在 P4 工作树复用 `python3 config/p3-baseline/run-baseline.py`，构建及 enabled/disabled/legacy 三配置 standalone SSR/API/登录退出/私有缓存响应头回归全部通过，三个临时实例均停止；不等于菜单浏览器验收                                                                                                                                                                                                                                    |
| 主动诊断/格式 | 13 文件：7 个 JS/JSX clean，两个 JSON 留有 5 条既有 widget ID/文案拼写提示；4 文档无语言服务答复（inconclusive），不计为通过；代码 Prettier、复用脚本 py_compile、JSON/文档静态及 git diff --check 通过                                                                                                                                                                                                                                  |

实施边界与证据：

- 新增 contexts/service-menu.jsx、network/service-menu.jsx 及组件测试、network/menu-position.js 及纯函数测试。NetworkProvider 仅增加独立菜单 Provider 包裹，偏好合同不变；卡片仅给两处 anchor 绑定右键，在链接外加入按钮并预留统计标签位置。只增加 en/zh-Hans 的 8 项文案，没有新增依赖。
- 使用现有 Headless UI Portal；右键坐标、全局单菜单和外部状态失效需要受控菜单，所以自行实现小型 ARIA 焦点/键盘层，不通过隐藏按钮 click 或 DOM 注入驱动 Headless Menu。菜单状态记录按身份比较，旧关闭定时器和异步复制不能影响新菜单；不读写 YAML、SWR、模式偏好或后端连接。
- 链接保留真实 href/target/rel，原生激活完成后才用可清理的零延时任务关闭；测试确认合成 Ctrl/辅助点击未被取消，但不声称浏览器真的打开新标签页。焦点只回到仍连接的触发器，菜单内滚动不关闭，菜单键不触发主页搜索。
- Clipboard 只在用户事件调用，检查安全上下文/API；成功才显示成功，异常/拒绝/缺失显示错误，不输出地址或异常内容，不加 execCommand/旧式 DOM 复制。等待时焦点留在菜单；复制完成不抢走后续菜单焦点。
- 新增组件测试最初对统计按钮的完整可访问名称假设错误（含 mock 状态文字），已改为查询明确的统计功能标签；未弱化旧断言、未修改上游控件以迎合测试。

日志副本与源码校验和在被 Git/Docker 忽略的 `config/p4-baseline/evidence/`。原始日志 `/tmp/homepage-p4-{install,focused,coverage,lint,test,build,smoke}.log` 及 `server-{enabled,disabled,legacy}.log`；复用的脚本仍在 p3-baseline，日志 PASS 文案中的 P3 属于脚本名称，旧 P3 evidence 未被覆盖。临时服务仅绑定 `127.0.0.1:3307`，真实认证凭据/Cookie 不落盘。

P4 当时没有新增静态规则豁免，P3 的 QuickLaunch 单点说明保持原样。P4 结束时尚未运行真实浏览器、多标签页、OIDC 或 HTTPS/反代/CDN，几何 mock 不证明真实 CSS。P4 后续已按用户要求提交/推送为 `808af4fa`；P5 进展见下节，仍未发布部署。

验收仍需：真实浏览器验证中键/右键/移动布局，不只靠 jsdom。

### P5：安全、兼容与使用文档

- [x] frozen install、Lint、完整测试与生产构建通过，无新增业务失败。
- [x] 原生密码登录/退出、API、SSR/Next 数据与本地真实 HTTPS/nginx 缓存验证无匿名数据泄漏。
- [x] enabled false（含旧偏好）和纯上游配置的真实浏览器回归。
- [x] 记录 Chromium 版本、桌面/移动模拟视口、模式组合和实际结果。
- [x] 更新真实实现状态，提供[用户使用说明](docs/configs/network.md)及服务/站点导航入口。
- [x] 续办普通非安全 HTTP 的真实 Clipboard 不可用、失败反馈/不跳转和后续导航回归；提供[人工记录模板](docs/more/network-acceptance.md)。
- [x] 用户在 macOS / Chrome `155.0.8059.85`、Edge `154.0.4258.37`（均正式版 arm64）反馈 1～8 项基础桌面操作正常，包括 Cmd 点击、原生右键/Shift、上下键/Escape、缩窄布局及 HTTP 复制失败。
- [ ] 手工中键（当前设备无中键）、完整键盘焦点/Widget统计等未覆盖项、物理触屏，以及使用中的目标 OIDC/反代/CDN 验收。

2026-11-05：**P5 自动化与文档完成，完整验收未完成**。没有业务源码、认证、Widget、依赖/锁文件、Actions 或生产服务改动。用户现另行授权提交/推送本轮 P5 成果，不包含恢复兼容排查、P6、发布或生产部署。下表保留初次 237 项验证；续办 245 项见后文。

| 检查             | 命令 / 结果                                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 环境与依赖       | Node `v24.22.1` / Corepack `0.36.0` / `corepack pnpm@10.34.9 install --frozen-lockfile` 通过，依赖声明/锁文件不变                                                                   |
| Lint             | `corepack pnpm@10.34.9 lint` 通过                                                                                                                                                   |
| 完整 Vitest      | `corepack pnpm@10.34.9 test`：583 文件 / 2229 测试通过，101.90 秒；仍为两条上游 vi.unmock 警告                                                                                      |
| 生产构建与浏览器 | `python3 scripts/network-acceptance.py --build --chromium <existing-chromium> --nginx <isolated-nginx>`：构建及 enabled/disabled/legacy/chinese 四配置 237 项检查通过，无 pageerror |
| 浏览器/代理      | Python `3.13.5`、现有 Python Playwright `1.61.0`、Chromium `149.0.7827.55` headless、nginx `1.26.3`；工具不加入项目依赖                                                             |
| UI 证据          | 桌面 1440×900、1200×700；移动 390×844 触屏模拟；短视口 320×240；真实中键/Ctrl-click、右键事件/Shift、焦点/滚轮、剪贴板权限、storage、跨页搜索及菜单视口测量                         |
| 缓存正对照       | 真实 nginx HTTPS 共享缓存：公开 fixture MISS→HIT；不设 Cookie bypass，登录首页/API/Next 数据反复预热后，匿名及退出客户端仍受限                                                      |

验收入口新增为可分发的 `scripts/network-acceptance.py`，不再依赖之前仅在 config 下存在的私有基线脚本。源 commit 为 `808af4fa` 加本轮未提交工作树；report 记录 dirty 标志、工具版本、源码 SHA256、每项检查和未证明范围，不将 dirty 工作树称为该 commit 的原样产物。

用户明确授权仅在 `config/p5-baseline/tools/` 下载/解包缺失动态库、字体及代理工具；未运行 sudo、系统包安装或修改 nginx-ui/系统服务。已有 Playwright/Chromium 缓存不等于最初就能运行：初始缺少动态库；中文截图最初缺少 CJK 字体，已隔离补齐后复验。

脚本以虚构配置启动仅 loopback 的 standalone、Widget/监控 fixture 后端与临时 HTTPS 缓存代理；真实用户 config 不被读取。随机密码/认证密钥仅传入子进程环境和运行内存，脚本不导出 Cookie、storageState 或 trace；浏览器临时 profile 由 Playwright 在关闭时清理，测试 TLS key 在 finally 删除，实例和代理均停止。

调试发现的是工具环境/测试脚本问题而非业务回归：nginx 默认临时路径须改到隔离目录；原生中键的后台标签页使用 context 观测和真实 loopback 目标；剪贴板拒绝权限须指定正确 context 并拒绝两种写入权限；搜索测试须等待上游 200ms 清理/300ms 关闭动画；storage 注入限当前 origin，避免 about:blank 自身报错。没有删除失败断言、关闭原有测试或用 jsdom 顶替。

初次完整构建/浏览器 evidence 为 `config/p5-baseline/run-20261105T110042Z-d248c5/`（Git/Docker 已忽略），237 项全部通过，report 的 harness SHA256 对应当时脚本；含报告、构建/服务/代理日志及桌面/移动/短视口/中文截图。汇总副本与源码校验和位于 `config/p5-baseline/evidence/`。原始命令输出为 `/tmp/homepage-p5-{install,lint,test,browser,docs,format}.log`。

续办完整构建及四配置加普通 HTTP 共 **245 项检查通过**（原 237 项 + HTTP 8 项），无 pageerror；证据为 `config/p5-baseline/run-20261105T120153Z-34cf78/`，汇总副本/最新源码校验和在 `config/p5-baseline/evidence/continued/`，不覆盖初次归档。执行 `--build --insecure-http`；report 的 `insecure_http_executed` 为 true，harness SHA256 与当前脚本匹配。frozen install、Lint 和全量 583 文件 / 2229 测试再次通过，Vitest 98.22 秒，仍只有两条上游 vi.unmock 警告；续办日志为 `/tmp/homepage-p5-{install,lint,test,browser,docs,format}-continued.log`。

普通 HTTP 使用 `http://p5-fixture.test:3308`，只通过 Chromium 的单次 host-resolver 规则映射到 loopback，不修改系统 DNS/hosts；没有把 localhost 的可信上下文当普通 HTTP。浏览器实际确认 `isSecureContext === false` 且 Clipboard API 不存在，原生密码登录成功后仍为该非安全 origin；复制给出失败提示、没有成功状态或跳转，后续模式切换仍可用，Host 拒绝仍生效。此临时虚构配置不是生产 HTTP 部署建议，也不是关闭浏览器安全策略或注入 API 缺失。

人工记录模板新增于 `docs/more/network-acceptance.md`，模板默认全部“未执行”，实际结果单独由操作者反馈，不直接把模板勾成通过。用户随后使用独立内网临时实例，在 macOS 电脑的 Chrome `155.0.8059.85`、Edge `154.0.4258.37`（均正式版 arm64）确认 1～8 项基础桌面测试正常；含登录/模式导航、刷新恢复、临时默认打开不改模式、Cmd 点击、标题自定义/Shift 原生/旧服务原生菜单、上下键/Escape、缩窄菜单及 HTTP 复制失败反馈。详细原始反馈在被忽略的 `config/p5-manual/` 对应 session 的 `manual-feedback.md`；不记录真实地址或凭据到 Git。手工中键因当前设备无该按钮而未执行，macOS 具体版本/viewport 未提供；完整键盘焦点、Widget统计、物理触屏和适用目标环境仍未覆盖。续办核查确认 SPEC/DEVELOPMENT 的归档后变更仅为 P5 表格格式，保留该格式，不回滚用户编辑。

手机实际反馈补充：两机基础选择器/导航/菜单触屏与布局检查正常，但华为浏览器（鸿蒙6）新标签打开、红米小米浏览器 `v20.28.1020918` 及两手机 QQ 报告原页打开；用户通过标签数量不变确认真实替换，而非新标签自动切前台。更多按钮本身不跳转，直接标题与菜单地址都有现象；现配置和 live Chromium 探针均为 `_blank`，未在真实小米/QQ 中确定根因。用户已选择暂停；没有创建纯 HTML 对照页、重启/续期或修改业务代码，不将该兼容差异标通过。完整物理场景仍未验收完成。

初次主动诊断检查 8 个交付文件：Python 脚本 clean；6 份 Markdown 无语言服务答复（inconclusive），不算 LSP 通过；mkdocs.yml 的 3 条 unresolved-tag 均是上游既有的 `!!python/name` / `!ENV` 自定义标签，已核对未变并标记 false-positive，不改配置、不加 ignore、不称 YAML LSP clean。受控 SafeLoader 子类只将这些标签当惰性标量，验证 mkdocs 唯一结构变化为新文档导航项。Python py_compile、新指南 Prettier、Markdown 结构/链接、YAML/JSON 示例、依赖不变和 git diff --check 通过。未安装/运行 Zensical 文档站构建，静态文档检查不等于文档站构建。

续办最终主动诊断覆盖 9 个交付文件：mkdocs 仍为 3 条已核对未变的上游自定义 tag 提示；7 份 Markdown 无语言服务答复，Python 最终重复探测为 push-only/silent-on-clean，因此 8 个文件为 inconclusive，本次批次不计 clean。Python 在修改后、运行前的独立主动探测曾确认 clean，且测试报告 SHA256 匹配同一脚本；不能用最后一次空诊断声称重新确认 clean。py_compile、7 份 Markdown 结构/链接、YAML/JSON 示例、两个新文档 Prettier 与 git diff --check 均通过；Zensical 仍未运行。

续办最终检查确认 3307/3308/3310/3443 无临时监听器，测试 TLS 目录已删除；真实用户配置/凭据未导出，无 git 提交/推送。

边界：trusted Shift/contextmenu 未被取消不证明系统菜单界面；触屏模拟不是物理手机；Linux Ctrl 不是 macOS Cmd；HTTPS 上的 Clipboard 缺失注入与续办普通 HTTP 真实缺失是两条独立证据；本地 nginx 不是目标 CDN，密码登录不是实际 OIDC IdP。这些待办及 SPEC 的手工门禁保留，不宣称完整 v1 完成。

验收：继续遵守 SPEC 完成定义，功能、自动化、人工验收和部署分别记录。

### P6：专用 CI/CD 与上游集成

- [x] 本地实现自有 PR 测试工作流，精确 Node/pnpm、frozen lockfile、Lint/完整测试/隔离生产构建；只读权限，29 项策略/脚本测试通过，详见 10.2。
- [x] 功能分支已推送 12116208；本 Fork Draft PR #1 和真实 Fork CI run 42205861009 已创建/运行，全部步骤 success，见 10.2。
- [x] 核对最新 head 8e633e62 的真实 CI 后，已按新授权绑定 `Fork verification` / github-actions App 15368、strict=true；完整/独立接口读回正确，其余保护逐项不变。
- [x] 用户已授权隔离失败负例：临时 PR #2 非 Draft、Git 无冲突，同 App/名称的必需 CI 真实 failure 后 GitHub 报告 blocked；已关闭 PR/删除临时分支，未合并或调用合并 API。
- [ ] 检查完全缺失、分支过期等其他门禁场景未独立演练；不把本次失败检查的结果扩大为全部场景，补充测试需另行确定范围。
- [x] 实现只读上游 main 预检（35 项新测试），不改 refs/index/worktree/FETCH_HEAD；已在 main 单次手动实跑成功，见 9.1/9.4，不算写入正例。
- [x] 本地实现保留祖先的同步提交、Draft PR/Issue 幂等和精确 head CI 分派/核验，默认关闭，见 9.2。
- [x] 独立基础 Draft PR #3 已创建且真实 CI 通过；两项必要设置已按明确授权写入/回读，默认 token read 和 main 保护不变，见 9.3。
- [x] 基础 PR #3 已按单独授权以 merge commit 合入 main，新 main push CI 和一次手动只读预检成功，见 9.4。
- [ ] 真实更新的同步 PR/CI 写入、workflow-file 权限和定时实际触发仍待验证；up-to-date 只读结果不算同步端到端完成。
- [x] main 已保留历史同步到功能分支，c89b6a93 的 run42484449672/check128743161401 精确 head/App/全部步骤成功，见 9.5；不是合并 PR #1。
- [x] P6-R01：本地实现 Docker Hub 发布基础、独立 Fork Dockerfile/context、main 控制器/标签通知、双架构构建/结构冒烟策略、66 项新测试与操作文档；真实外部执行未完成，见 10.3～10.5。
- [x] P6-R02前半：发布基础独立提交/推送89f0a542，Draft PR #4与其精确head真实CI通过，见10.6，不提前合并导航。
- [ ] P6-R02后半：另行授权PR #4 Ready/保留历史合入main，并核对新main CI；本轮未合并。
- [ ] P6-R03～R04：main 实际无 Docker Hub 凭据的双架构构建及临时容器 HTTP/认证/挂载验收。
- [ ] P6-R05～R07：所有者配置 Docker Hub/Environment/Secrets/不可变策略，再单独启用发布、真实推送与独立拉取验收；替代原 GHCR 目标。
- [ ] 实际演练上游合并和镜像回滚，不直接部署生产。
- [ ] 可选配置 Gitea 单向备份，另行授权后执行。

验收：测试和发布确实运行，不能仅以 YAML 文件存在作为完成证据。

## 6. 测试命令与目录约束

环境已有可用且版本一致的 pnpm 后，从根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build
```

聚焦新测试（目录创建后才运行）：

```bash
pnpm exec vitest run src/utils/network src/utils/contexts/network.test.jsx src/components/network
```

聚焦接入点和认证回归：

```bash
pnpm exec vitest run src/components/services/item.test.jsx src/components/quicklaunch.test.jsx
pnpm exec vitest run src/utils/config src/__tests__/pages/index.test.jsx src/__tests__/pages/_app.test.jsx
pnpm exec vitest run src/utils/auth.test.js src/proxy.test.js src/__tests__/pages/api/auth-boundary.test.js
```

注意：

- 新测试默认是 Node 环境；React 组件测试按现有文件使用 `// @vitest-environment jsdom`。
- 普通模块/组件测试可同目录放置；`src/pages/` 下不要放测试，放在 `src/__tests__/pages/`，避免 Next 将测试当路由。
- alias 已有 `utils`、`components`、`test-utils`，不要只为新文件引入别名重构。
- 手工测试、LSP/静态检查、单元测试各自作用不同，任一为空都不是“全通过”。
- 如果测试失败或未跑，记录具体命令、错误摘要和环境；不能写“全部通过”。
- 覆盖率可用 `pnpm test:coverage`，但不要为凑数字写无意义断言。
- 项目依赖仍没有 Playwright。P5 可选脚本复用本机已有 Python Playwright，调用方式见 6.2；其他环境若需安装/下载，先评估并授权，不隐式安装、不默认纳入 CI/P6。

### 6.1 浏览器验收脚本

使用不含真实密码的受控测试实例，记录提交 SHA：

1. 纯旧配置登录：首页布局/书签/搜索/Widget 正常，无模式按钮。
2. 启用示例配置：default、lan、vpn、office 分别点击图标、标题和搜索结果。
3. 为某服务移除 vpn：vpn 模式应回退默认；右键不能显示虚假的 VPN 地址项。
4. 保存 lan，刷新页面：恢复前无误点击路径，恢复后为 lan；禁用 storage 后仍可切换。
5. 同 origin 第二标签页同步；另一浏览器保持独立。
6. 普通左键、中键、Ctrl/Cmd 点击、Shift+右键、右键菜单和更多按钮分别测试。
7. 菜单位于页面边缘，页面滚动、窗口缩放、Escape、Tab、方向键和焦点恢复。
8. 没有 Widget 的头部、窄屏和触屏模式，入口仍可用且不遮盖搜索。
9. 检查 Widget 网络请求/监控目标在各模式下不变。
10. 未登录访问首页及服务/书签接口、页面数据入口；退出后重新访问，均不能获取导航数据。
11. 验证反向代理/CDN 不把登录用户响应共享给匿名客户端。
12. Clipboard 允许、拒绝、非安全 HTTP 场景反馈准确。

不要为了测试把真实导航配置、Token 或 Session Cookie贴到 issue、日志截图或文档。

### 6.2 可选真实浏览器与 HTTPS 缓存自动化

前置：Python 3.13、Python Playwright（本次 `1.61.0`）、已能启动的 Chromium、nginx 与 openssl。脚本不自动下载工具、不读取部署凭据、不操作系统 nginx/nginx-ui。没有这些工具时应报告未运行，而不是悄悄安装。仓库的 `pyproject.toml` 仍只声明原有文档依赖。

```bash
python3 scripts/network-acceptance.py --build --insecure-http \
  --chromium /absolute/path/to/chrome \
  --nginx /absolute/path/to/nginx
```

本次隔离解包的环境还需为单次命令提供 `LD_LIBRARY_PATH="$PWD/config/p5-baseline/tools/root/usr/lib/x86_64-linux-gnu"` 和 `FONTCONFIG_FILE="$PWD/config/p5-baseline/tools/fonts.conf"`；不要将这些路径写入全局 shell 配置。其他系统应使用自己经授权准备的运行库/字体，不照抄 Debian 包名当成通用安装方式。

- 默认跑四配置；`--insecure-http` 额外验证非安全 HTTP origin 的 8 项检查，并在 report 记录是否执行。`--phases enabled` 可聚焦调试；省略 `--build` 仅复用已有 standalone 产物，报告标记未构建，**不能用它证明改动后的源码通过生产构建**。
- 需要空闲的 loopback 3307（应用）、3310（虚构后端）、3443（HTTPS nginx）端口；使用 `--insecure-http` 时还需 3308（HTTP nginx）；发现占用停止，不杀其他服务。需要能访问本机 localhost，正常退出/异常会清理本轮实例。
- 每轮在 Git/Docker 忽略的 `config/p5-baseline/run-.../` 创建虚构 YAML、报告、日志和截图；TLS key 使用临时子目录并删除。脚本不生成可部署配置，不采集真实 Session，不创建公开导航 API。
- 代理启用真实共享缓存且保留上游缓存头语义；必须先证明公开 fixture 可 HIT，再验证受保护响应始终不可共享。不要添加强制忽略 Cache-Control/Set-Cookie 的规则，也不要用全部请求 bypass 冒充缓存验收。
- API 缺失/网络 key 存储抛错是有标记的故障注入；权限拒绝使用真实 Chromium context 权限；移动使用浏览器触屏模拟。详细边界在 report 的 `not_proven` 和 SPEC 的 P5 证据分层中。
- **不替代 6.1 人工验收**：记录操作者的浏览器/OS、设备、viewport、配置、结果与必要截图。目标 OIDC/生产缓存测试必须另行获得环境授权；不自动发布或部署。

### 6.3 剩余人工与目标环境验收

使用[人工验收记录模板](docs/more/network-acceptance.md)，记录真实浏览器版本、OS、物理设备、配置代号和实际结果；保持未执行/失败项，不把无头事件当原生系统菜单、触屏模拟当物理手机、Linux Ctrl 当 macOS Cmd。

P5 剩余门禁需要操作者的实际设备及获准的目标认证/缓存环境，不是后台任务仍在运行。此限制不阻止用户随后明确授权的独立 P6 基础开发；不得据此代签人工结果、放宽 SPEC、恢复临时实例或暴露环境，也不自动提交/推送/发布/部署。

## 7. 开发配置与原生登录

配置默认位于本地 `config/`，也可通过 `HOMEPAGE_CONFIG_DIR` 指定。首次运行会按上游机制复制 skeleton 文件，因此需要可写目录；纯构建/测试应避免依赖用户真实 config。

密码登录最少需要：

```text
HOMEPAGE_AUTH_ENABLED=true
HOMEPAGE_AUTH_SECRET=<至少32字符的随机密钥>
HOMEPAGE_AUTH_PASSWORD=<独立强密码>
HOMEPAGE_EXTERNAL_URL=https://home.example.com
HOMEPAGE_ALLOWED_HOSTS=home.example.com
```

密钥可由 `openssl rand -base64 32` 在部署端生成，不提交生成结果。

本地 HTTP 测试可以使用上游允许的可信 LAN/localhost URL，但生产 TLS 与 canonical URL 必须正确，否则 Cookie/OIDC 回调可能异常。不要用 `HOMEPAGE_ALLOWED_HOSTS=*` 作为解决所有问题的默认做法。

安全存放：

- `/config` 已被 `.gitignore` 忽略，仍需检查 `git status` 和是否曾被跟踪。
- `.env*.local` 被忽略；普通 `.env` 未在当前 Git ignore 中统一忽略，别把密钥写入后误提交。
- Git 忽略不等于 Docker 忽略。原 .dockerignore 仍保留上游；新 Fork 发布通过 Git 对象白名单导出干净 context，再应用 Dockerfile.fork.dockerignore，不复制私有 config、环境文件、.git、宿主 node_modules/.next 或测试文件，拒绝允许路径中的符号链接。不能用原 Dockerfile/工作树 context 替代该入口。
- 不把真实配置混进 `src/skeleton`、`public`、测试快照或镜像示例。

## 8. 上游 main 手工集成流程

流程说明，按实际日期/上游 SHA 给集成分支命名：

```bash
git status --short --branch
git switch main
git fetch origin
git merge --ff-only origin/main
git fetch upstream main
git switch -c sync/upstream-main-YYYYMMDD
git merge --no-ff upstream/main
```

- 工作区不干净或 `--ff-only` 失败时停止，先查明本地与远程分叉，不自动 reset。
- merge 有冲突时，只处理能理解的冲突；认证、依赖升级、配置链路冲突必须认真复核。
- 运行完整测试、构建和规约关键场景，再在授权后推送该分支并创建 PR。
- PR 记录旧/新上游 SHA、冲突文件、二开接入点变化、测试证据、是否有破坏性变化。
- 上游集成 PR 使用 merge commit 合入，避免 squash 丢失上游提交祖先导致反复合并同一历史。
- 合并成功只是 Git 层面成功，不等于语义兼容，不自动更新生产容器。
- 如果决定放弃本次未完成 merge，先查看状态并确认，再使用 `git merge --abort`；不自动丢弃用户原有改动。

更新后检查 `DESIGN.md` 的快照、代码地图和本手册命令，只有必要的事实更新才修改文档，不把历史基线悄悄伪装成最新事实。

## 9. 上游同步（本地实现，远程待授权验证）

### 9.1 只读预检的初次实现与验证（历史）

新增 `.github/workflows/fork-upstream-sync.yml`，当前阶段**仅预检**：每周一 UTC 04:17 或手动触发，只匹配本 Fork main，checkout 事件的精确 SHA/完整历史，固定 Node 24.22.1。只有 contents: read，不传自定义 Secrets、不保留 Git 凭据，不具备 PR/Issue/镜像写权限。此文件现按用户随后授权随代码提交/推送功能分支，结果以 Git log/远程为准；仍未合入 main，不能据本地 YAML 宣称预检的调度/手动入口已远程验证。

独立 stdlib 脚本 `scripts/fork-upstream-preflight.mjs`：

- CLI 只接受可信 main 的 schedule/workflow_dispatch 上下文，核对 workspace、HEAD/事件 SHA、Fork origin；不接受 PR/ref 输入或任意远程地址。
- 明确查询官方 HTTPS `refs/heads/main`，不采用官方默认 dev；只抓观察到 SHA 的 Git 对象，`--no-tags --no-write-fetch-head --no-recurse-submodules --refmap= --no-auto-maintenance`，没有目标 refspec，不移动 refs，也不启动自动维护。
- `git merge-tree --write-tree` 只计算对象，不 checkout、写 index/worktree、建分支或提交。可能新增本地 Git 对象，因此“只读”指不改 refs/工作区且无远程写入，不是整个 .git 字节不变。clean-merge 只代表 Git 层面无冲突，不证明认证/字段/行为语义兼容，仍需后续 CI 与人工复核。
- up-to-date/clean-merge 正常结束；conflict/unrelated-histories 非零结束。冲突只报告路径、不提供可发布候选树；其他错误用固定错误码，不回显 Git stderr 或环境。GitHub job summary 可见结果；此只读工作流不自动建 Issue，写入流程见 9.2。
- `candidate_tree_sha` **是树对象，不是提交**，不能拿去创建 refs 或当成 CI source SHA。完整阶段仍须构造保留 main/upstream 父祖先的真实 merge commit，并核对 PR head/CI 关联。
- Git 子进程使用隔离环境、禁用全局/系统配置、凭据助手、hooks、fsmonitor 和 HTTP 重定向；拒绝本地自定义驱动/过滤器/include/HTTP/凭据/URL 重写等配置。不安装依赖或执行上游脚本，不读取用户 YAML。

复现聚焦测试：

```bash
corepack pnpm@10.34.9 exec vitest run src/__tests__/workflows/fork-upstream-preflight.test.js
```

本地 Git 2.47.3 验证：35 项新测试（含真实 Git 合成分叉、冲突、无共同历史、dirty 文件、对象 fetch、hooks/驱动/URL 重写及入口/退出码），加既有 CI 策略共 2 文件/64 项通过。frozen install、Lint、完整 585 文件/2293 测试和隔离生产构建通过，保留两条已有 vi.unmock 警告；修改前 584 文件/2258 测试基线通过。3 个新 YAML/JS 文件主动诊断 confirmed clean，3 份 Markdown 为 inconclusive；新文件 Prettier、node --check 和 git diff --check 通过。依赖/锁文件和业务代码未改。

本轮实际只读访问官方 main：观察到 2e5f10134ae3961bb936d3e7c441f9a1f4a4bf4f，与 Fork main 相同，结果 up-to-date；HEAD/全部 refs/index/worktree/FETCH_HEAD 前后核对不变。合并与冲突另有真实 Git fixture 证据，不冒充实际发现了上游更新或生成了集成 PR。报告/日志在忽略的 `config/p6-sync/evidence/`。本轮没有新工具下载或预检的远程实跑。代码现按用户随后授权仅提交/推送当前功能分支，结果以 Git log/远程为准，新 head 的 PR CI 需重新核实；不改设置、不合并主 PR、不发布/部署或恢复 P5。

历史预检时外部前置未满足：当时只读核查 `can_approve_pull_request_reviews=false`，main 也无 fork-ci.yml 默认入口；当前两项设置已按新授权完成、基础 Draft PR 待合并，见 9.3。未来写入阶段需要用户决定是否授权调整 Actions 设置（或另配受限 App），先解决可信 CI 的默认分支入口，不能静默开启、使用现有个人凭据塞入工作流或认为 GITHUB_TOKEN 建 PR 会自动触发 CI。

### 9.2 同步 PR 与精确 head CI（本地实现，尚未启用）

新增 `.github/workflows/fork-upstream-integrate.yml` 和 `scripts/fork-upstream-integrate.mjs`，只使用 Node stdlib。**开发阶段仅本地实现和隔离测试；用户随后明确授权将八个交付文件提交/推送当前功能分支，实际结果以 Git log/远程引用为准，新 head CI 需重新核实。未创建真实同步 PR、改设置或执行同步工作流 dispatch。** 只读预检依然单独存在，不提升其权限。

触发与权限：

- 本 Fork main 的手动触发须明确选择 `create_pr=true`（默认 false）；每周一 UTC 04:47 的定时写入须仓库变量 `FORK_UPSTREAM_SYNC_ENABLED=true`，缺省不运行。每仓库固定 concurrency、不取消前次任务；本轮没有设置该变量。
- 默认 contents: read；仅 integration job 拥有 contents/pull-requests/issues/actions write，分别用于分支、Draft PR、诊断 Issue/意图评论和 CI dispatch。不授予 packages/id-token/admin，不执行审批、合并、删除或发布。
- 仅支持内置 GITHUB_TOKEN，token 只传给可信 main 脚本；不沿用本机个人凭据、不新增自定义 Secrets。**不能直接换成 PAT/App**：普通事件触发及机器人身份边界会改变，须单独重审和测试。

实现与失败策略：

1. 验证可信 workflow_ref/main/精确事件 SHA、workspace/HEAD/origin 和 API 的固定 public Fork 身份、默认分支及实时 main。上游固定官方 HTTPS main，先做原对象级预检，不切换工作区或执行合并树中的任何脚本。
2. 无更新返回 up-to-date；冲突/无共同祖先停止，创建或复用固定上游 SHA 的机器人诊断 Issue（含源 SHA、受控错误码、截断冲突路径和 run 链接）。通知接口失败明确 unconfirmed，不冒充邮件送达或人工已读。
3. clean-merge 构造真实 commit-tree 提交，父提交依次为 Fork main 和官方 main，不把 tree SHA 当 commit。仅非 force push 到固定 Fork 的 `sync/upstream-main-<完整上游SHA>`；Git 子进程 token 仅在临时、固定 URL 范围的 header 环境中，不落 config/参数/日志；HTTP 不跟随重定向。
4. 分支/PR 采用保守不可变策略：同 SHA 的已知父提交/树可复用；人工修改、main 过期、未知树/父提交、移除标记或重复 PR 则失败并请人工处理，不自动刷新或覆盖代码。关闭未合并的 PR 视为拒绝，不重开；有其他上游 PR 待审时不再开第二个。Git 非 force push 保留竞争中的分叉历史，推送后再次核查 ref。
5. 创建 Draft PR，保留人工正文/状态，不启用 auto-merge；分页最多扫描 1000 条，不确定是否重复则停止。API 写入未知响应不盲重试，下一可信运行按实际 ref/PR/评论恢复。
6. 发布前校验 main 的 fork-ci.yml 文本 SHA256 等于脚本的 CI_DIGEST，候选中该文件完全不变，且 API 默认入口 active。**修改 CI 定义须在同一受审 PR 显式更新此 pin 及测试**，不能自动信任新权限/Secrets/工作流。
7. 内置 token 推送/建 PR 不保证触发普通 CI，因此显式 workflow_dispatch 到同步分支。机器人评论先持久化该 head 的 dispatch 意图；遇到已有意图但无可见 run，或未知 dispatch 响应时，需人工检查，不自动重发。若确认无 run，操作者可手动将 fork-ci.yml dispatch 到该同步分支，再重跑同步核验；不要为消除红灯盲删标记、强推或重开 PR。
8. 观察最多 25 分钟，核查 workflow/path/event/分支/repo/head、run 的 job、job 的固定 Fork check_run_url、check id/name/App 15368/head、所有结论及安装/Lint/测试/构建步骤。失败/跳过/缺失/排队超时不算成功，不自动 rerun 失败 CI。轮询和结束时重查 main/ref/PR；最终证据关联真实 PR head，不是 caller main 或 tree。

复现本地测试（不需要 GitHub token，不产生远程写入）：

```bash
corepack pnpm@10.34.9 exec vitest run src/__tests__/workflows
```

新增同步测试 56 项（模拟 API、真实隔离 Git 双父提交/祖先/工作区不变与 bare 非 force 推送），另补 1 项 checkout origin 回归：既有真实 CI 日志的 remote add origin 不带 .git；现仅接受固定 Fork 有/无后缀两种 HTTPS 地址，未放宽协议、主机或仓库。原预检的隔离参数/环境仅抽成共用导出，仍无远程写权限。

最终 frozen install、Lint、工作流 3 文件/121 项、完整 Vitest 586 文件/2350 项（111.03 秒）、隔离生产构建、两个脚本 node --check 和 git diff --check 通过；仍有两条既有 vi.unmock 警告。8 文件主动诊断：4 confirmed clean、4 inconclusive（3 Markdown 无答复、1 push-only/silent-on-clean），不能用空结果代签全 clean。基线首次 2 条、首次修改后 1 条既有 auth-boundary 测试发生 5000ms 导入超时；原命令无改动复跑均通过，未删除/放宽认证测试、超时或并发配置。保留失败与复跑日志，不把超时隐去。证据在 Git/Docker 忽略的 `config/p6-integrate/evidence/`；依赖/锁文件、业务和 SPEC 导航合同不变。

**远程待授权/待证据：** 功能分支 27139eba 和独立基础 c64db269 的真实 CI 均已核实；两项外部设置已按后续授权完成，见 9.3。默认 main 入口和一次手动只读预检已按后续授权验证，见 9.4；仍不能擅自合并主 PR #1 或跳过 P5 决策。真实写入 job/PR/dispatch 和 Fork 定时/闲置限制未实证。随后获授权手动执行，有真实上游更新时验证 PR/CI/通知；无更新的 no-op 不算完整正例。还需核实内置 token 对包含工作流文件变更的 Git 推送限制；不能由 contents: write 推断具备全部 workflow-file 写入能力。若被拒绝，当前逻辑失败并留诊断，不剔除上游变更或偷偷换 PAT/App；须人工集成或另行设计受限身份/事件方案。只有实跑核实后才另行决定启用定时变量。镜像发布、回滚和生产部署仍是后续独立阶段。

### 9.3 独立基础 PR 与外部设置实证（历史准备；后续合并见 9.4）

用户明确选择独立基础 PR 并授权新分支提交/推送/创建 Draft PR，以及仅开启 Actions 创建/审批 PR 和仓库 Issues；不合并、不启用定时、不发布/部署或恢复 P5。为避免提前合入导航功能，在仓库内忽略的 config/p6-bootstrap/worktree 从 main@2e5f1013 建立 chore/fork-automation-bootstrap，提取 feature@27139eba 中 18 个已验证自动化文件，新增自包含 FORK_AUTOMATION.md。

提交 c64db2699d7c9b26bbd359b7c08b8c5653587bbe 的唯一父为 main@2e5f1013，不含 feature 祖先。非 force 推送后创建 [Draft PR #3](https://github.com/kanon-H/homepage/pull/3)，仅 19 个自动化/说明文件，无导航、认证、Widget、依赖/锁文件或 Docker 改动；原 feature@27139eba 和主 PR #1 保持不变。

- 基线：纯 main 的 frozen/offline install、Lint、573 文件/1902 测试、隔离构建通过。基线构建只在内存重定位可信构建脚本的 cd，保证构建纯 main，而非原功能树；前后工作树干净。
- 补丁：frozen/offline install、Lint、3 文件/121 工作流测试、576 文件/2023 完整测试、隔离生产构建、JS/YAML Prettier、Node/Bash 语法、diff 检查通过，保留两条既有 vi.unmock 警告。原功能分支的 2350 项计数不能移用于此分支。
- 10 个交付文件主动诊断 9 confirmed clean、1 Markdown inconclusive。Prettier 无 Shell parser 的初次工具报错保留在 static.log，Shell 以 bash -n 检查通过；不是删除源码、弱化断言或忽略真实错误。未安装新工具，未重跑浏览器/部署。
- [Fork CI run 42385579913](https://github.com/kanon-H/homepage/actions/runs/42385579913) 第一次 completed/success；job/check 128442134396 的 name=Fork verification、App 15368、head=c64db269 与全部步骤核实。实际 PR 测试快照 83b939067b8229d50f8d33a09fa74356e6b20c9b 的树等于基础 head 的树，不能称已合入 main。只核对了元数据/步骤，不以本地计数冒充下载过的 runner 日志。
- 设置仅两项：can_approve_pull_request_reviews=true、has_issues=true，默认 token 仍 read；完整 main 保护、其他仓库/合并策略、main 和原 PR #1 前后逐项相同。定时 opt-in 变量不存在且未创建，没有同步 dispatch 或其他生产操作。

证据均在 Git/Docker 忽略的 config/p6-bootstrap/evidence/：remote-preconditions、baseline-build、extraction、verification、precommit、settings/、bootstrap-pr、bootstrap-ci-verification、completion 等。CI 观察首次 GET 网络失败仅只读重查；没有重复写设置、建 PR 或 rerun CI，凭据不落盘。独立工作树干净；原工作树三份交接此前仅本地更新，用户随后单独授权将 agent.md / DESIGN.md / DEVELOPMENT.md 提交/推送当前 feature 分支，实际结果以 Git log/远程为准，新 head CI 必须另行核查；不改业务、设置、main 或基础分支。

下一步需单独授权基础 PR #3 标记 Ready 后以 merge commit 合入 main，不 squash/force；再分别确认手动预检、真实上游更新 PR/CI 和 workflow-file 权限边界。没有真实更新的 no-op 不算写入正例；定时 opt-in 仍未启用。基础 PR 合入后原功能分支需要另行 merge main 并重跑 CI，即使文件相同也不能沿用旧祖先/检查。P5/主 PR #1、镜像发布和回滚仍独立待办。

### 9.4 main 入口及只读预检的真实执行（已完成本轮授权）

用户明确授权仅将 PR #3/c64db269 标记 Ready 后以 merge commit 合入 main，不 squash/rebase、不删除源分支、不改保护、不动 PR #1；main 自动 CI 通过后仅手动执行一次 fork-upstream-sync.yml，失败即停，不自动重跑。已披露合并会带入每周只读预检配置，未授权写入控制器、写入定时或部署。

合并提交 **57acb02c54660114de4aeadd2473c16e90454f4c** 的父依次为旧 main 2e5f1013 和基础 c64db269，树 12bdba3a121815817cacf01386f02d76d3a0a3b0 与已审 head 相同；19 个交付文件的 SHA256 逐项匹配，没有混入导航、认证、Widget、依赖/锁文件或 Docker 变更。PR #3 已 closed/merged，源分支保留；默认 main 现有可信入口。

- 新 main 的 [push CI run 42452955655](https://github.com/kanon-H/homepage/actions/runs/42452955655) 第一次 completed/success，check 128645880913 的 name=Fork verification、App 15368、head=57acb02c 及所有步骤成功。未沿用 PR 快照；观察器网络 RemoteDisconnected 仅恢复 GET 观察，没有 CI rerun。
- 仅 dispatch 一次 [只读预检 run 42454077403](https://github.com/kanon-H/homepage/actions/runs/42454077403)，精确 main SHA=57acb02c、attempt=1、job 128649254892 及全部步骤成功。先持久化 intent，HTTP204 后不重发；只调用 fork-upstream-sync.yml，不调用写入控制器。
- 下载真实 job 日志（跨域签名跳转不带 Authorization、不保存签名 URL），解析得到官方 refs/heads/main=2e5f1013、mode=read-only-preflight、outcome=up-to-date、candidate_tree_sha=null、conflicts=[]。日志显示 GITHUB_TOKEN Contents/Metadata read。该结果只证明本次只读上下文与上游查询成功，不证明写入权限或整个 .git 字节不变。
- 两项已批准设置仍开启、默认 token 仍 read，完整 main 保护/其他仓库策略未变。写入 opt-in 变量不存在、写入控制器 run=0、同步 ref=0；无真实更新 PR/CI、冲突 Issue、workflow-file 权限或每周实际定时触发证明。每周只读 cron 随合并具备调度配置，不能称已实测调度；写入定时仍关闭。
- 仅 fetch 更新本地 origin/main，使用 --no-write-fetch-head，不切换/移动本地 main 或 merge 到功能分支。原 feature/远程 head 仍 6f9d53c3、PR #1 open/draft/未合并；Git 祖先核实其缺少当前 main 的 2 个提交，需另行授权 merge main 并重跑 CI，不以旧绿色代签新基线。

证据在 Git/Docker 忽略的 config/p6-main-entry/evidence/，包含 Ready/merge 请求与实际读回、父提交/树、main CI、唯一 dispatch intent、真实 readonly-job.log/JSON 报告及 completion。本轮本地没有修改业务、重装依赖或下载新工具；runner 仍按已审工作流正常安装/测试/构建。没有发布镜像、部署或恢复 P5。三份交接此前仅本地更新，用户随后单独授权仅将其提交/推送当前 feature 分支，实际结果以 Git log/远程为准，新 head CI 须重新核实；不包含同步 main、合并 PR #1 或写入控制器授权。main 中 FORK_AUTOMATION.md 是基础准备阶段的说明，当前合并状态以本节和 GitHub 为准，不为更新历史自述越权再写 main。

三份交接的提交/推送已获本轮单独授权；功能分支同步 main 仍须另行确认。当前官方无更新，不能篡改上游来源或制造更新来凑写入正例；后续写入演练、定时 opt-in、P5/主 PR #1、镜像发布与回滚分别处理。

### 9.5 功能分支同步 main（本轮授权与本地实证）

上轮三份交接提交/推送为 aba75941c9daddf57c6888d82630fe3faa3dc7da，其真实 CI run 42464356595/check 128680299573 第一次成功，App 15368、精确 head 和全部步骤已核实。用户随后结构化明确授权：将 main57acb02c merge 到 feature/multi-address，更新必要交接、保留双父提交，frozen 安装/Lint/完整测试/构建通过后非 force 推送并核查新 CI；不合并 PR #1、不运行写入同步或部署。

只读预演树为 a2853c2d77dfd766502b5aad51a95865e1a9d9ba，无冲突、内容仅新增 FORK_AUTOMATION.md；HEAD/refs/index/worktree/FETCH_HEAD 前后不变，可能新增 Git 对象。实际本地先 --no-ff --no-commit 合并，核对暂存树完全一致，再创建纯 merge 提交 **d34ccc1b62b1dd2d98646309fc2d0683b7bfea16**，父顺序精确为 aba75941、57acb02c。该提交已包含当前 main，不再缺少其两个祖先；没有重写历史、切换/移动本地 main 或改变任何业务、认证、Widget、依赖/锁文件、Docker 和工作流定义。

在真实 d34ccc1b 提交上执行并首次全部通过：

```bash
COREPACK_ENABLE_AUTO_PIN=0 corepack pnpm@10.34.9 install --frozen-lockfile --offline
corepack pnpm@10.34.9 lint
corepack pnpm@10.34.9 exec vitest run src/__tests__/workflows
corepack pnpm@10.34.9 test
PATH="$PWD/config/p6-baseline/bin:$PATH" RUNNER_TEMP="$PWD/config/p6-feature-sync" \
  bash scripts/fork-ci-build.sh
node --check scripts/fork-upstream-preflight.mjs
node --check scripts/fork-upstream-integrate.mjs
bash -n scripts/fork-ci-build.sh
git diff --check
```

结果为 3 文件/121 项工作流测试、586 文件/2350 项完整测试及实际生产构建通过；两条既有 vi.unmock 警告保留。未改测试/断言/超时/并发，没有恢复 P5 实例或重跑设备验收。重复出现的空索引锁逐次核实 UID/inode/mtime 稳定、无 Git 进程和 lsof 占用后清理，不改索引数据；首个锁超过一小时，后续重现另存证据，不能据此断言根因已解决。证据留在 Git/Docker 忽略的 config/p6-feature-sync/evidence/，含 before、preview、stale-lock、merge-commit、install/lint/focused/test/build 日志。

必要交接另建纯文档提交，FORK_AUTOMATION.md 只加基础 PR 历史上下文；提交前检查 Markdown 结构/链接、实际 diff/源码字节和 CI pin，不把 Markdown 无语言服务答复当 clean。最终推送 head 与新 Fork verification 的精确 head/App 15368、PR 测试快照、全部步骤和结果以 Git/GitHub 及本轮 CI 证据为准；不能继续套用 aba75941 或原 main 的绿色结果。

PR #1 保持 Draft/未合并/无 auto-merge，main57acb02c 与基础 c64db269 不因本轮推送而移动，不修改保护/仓库设置。只读预检、写入控制器和定时均不另行 dispatch/启用，不发布或部署。真实上游更新写入、workflow-file 权限、实际定时触发、P5、镜像发布与回滚仍独立待办，下一步另行授权；无更新 no-op 不算写入正例。

## 10. 自有 CI 与镜像发布（Docker Hub 流水线本地实现，真实执行待验）

### 10.1 已发现的上游适配点

- `docker-publish.yml` 的 build job 限定 `github.repository == 'gethomepage/homepage'`。
- Docker PR 触发分支当前是 `dev`，不能假定 Fork main PR 会走这条构建。
- `test.yml` 上报 Codecov 使用 Secret，且上传错误会导致失败；Fork 未配置服务时需要明确选择保留、条件执行或独立测试工作流。
- 已逐一检查 11 份继承工作流：Docker/Docs 已有限定官方仓库的 job 条件，其余 9 份在本地补齐该条件；保留上游逻辑而不在 Fork 执行其 Codecov、翻译、关闭 PR/Issue 等自动化。
- `Dockerfile` 的 `CI=true` 分支跳过安装和构建，要求上下文已有有效 `.next/standalone` 和 `.next/static`。
- 原 Dockerfile 的 Apache-2.0 label 与根 GPLv3 不一致，本轮保留上游文件；Fork 专用 Dockerfile.fork 使用 GPL-3.0-only 并复制 LICENSE，明确隔离发布入口，不能选错旧 Dockerfile。

### 10.2 工作流拆分与 CI 基础实证

| 文件与状态                                   | 触发                          | 职责                                                  |
| -------------------------------------------- | ----------------------------- | ----------------------------------------------------- |
| `fork-ci.yml`（PR 验证通过）                 | main 的 PR / main push / 手动 | frozen install、Lint、Vitest、生产构建；无发布权限    |
| `fork-upstream-sync.yml`（只读预检本地实现） | schedule / 手动               | 只计算更新/合并树/冲突；始终无远程写入权限            |
| `fork-upstream-integrate.yml`（本地实现）    | 显式确认手动 / opt-in 定时    | 双父提交、Draft PR/Issue、精确 head CI；远程未启用    |
| `fork-release.yml`（本地实现）               | 仅可信 main 手动，默认不发布  | 精确源码再验证、双架构 OCI、独立 Docker Hub publisher |
| `fork-release-tag.yml`（本地实现）           | 自有 fork-vX.Y.Z tag push     | 不接触注册表凭据，只通知 main 控制器一次              |

`fork-ci.yml` 仅匹配 kanon-H/homepage，运行 Ubuntu 24.04 / Node 24.22.1 / pnpm 10.34.9；单 Job `Fork verification`，contents: read，无自定义 Secrets、Codecov、缓存、产物上传、镜像登录。checkout 使用 github.sha、禁用凭据持久化，安装后核对 HEAD 与工具版本。没有路径过滤/continue-on-error；并发取消仅限同类事件与同一 PR/ref。已从真实 check_run 读取检查名 `Fork verification`、github-actions App ID 15368；本轮核对最新 head 后已绑定 main 必需检查且 strict=true，并读回确认。绿色 CI、配置核验和失败检查的非 Draft PR blocked 状态均有实际证据；检查完全缺失等场景未独立演练。

`scripts/fork-ci-build.sh` 构建启用多地址扩展的虚构配置，临时目录成功/失败均清理，原生密码认证变量随机生成且只在进程环境；不访问用户 config，不开服务或浏览器。Next.js 会另外自动加载环境文件，因此检测到 .env / .env.local / .env.production / .env.production.local（含符号链接）时直接拒绝，不删除用户文件；本地应在无这些文件的干净 checkout 运行。脚本需要 Bash、Node、pnpm，CI 使用固定版本工具；本机用忽略目录里的 pnpm wrapper 调用既有 Corepack，不安装全局工具。

本地验证（源码基线 9b1eeeac 加本轮工作区）：

```bash
corepack pnpm@10.34.9 install --frozen-lockfile
corepack pnpm@10.34.9 lint
corepack pnpm@10.34.9 exec vitest run src/__tests__/workflows/fork-ci.test.js
corepack pnpm@10.34.9 test
bash -n scripts/fork-ci-build.sh
# 本机 shell 没有 pnpm，通过忽略目录内的固定版本 wrapper 提供命令：
PATH="$PWD/config/p6-baseline/bin:$PATH" RUNNER_TEMP="$PWD/config/p6-baseline" \
  bash scripts/fork-ci-build.sh
```

安装、Lint、29 项聚焦测试、584 文件/2258 项完整测试和实际生产构建通过；29 项中构建隔离用 mock pnpm，不冒充生产构建。仅两条已有 vi.unmock 警告，依赖/锁文件未变。修改前基线 Lint、583 文件/2229 项测试通过。日志在忽略的 config/p6-baseline/evidence/；wrapper 不是交付依赖，其他有固定版本 pnpm 的环境直接运行脚本。js-yaml 5.5 拒绝原 Crowdin paths flow-list 的缩进，本轮改为等价 block-list，未改变路径。提交前另核对了既有 YAML/Shell 格式化变化，并复跑聚焦策略/隔离测试和 Bash 语法检查；未将格式化后的文件误称为此前相同 SHA256 的产物，补充记录在本地证据目录。

2026-11-06 远程实证：用户授权执行下一步后，在 `kanon-H/homepage` 创建 [Draft PR #1](https://github.com/kanon-H/homepage/pull/1)，head=`1211620882e860bb64cc621ed3d7e62a984ad552`、base=本 Fork main；不是向官方提交。[Fork CI run 42205861009](https://github.com/kanon-H/homepage/actions/runs/42205861009) 第 1 次完成 success；全部步骤成功，job 日志明确为 584 文件/2258 项测试及生产编译成功。日志确认实际 checkout 的 PR 合并快照为 `01198d99b6bb75b81c2fbd3c6ff194aa59a28344`，不是实际合入 main。check_run 127852191491 的 name=`Fork verification`、app=`github-actions` / 15368，head_sha 正确关联 12116208。脱敏 API 快照/日志位于 Git/Docker 忽略的 `config/p6-remote/evidence/`，凭据只在内存，不转发给跨域日志下载地址。期间 GET 网络短暂失败后只读复查恢复，无重复建 PR、workflow 重跑或设置变更。

后续最新验证与绑定：三份首次 CI 交接已推送为 `8e633e620701f225e71ea5810a88b6ddb6310122`；[Fork CI run 42209452117](https://github.com/kanon-H/homepage/actions/runs/42209452117) 第 1 次 success，check_run 127864197191 的 name/app/head_sha 均匹配，所有 job 步骤成功。实际日志确认测试合并快照 `7101527c19b355a31795e3882e2f6c427474b4cd`、584 文件/2258 测试及生产构建成功，不是复用旧 12116208 绿色结果。

用户本轮授权“进行下一步工作”后，先确认最新 CI 成功，再为 main 配置 `required_status_checks={strict:true,checks:[{context:"Fork verification",app_id:15368}]}`。首次局部 PATCH 返回 404“Required status checks not enabled”，GET 完整比对确认无变更后，按已读取的原值完整保留 PUT 首次启用。之后 GET 完整保护和独立 required_status_checks 接口确认生效，除该字段外所有保护完全相同，仓库合并选项也未变。前后配置、请求策略和最新 CI 日志在忽略的 `config/p6-remote/evidence/main-gate/`。日志 GET 曾 TLS 握手超时，只读重试后成功，无 TLS 降级或重复设置写入。

后续隔离负例：用户在结构化确认中明确选择临时分支/PR、故意失败 CI、核实 blocked 后清理，并要求不推送现有本地提交。以已验证远程 8e633e62 为正例，只给 workflow 添加一个 checkout 前 exit 42 步骤，YAML 解析/结构比较确认其余内容等价；相对 8e633e62 只有一个文件、一个提交差异。临时 [PR #2](https://github.com/kanon-H/homepage/pull/2) head 为 `1ed37174f0eaf39004b657665ed552df06a98c70`，非 Draft、Git mergeable=true、未合并/无 auto-merge；[run 42214850900](https://github.com/kanon-H/homepage/actions/runs/42214850900) 及 check_run 127882191736 真实 failure，name=`Fork verification`、App=15368、head 匹配，GitHub mergeable_state 明确为 **blocked**。失败仅为预期步骤，注解 exit code 42；原 checkout/安装/Lint/测试/构建步骤均 skipped，不声称本次运行通过了应用测试。此结果不靠 Draft 状态，也没有调用合并 API 试探。

负例结束后 PR #2 已关闭未合并、临时分支已删除且 GET 确认不存在；完整保护和主分支/功能分支/主 PR 前后完全一致。状态、比较、job 步骤、退出码、blocked 和清理证据在忽略的 `config/p6-remote/evidence/gate-negative/`。**检查完全缺失、分支过期及其他绕过场景未独立测试**，不从单一失败案例推断全部场景。

负例结束时的远程快照：main 为 2e5f1013、远程 feature 为 8e633e62；主 PR #1 为 open/draft、merged=false、auto_merge=null。本轮没有修改保护/Secrets、合并主 PR、发布/部署或恢复 P5。首次 PR 的旧 Lint/Tests/Docs job 按官方条件 skipped，base/main 的 anti-slop、Auto Label PR success；这些工作流条件仍未合入 main，后续行为不扩大保证。P5 完整验收、同步及发布/回滚仍未完成。负例验证期间本地 2b18802f 未推送；用户随后另行授权提交代码到远程 Git，本轮仅提交三份交接并连同已有 2b18802f 推送当前功能分支，结果以 Git log/远程为准，新 head CI 需重新核实。

最新 c40d9eb6 的 [Fork CI run 42217278462](https://github.com/kanon-H/homepage/actions/runs/42217278462) 亦已只读核对 completed/success，check 127890320033 的 name/App/head 与全部步骤成功，不沿用旧 head。新增预检文件现获随后授权提交/推送功能分支，不能用 c40 的远程绿色结果代签新 head；本轮本地验证见 9.1。

静态检查边界（保留首次本地证据）：shell PATH 未发现 Docker/Podman/actionlint/zizmor；但主动诊断实际调用了托管 zizmor，不能据 PATH 推断全部工具不可用。新工作流、Shell 脚本和 JS 测试分别 confirmed clean；10 份 YAML 中 3 份 confirmed clean、7 份保留原触发器/checkout 的既有诊断：Crowdin/Lint/Tests 的 3 项 artipacked，PR Quality/PR Triage/Reaction Comments/Release Drafter 的 4 项 dangerous-triggers。本轮仅加官方仓库门禁，不改其上游行为；这些诊断记录为 defer（不是 false-positive，不写 suppress），不称继承工作流全 clean。3 份 Markdown 无语言服务答复，记 inconclusive。未下载工具、未取得独立 actionlint 命令证据；未做镜像构建、GHCR 拉取或回滚。静态/托管诊断不代替 GitHub runner 实跑。

### 10.3 Fork 构建路径（本轮选择源码内构建，不复用宿主产物）

用户本轮明确选择 Docker Hub，替代原 GHCR 优先计划。保留上游 Dockerfile/docker-publish.yml 和原 .dockerignore，独立新增 Dockerfile.fork/专用 ignore。Node24.22.1-alpine 的多平台 digest 已公开查询核实：sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53；builder/runner 同一 Alpine 基础，避免 Debian 构建的原生模块直接搬到 musl。pnpm 固定10.34.9、frozen install，从虚构配置构建，不带生产环境变量。

fork-image-context.mjs 从已提交的精确 Git 对象白名单导出 context，不依赖用户工作树或复制真实 config/.env/.git/.next/node_modules；禁止允许路径中的符号链接，二进制字节原样保留，再应用专用 Docker ignore。导出发生在应用依赖安装之前；context 不执行候选导出脚本以外的生产凭据任务。每架构在 Docker builder 自己安装/构建，不传上游 CI=true。实际 Docker/Skopeo/双架构运行尚未实证，不能由宿主应用构建推断成功。

### 10.4 Docker Hub 发布合同（本地实现，外部默认未启用）

- fork-release.yml 只在可信 main/workflow_dispatch 执行，默认 publish=false；空版本仅验证 main。发布须已存在的严格 fork-vX.Y.Z、main 祖先、版本发布基础与当前 main 相同、Repository variable DOCKERHUB_RELEASE_ENABLED=true 和首次 run。
- fork-release-tag.yml 只有 contents:read/actions:write，无 checkout/注册表 Secrets；自有版本标签首次 push 仅向 main 控制器 dispatch 一次，通知成功不是发布成功。不自动 retry/rerun POST，未知响应先查实际 runs；GitHub concurrency 不是可靠无限队列。
- 无 Docker Hub 凭据的 build job 重跑 frozen install/Lint/完整测试/隔离应用构建，导出 OCI archive 并核查两架构/标签和 QEMU Node 结构冒烟。不是应用 HTTP/认证、物理 ARM 或 P5 的完成证明。
- publisher 等待 dockerhub-release Environment（所有者须选择 Selected branches，仅一条 type=branch/name=main；建议 reviewer），规划和 copy 前均核验实际保护配置，只 checkout/运行可信 main stdlib 控制器，不重建、不安装应用依赖或执行 artifact 脚本。同一 build job 的精确 artifact ID、archive SHA256 和源码/标签/GPL 元信息逐项核对，推送前再读实时 main/tag。
- 仅在 publisher 的单一步骤读取 Environment Secrets DOCKERHUB_USERNAME/DOCKERHUB_TOKEN，Token 不发给 Agent；镜像名默认 username/homepage，组织仓库用 Repository variable DOCKERHUB_IMAGE。Token 不传 argv/子进程 env/具名磁盘配置，Linux tmpfs 先 unlink 再写入的 FD 供 Skopeo 读取，不可用则失败不降级。
- 仅生成版本和 sha-完整源码SHA 两个标签，拒绝已有 tag、认证/网络/未知状态；不生成 latest。Skopeo copy 不自动重试，可能部分发布，须人工读回并受控处理，不能盲重跑/删标签/覆盖。真正不可变需要 Docker Hub 服务端策略和写权限隔离，预检不是原子锁。
- 所有 job 默认只有 contents:read；plan/publisher 额外 actions:read，只读核实 Environment 恰好一条 main 分支规则，缺失/不符/无法读取则停止。只有 tag 通知 job 有 actions:write。不授予 packages:write、部署或合并权限。固定完整 Action SHA，不共享 PR 缓存或上传工作树/私有配置，只上传 OCI 和非秘密 release.json。暂未启用 SBOM/provenance/签名，不宣称位级可复现或完整供应链认证。
- digest/源码/上游基线/版本/构建时间均记录；最终须独立客户端验证公有匿名或私有目标身份的拉取/运行，不凭 push 成功推断可用。根 GPLv3、GPL-3.0-only label/镜像内 LICENSE 与完整公开源码 revision 保持一致。

完整操作、所有者设置与失败/回滚说明见 [Docker Hub 发布指南](docs/more/fork-release.md)；外部未完成事项逐项列在第 13 节。

### 10.5 发布基础初次本地实施与验证记录（历史；当前交付见10.6）

开发基线 feature/multi-address@c89b6a93（已包含 main57acb02c），原工作区干净；修改前 frozen/offline install、Lint、586 文件/2350 项完整测试、隔离应用生产构建通过。本轮不改业务/认证/Widget、package.json/锁文件、原 Dockerfile/发布工作流或既有 fork-ci.yml 及其固定 digest；新交付只在本地，未提交/推送/创建标签/真实 dispatch/发布/部署。

66 项新测试覆盖输入与 main 信任、真实隔离 Git 标签/祖先/基础文件、允许的提交对象 context/二进制/符号链接拒绝、OCI 元信息、模拟 registry 的错误/不可覆盖/未知写入不重试、两架构结构冒烟调用和真实 tmpfs FD/子进程凭据隔离。最终 frozen/offline install、Lint、4 文件/187 项工作流测试、587 文件/2416 项完整测试、隔离应用生产构建、四份 Node 语法与既有 Bash 语法检查均通过；全量首次通过，耗时115.07秒，仅两条既有 vi.unmock 警告，未改认证测试/断言/超时/并发。初次一条新测试误将合法 fixture/team 作为非法镜像名，改成 fixture//team 后原断言通过，失败证据保留；首次尾空白检查发现文档末尾额外空行，已修正再检，不当作应用失败或隐瞒。全部日志与校验和在 config/p6-release/evidence/，不把旧 c89 远程 CI 当本轮新代码的绿灯。

主动探测13个交付路径：首批5份JS/测试与2份YAML共7 confirmed clean；最终重复及逐文件探测为6 confirmed clean，fork-image-publish.mjs 因语言服务 push-only/silent-on-clean 为1 inconclusive（不是错误，也不能计clean）。Dockerfile.fork及专用ignore无语言服务，为2 unsupported；4份Markdown无语言服务答复，为inconclusive。最终共6 confirmed clean、2 unsupported、5 inconclusive，不称全部静态clean；publisher 另有Node语法/Lint/全量测试证据，文档单独做结构/本地链接检查。规划及 copy 前还会只读核实 Environment 确为仅一条 main 分支规则，动作权限仅为此补充 actions:read；发布/通知写入均无自动重试。

复现本轮命令（仍不构建实际镜像）：

```bash
COREPACK_ENABLE_AUTO_PIN=0 corepack pnpm@10.34.9 install --frozen-lockfile --offline
corepack pnpm@10.34.9 lint
corepack pnpm@10.34.9 exec vitest run src/__tests__/workflows
corepack pnpm@10.34.9 test
PATH="$PWD/config/p6-baseline/bin:$PATH" RUNNER_TEMP="$PWD/config/p6-release" \
  bash scripts/fork-ci-build.sh
node --check scripts/fork-release.mjs
node --check scripts/fork-image-context.mjs
node --check scripts/fork-image-publish.mjs
node --check scripts/fork-image-smoke.mjs
bash -n scripts/fork-ci-build.sh
git diff --check
```

shell PATH 未发现 Docker/Podman/独立 actionlint，不由此推断托管诊断工具不可用（本轮两YAML主动检查确已clean）；不安装新系统工具、不运行任何实际容器或 Hub 写入。Dockerfile 无配置语言服务，不能称已静态/真实构建通过。现有 CLI/模拟测试不证明 Skopeo/OCI/Hub 真正行为，本轮未创建或启用 Environment/Secrets/opt-in，实际外部状态以后续获授权读回为准。P5 暂停，PR #1 保持 Draft。真实 runner build-only、HTTP/认证/挂载、首次推送/独立拉取/回滚分别作为后续门禁，不勾选已完成。

### 10.6 独立发布基础 PR 与原 feature 保存（本轮实证）

用户结构化明确授权两个范围：独立main基础分支验证后提交/非force推送/建Fork main的Draft PR并核CI；原feature13项另行提交/推送并核新CI。保留DEVELOPMENT的自动格式化，不提交其他文件，不合并/Ready任何PR，不dispatch、改设置/Secrets/opt-in、发布部署或恢复P5。

在 config/p6-release-bootstrap/worktree 从 main57acb02c 新建 chore/fork-dockerhub-release-bootstrap；先验证纯main的frozen/offline install、Lint、576文件/2023测试及隔离应用构建，再复制10个发布文件。基础补丁为577文件/2089测试、4文件/187工作流测试及安装/Lint/构建/Node语法/Prettier/diff通过，保留2条既有警告。10个交付路径主动诊断7 confirmed clean、2 Docker unsupported、1 Markdown inconclusive；未跑实际Docker/Hub，不能借用功能分支2416计数。

基础提交 **89f0a54238fee80cdf843bde416459e9f1b3c8da** 唯一父为main57acb02c、树bb64c8f512f9872fe0f118e3a9e28996f5b0ed62，只有10个新文件/1471行，无feature祖先、导航/认证/Widget/依赖/锁文件/原Docker与CI定义改动。非force推送后仅POST一次创建 [Draft PR #4](https://github.com/kanon-H/homepage/pull/4)，目标是本Fork main，不是官方。指南只更新交付状态表述，10项payload在基础与原feature中逐项同hash。

[真实CI run42552833352](https://github.com/kanon-H/homepage/actions/runs/42552833352) attempt1 completed/success；check128951971443的name=Fork verification、App15368、head=89f0a542及所有步骤逐项核实。PR测试快照32fc6ea2ca620db2d585f8b432d7421e77c0e46b的树等于基础head，不是已合入main。观察器网络中断仅恢复GET，无dispatch/rerun；main完整保护/其他设置及默认token read未变。这里核查元数据/步骤/树，不将本地2089计数冒充下载过的runner日志。

原feature本次保存前为c89b6a93，用户已单独授权保存/推送原13项（10发布文件和3交接），本轮补充交接仍在该范围，保留格式化，不stash/丢弃或改业务。实际保存head、最终新CI/App/PR测试快照与步骤，按Git/GitHub及 config/p6-release-bootstrap/evidence/feature-* 核实；不沿用基础PR4或c89旧绿色。main仍57acb02c，PR #1和#4保持Draft/未合并，无auto-merge。

证据在Git/Docker忽略的 config/p6-release-bootstrap/evidence/：源快照/manifest、main基线与补丁完整日志、foundation-commit/push/PR、唯一请求意图、CI原始run/job/check与verification。R02尚缺人工Ready/merge/main CI，随后R03需另行授权可信main的publish=false真镜像build-only；Env/Hub/发布/拉取/回滚仍分开确认，不自动进入。

## 11. 回滚

发布记录至少包含：Fork 版本、源码 SHA、上游基线、镜像 digest、配置快照版本、测试摘要。

回滚步骤：

1. 保留当前日志和配置备份，确认旧镜像与当前配置兼容。
2. 部署回上一个验证过的 digest，不通过强推 main 或重写版本标签“回滚”。
3. 必要时将 `extensions.network.enabled` 设为 false，验证纯上游导航恢复。
4. 保留原始 href，关闭扩展后仍有默认导航路径。
5. 认证与密钥继续启用，不因为回滚网络功能而关闭登录。
6. 修复通过新提交、新标签发布，不能篡改旧镜像来源。

当前没有数据库，无数据库迁移。未来引入 SQLite 时需另补一致性备份、schema 迁移兼容和回滚合同。

## 12. 交接记录模板

每次阶段结束，在 PR/任务记录或 `agent.md` 中准确记录，不依赖会话记忆：

```text
当前分支 / commit：
本次完成的阶段与规约条目：
变更文件：
实际运行的命令及结果：
未运行的检查及原因：
已知问题 / 上游已有失败：
配置或设计是否变更：
下一步最小任务：
是否提交 / 推送 / 发布 / 部署：
```

不得把规划步骤打勾为已完成，不得将“未运行”写成“通过”，不得自动提交推送或操作生产服务。

## 13. 当前后续工作追踪（固定 ID，不依赖会话记忆）

本表优先于上方历史阶段的“下一步”描述。状态只对该行交付范围有效；本地实现不等于外部启用或生产发布。完成一行需记录 commit/PR/run/镜像 digest 等可复核证据；遇阻写明所缺环境/所有者动作，不删除未完成项。关联操作指南：[Docker Hub 发布与回滚](docs/more/fork-release.md)。

| ID      | 当前状态                                 | 依赖 / 下一步                                                                                                           | 完成所需证据                                                                        |
| ------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| P6-R01  | 原基础已交付；F03增量本地验证完成        | 第五份HTTP工具/40项新增测试/原生103项检查；待明确保存与独立PR #4更新授权，见15节                                        | 完整2456测试/命令/范围/哈希；增量未提交，不替代Docker或新head CI                    |
| P6-R02  | Draft PR #4/CI通过；待人工合并           | 已从main独立提交/推送10文件；保持Draft，Ready/merge须另授权，不提前合并导航                                             | #4/head89f0a542/run42552833352已核实；main尚未合入，后续另核其CI                    |
| P6-R03  | 待 R02/main 入口及运行授权               | main 的 publish=false、空版本，无 Docker Hub 凭据真实构建；本机无 Docker/Podman                                         | 双平台 OCI、白名单 context、两平台结构冒烟、archive SHA/run                         |
| P6-R04  | 工具本地实现；真实容器待main/运行授权    | 最新F03接入无Hub凭据build job，双平台/双挂载的HTTP/原生密码/Host/PID1/健康为必经步骤，不操作生产                        | 同归档真实容器结果/平台/源码/digest；native103项和模拟Docker不能代签                |
| P6-R05  | 待所有者配置                             | 目标 Hub 仓库/可见性/不可变规则、Git 标签保护、main-only Environment/reviewer 和最小权限 Secrets；不把 Token 发给 Agent | 脱敏设置读回/生效验证，R03/R04 后才明确启用 DOCKERHUB_RELEASE_ENABLED               |
| P6-R06  | 待 R03～R05 和真实发布授权               | 新 fork-vX.Y.Z 标签或 main 显式 publish；通知成功不等于发布成功                                                         | main release run、两个标签/index digest、源码/上游/版本/created、release.json       |
| P6-R07  | 待 R06/独立客户端授权                    | public 匿名或 private 目标身份独立拉取，验证两平台临时运行                                                              | 实际 pull/运行、权限/平台/digest；长期非秘密发布记录                                |
| P6-R08  | 待首个已验收镜像及演练授权               | 验证未知响应/部分发布处置与旧 digest 回滚，优先非生产                                                                   | 原/新 digest 与配置兼容、真实回滚结果；不强推或改旧 tag                             |
| P6-R09  | 后续单独评估                             | SBOM/provenance/签名、原生 ARM、apt/Skopeo 更严格复现                                                                   | 各自实际报告；当前不得声称已具备                                                    |
| P6-C01  | 补充门禁负例待单独授权                   | 检查完全缺失、过期 main 等隔离场景，保留保护与原 PR，不合并负例                                                         | 真实 head/App/blocked 状态、清理和原保护不变证据                                    |
| P6-S01  | 实现已在 main；真实写入未验              | 获准后检查真实官方 main 更新，执行同步 PR/CI/Issue/幂等与 workflow-file 权限演练                                        | 真正新上游双父 PR、分支/dispatch/check/head/App、失败通知与权限证据；no-op 不算正例 |
| P6-S02  | 只读定时已配置未实证；写入 opt-in 未启用 | 只读 schedule 实际触发核查；写入仅在 S01 实证后另行决定                                                                 | 实际 schedule run/来源/结果与明确的启用授权，不由 YAML 推断                         |
| P5-N01  | 手机兼容延期（唯一排期例外）             | 仅实际手机浏览器导航/触屏布局兼容延期；已知差异保留，不记通过；不阻塞本次正式版                                         | SPEC 剩余场景的真实反馈/版本/平台与结果，不自动代签                                 |
| P5-N02  | 非手机验收待完成                         | 桌面中键/原生交互、完整键盘焦点/Widget统计、多标签页及适用OIDC/目标缓存；需设备/环境与运行授权                          | 实际版本/配置/目标范围和结果；不从手机延期扩大豁免                                  |
| P6-R10  | 最终多地址候选待冻结/复验                | PR #1按原路线合入main后核精确CI，再对正式发布run的同一OCI归档执行双架构及HTTP/安全门禁                                  | 源码含导航、main/版本/归档SHA/digest、同run完整验证；基础镜像不能代签               |
| PR-N02  | PR #1 Draft/未合并                       | 先按原路线合#4并同步最新main到feature，完成非手机集成前验收/新CI；再单独授权Ready/merge#1，禁止直接合#1的更快路线       | 审核记录、最新 CI、明确 Ready/merge 授权；保留 merge 历史                           |
| OPS-L01 | 重复空索引锁根因未定位；上轮已安全清理   | 若复现先只读核实 inode/UID/mtime/Git 进程/lsof；不盲删活动锁、不重建索引                                                | 原因证据与逐次安全处置记录；本轮不为此改 Git 配置                                   |
| DOC-D01 | 文档站实际构建未运行                     | 后续按需加入发布指南站点导航并运行 Zensical；不隐式安装工具                                                             | 文档站构建结果，不能由 Markdown 结构检查代签                                        |
| OPT-G01 | 可选，未开始                             | 用户确需时再授权 Gitea 单向备份；不是当前阻塞                                                                           | 单向备份/恢复实证，无生产凭据进 Git                                                 |

正式版执行顺序以第14节为准：先独立基础PR #4与基础验证，再完成非手机P5/其它必需验收、同步最新main并审查PR #1，最终main多地址候选重做同归档镜像门禁，之后才启用正式推送并完成独立拉取/回滚验收。基础镜像不含导航，绝不能作为本次正式交付；不采用直接合PR #1的预览捷径。S01/S02/C01等未完工作须如实补齐或明确记录外部阻塞/待用户决定，不能自动当通过；R09及Gitea仍保留原后续增强/可选属性。

## 14. 正式多地址镜像的后续执行与放行表（最新用户决定）

### 14.1 已确认方向与当前基线

- 用户要求完成其它必需工作后发布**正式版**Docker Hub多地址导航镜像，不走预览/试用版更快路线；唯一允许延期的是P5实际手机兼容验收，见SPEC12.1。手机同页/新标签及触屏布局差异继续记“延期/未完成”，不是修复或通过。
- 非手机P5不再被笼统记作“整阶段暂停”。它们进入待完成规划，实际运行仍需要合适设备/目标环境和明确授权；本轮并未恢复任何实例或执行验收。
- 本次规划提交前feature为937322028c87ec1ea3023182ec7589a2adf878aa，其真实CI run42555188788/check128959208179、App15368、精确head与全部步骤成功；本地2416测试通过。发布基础89f0a542、Draft PR #4及真实CI已验证，main仍57acb02c，PR #1仍Draft且导航未入main。此处是基线，不是下一次提交/最终镜像的证据。
- 本轮仅获详细记录与当前feature文档提交/非force推送授权；PR Ready/merge、同步main、运行Actions、改设置/Secrets/opt-in、创建版本标签、Hub推送及本地/生产部署仍分别确认。
- 暂不开发Skill、不替换已有Actions同步实现。代码实现已在main不等于真实上游写入/权限/调度验收完成；Git无冲突/CI绿不保证所有二开语义自动保留。

### 14.2 必须按证据推进的阶段

| 阶段                 | 后续工作 / 顺序                                                                                                                             | 放行证据与禁止误判                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 发布基础入main   | 单独授权审查PR #4，Ready后以merge commit合入main；保留源分支，不动PR #1或保护设置                                                           | 唯一已审head/10文件/父祖先；新main精确CI/App/全部步骤，不能用PR4旧绿替代                                                                                                  |
| F02 基础真实构建     | F01后单独授权一次main fork-release.yml，publish=false、版本留空；失败先定位不自动rerun                                                      | 真实Docker/Buildx/QEMU/Skopeo双架构OCI、允许context与结构冒烟；不登录Hub，不称已有多地址镜像                                                                              |
| F03 补足容器验证工具 | 最新本地已增加HTTP/原生密码/Host/配置挂载/PUID/健康工具并接入build job，见15节；受审进入可信main后仍须真实双架构实跑                        | 新脚本/回归测试/受审提交、新CI及云端真实结果；模拟工具调用不等于容器启动。任何新增发布基础须按可信main规则重新受审                                                        |
| F04 非手机P5         | 在获准临时环境补桌面中键/原生右键Shift/Ctrl-Cmd、完整Tab/Shift-Tab/方向键/Home-End/Escape/焦点恢复、Widget/统计区隔离、多标签页与降级       | 浏览器/OS/鼠标能力/viewport/配置代号与逐项结果；已有macOS8项和Chromium245项只覆盖已记录部分，无中键设备不自动算通过                                                       |
| F05 适用目标安全     | 核实本次实际使用密码或OIDC、canonical URL、Host、代理/CDN；按适用部署验匿名/错误密码/登录/退出、首页/API/Next数据、私有缓存与MISS→HIT正对照 | 真实目标及授权、认证和缓存证据；未使用OIDC/CDN须用户确认适用范围并记录理由，不能自行N/A；不关闭认证/Host来排障                                                            |
| F06 补齐既有验收     | C01门禁负例、S01真实上游PR/权限/CI/通知/幂等、S02实际调度等按13节逐项核实                                                                   | 缺真实上游更新、权限或调度证据时记录未完成/阻塞，no-op或模拟不能代签；本轮不自动豁免或启用写入定时，需另定范围时先问用户                                                  |
| F07 同步与审查导航   | 保留当前工作后将F01及其后最新main merge到feature，不rebase/force；逐项核二开、发布关键文件与指南冲突，完整安装/Lint/测试/构建               | 新feature祖先/差异、最新head CI/手工证据；PR1旧937绿色不能代签，不能直接合PR1绕开原顺序                                                                                   |
| F08 导航进入main     | 非手机集成前门禁完成后，单独授权PR #1 Ready/保留历史merge；验main新head及完整CI，保留手机延期说明                                           | 实际main源码含模式/菜单/搜索/偏好，状态/父祖先/精确CI可追溯，不把基础PR4镜像当导航交付                                                                                    |
| F09 最终镜像再验证   | 对F08最终main的正式候选重做双架构构建、平台清单/标签/GPL/无秘密层和实际HTTP/安全/挂载检查                                                   | 正式发布run中即将推送的**同一OCI归档**通过全部镜像门禁，记录source/main/upstream/version/created/archive SHA/index digest；早期基础或另一轮build-only的不同digest不能替代 |
| F10 设置与回退准备   | 所有者建立目标Hub仓库、不可变规则、Git标签保护、main-only Environment/reviewer、最小权限Environment Secrets；隔离演练回退                   | 脱敏保护读回/实际生效、版本兼容与旧可信digest可用；Token不进聊天/Git/镜像。首次没有旧正式版时用受控基础/原版镜像与候选做非生产回退，不虚构已验旧版                        |
| F11 正式推送         | 预发布门禁全部完成后，用户确认正式fork-vX.Y.Z版本和精确main源，单独授权opt-in/标签或main显式publish                                         | 版本通知只是请求；验证主run、两个版本/SHA标签、同archive copy及digest读回。未知响应/部分成功先只读调查，不重试覆盖或删标签                                                |
| F12 交付验收         | 实际推送后独立客户端匿名或目标身份拉取，检查两平台并临时运行；核旧digest仍可拉取、回退记录和源码许可                                        | Push成功不等于正式交付成功；完成pull/运行/回退与长期记录后才能宣布验收。不得自动重启NAS或生产容器                                                                         |

F03/F04/F05可在安全前提下并行准备，但F08前必须完成其适用的集成前验收；F09必须绑定最终源码和正式发布run的实际归档。工作流每次构建的version/created可能不同，不能把旧build-only归档视为后一次正式归档。新改动影响相关门禁时重做对应验证，不沿用旧head绿灯。

### 14.3 测试与发布记录的最小字段

每项记录：固定任务ID、适用/不适用及用户确认、源码/main/上游SHA、PR/run/check/App、环境/平台/工具版本、配置代号、命令、期望/实际结果、失败或阻塞、证据位置、下一授权。镜像额外记录archive SHA256、index/platform digest、两个标签与读回结果。真实URL配置、密码、Session、Token与私钥不写入Git、PR、截图或Actions artifacts。

发布说明必须包含手机兼容延期/已知浏览器差异，不得写全平台验证完成。正式版本号由用户确认，示例fork-v0.1.0不等于已经选定/创建或已发布；严格使用现有fork-vX.Y.Z格式，不靠preview标签、latest或任意分支绕过门禁。

### 14.4 未完成、阻塞与可选事项如何处理

- “其它工作完成”按所有仍开放的必需门禁逐项给证据，不以整体CI成功替代人工/容器/目标环境结果。缺设备/目标授权就保持未完成；缺真实上游更新或实际调度就记外部阻塞，不能伪造更新、默默豁免或承诺已经完成。若用户要独立排期，先形成新的明确决定再更新表。
- 本次仅手机兼容有明确延期许可；不把它扩大成整个P5延期，也不降低安全门禁。手机验证以后恢复时保留既有问题与原始反馈，不用jsdom/模拟触屏代签。
- SBOM/provenance/签名、进一步位级复现和原生ARM设备扩展仍属原已标明的后续增强；Gitea仍为可选单向备份，Skill暂不开发。未完成如实记录，不宣称已具备，也不自行把可选工作变成无限发布阻塞。
- F11是有副作用的发布动作，F12含发布后交付验收；推送前完成所有可先做门禁，推送后只核实真实注册表结果。回退前先保护配置和日志，不强推main、不改旧标签、不关闭认证。
- F03允许先做安全的本地准备；最新本地增量保存/推送和独立基础更新尚待明确授权，其后仍是**单独授权F01**。之后每次获准只执行所选范围；失败停止、报告，不自动扩大为部署或重复dispatch。

## 15. F03 本地验证工具增量（未提交；不代表真实容器已通过）

用户决定继续当前Pi/模型环境尽快开发；本地开发阶段未获Git/PR/Actions写入或发布授权，随后另行三项明确授权见15.4。起点feature/multi-address@8822dba60a34cf6179077117ac3fdd5dbce99f3a；原DEVELOPMENT表格格式化已保存preimage并保留。本轮不改业务/生产认证、依赖/锁文件、Dockerfile、CI必需检查定义/pin、main/保护/Secrets或手机合同。

### 15.1 实现与隔离

- 新增stdlib scripts/fork-image-http.mjs：固定loopback直接HTTP，无代理/自动跳转；Cookie与随机测试密码/Secret只在内存，通过Docker stdin提供合成运行环境，不写真实配置、argv或artifacts。每架构分别验证root+/app/config与10001:10002+/config，使用唯一标记的临时命名卷，不挂宿主生产目录或Docker socket；应用bridge、仅loopback发布端口，不宣称断网沙箱。
- 原生CSRF/密码错误与成功、Session/退出、首页/服务/书签/Widget/Next数据私有缓存及暖读后的独立匿名隔离、Host失败和服务SSR/API一致性；健康来自实际Docker State.Health，PID1四项UID/GID来自/proc/1/status，卷原始文件/读写权限在HTTP前后验证。不会手工清空Cookie伪装退出成功，也不以docker exec自身UID冒充服务进程UID。
- scripts/fork-image-smoke.mjs将上述检查置于每架构结构检查后，验证前后归档SHA一致；失败不上传，publisher继续只copy同一归档。新helper加入RELEASE_FILES；所有新工具须与可信main一致并受审，不能靠旧tag或环境跳过验证。临时容器/卷按唯一label和精确名称清理，含create响应不确定情况，不prune共享资源。
- 新增40项发布/HTTP回归，其中真实loopback的合成HTTP服务只证明客户端/断言逻辑；模拟Docker/VM执行实际生成的检查代码以覆盖身份、挂载、退出、超时及清理，绝不称Docker验收。实际Homepage验证另见15.2。

### 15.2 验证证据与失败处理

证据统一在被Git/Docker忽略的config/p6-image-http/evidence；日志不含真实URL/密码/Cookie/Token。

- 改动前默认完整测试587文件/2416项通过（baseline-focused.log，命令中多余的`--`未过滤文件，按真实全量结果记录）。frozen/offline安装成功、锁文件未改；全量Lint及隔离虚构配置生产构建通过，最终日志以本目录记录为准。
- 新代码工作流227项；最终默认完整测试588文件/2456项通过，见feature-test-route-setup.log。没有改测试超时/并发或省略原测试；两条既有嵌套vi.unmock警告仍保留。独立发布基础（578文件）同版本测试为2129项通过，见foundation-test-route-setup.log。
- 原生新生产构建standalone实际执行103项HTTP检查：匿名/错误密码/登录/退出、Host、私有缓存、SSR/API/Next数据。随机loopback端口与虚构配置，结束停止精确子进程并删除临时配置；见native-http-recheck.log。未恢复旧P5人工实例、未启动对外部署，不能代签Docker/QEMU、OIDC、HTTPS/CDN或物理浏览器。
- 初次native检查失败SMOKE_UNSAFE_AUTH_REDIRECT：真实Next数据307使用x-nextjs-redirect而非Location，已补协议支持；两个头若同时存在均需同源登录目标，并新增恶意/冲突Next重定向负例，不放宽应用认证或Host。保留native-http.log/debug.log。
- 原全量回归test.log/test-final.log出现既有auth-boundary动态import超原5000ms。未改8822的Git对象隔离副本也复现同一失败（baseline-isolated-full.log），定向原58项通过。先把模块图准备移出请求断言，但在独立基础首次验证时发现“单个beforeAll并行加载全部路由”又超过默认10秒hook，28项被skip且测试整体失败（foundation-test.log）；该失败未被当成通过。最终改为每路由独立describe嵌套block，仅将自身真实handler的import放进该block的beforeAll，保持认证环境、原路由筛选、全部401/CSS/Host断言、默认hook/test超时和默认并发。功能与独立基础完整回归分别通过；不是删除认证测试、mock掉真实handler、吞failure或调大超时。
- 首次install/Lint/测试串行命令在300秒预算内停于Lint，后续测试当时未启动；保留lint.log和超时记录，不算通过。单独全量Lint随后成功，lint-recheck.log。文档站实际构建仍未运行；诊断不能由空缓存代签。

### 15.3 尚未完成与下一授权

- 本机没有Docker/Podman/Skopeo，所有真正Docker/QEMU/OCI、两平台挂载/权限和Hub结果仍未运行。原PR #4/head89f0a542不包含本轮F03增量，旧真实CI不能代签；本轮没有提交、推送、改PR/设置或dispatch。
- 只读ls-remote新核远程main=57acb02c、feature=8822dba6、发布基础=89f0a542；本地main引用实际仍为初始2e5f1013，origin/main缓存为57acb02c，未自动移动或checkout。后续集成以实时远程main为准，不把本地旧main当最新基线。
- 最终主动诊断11条路径：7 confirmed clean、4 inconclusive，不称全部clean；固定loopback canonical的硬编码URL建议已明确标为false-positive，不能为消警改成可任意外发凭据的环境URL。Node语法、Prettier、Markdown链接与diff检查结果另见本目录verification.json，文档站构建仍未运行。
- 本地F03增量与两项测试修复已完成；三项写入授权见15.4。下一步按顺序受限执行：提交/推送feature、将同一发布payload+测试/文档增量独立提交到发布分支并核PR #4精确新CI，范围/CI通过后方可Ready/merge，再核main CI，最后单次publish=false。任一步失败停止并报告，不自行扩大授权。
- 仅手机兼容继续延期。F04～F12、上游真实写入/实际调度、适用目标安全、Hub保护和独立拉取/回退继续逐项待办；不因本轮工具与native通过而宣布正式镜像交付。

### 15.4 本地验证后另获的三项明确授权

用户通过三个独立选项依次确认：(1)提交/非force推送本轮feature代码与文档，将发布增量独立更新PR #4并核新CI，保留Draft，不引入导航源码或feature祖先；(2)仅在新head完整CI及范围审查通过后，PR #4 Ready并以merge commit合main、保留源分支、核新main精确CI；(3)其后只dispatch一次main fork-release.yml、publish=false、version_tag空值，验证同一OCI归档两架构/容器，失败停止、不自动rerun。

此授权不涵盖PR #1 Ready/merge、保护/仓库设置、Secrets/发布opt-in、版本标签、Hub登录/推送或任何生产部署。若条件或源码改变、响应未知先只读核实，不盲重复写入。本轮精确提交、PR/check/App/父树与实际run分别保存config/p6-image-http/evidence；不能把获得授权记成已经成功执行。
