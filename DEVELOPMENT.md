# 二开实施、测试与上游维护手册

> 本文全部路径相对仓库根目录。新会话直接在本目录启动，无需父目录或其他项目。
> 当前状态：P1～P4 功能及 P5 自动化/使用文档已完成；真实 Chromium 自动化与本地 HTTPS/nginx 缓存检查通过。人工原生浏览器、物理设备及目标认证/缓存环境验收未完成，P6 未执行。已执行证据见第 5 节和 agent.md，未勾选项不是已完成。

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

## 3. 基础配置待办

这些动作尚未执行，配置远程/仓库设置前需明确操作范围。

### 3.1 添加官方 upstream

确认不存在同名 remote 后：

```bash
git remote add upstream https://github.com/gethomepage/homepage.git
git fetch upstream main
```

若 remote 已存在，先检查 URL，不盲目覆盖；`origin` 必须保留为用户 Fork。

### 3.2 GitHub 默认分支与保护

用户在 GitHub Fork 的设置里将默认分支设为 `main`。更改后本地可刷新：

```bash
git remote set-head origin -a
```

该命令只刷新本地引用，不会改变 GitHub 默认分支。不要将本地 `origin/HEAD` 的旧值误判成服务器当前设置，必要时联网重新核实。

建议保护 `main`：

- 通过 PR 合并，CI 为必需检查。
- 禁止强制推送和随意删除。
- 普通功能 PR 可以 squash；**上游集成 PR 必须保留上游提交祖先关系，使用 merge commit，不 squash。**
- 分支策略、可用规则和权限以 GitHub 实际账号能力为准。

### 3.3 工具版本

上游当前存在工具版本差异：

| 文件                                   | 已观察到的 pnpm 选择  |
| -------------------------------------- | --------------------- |
| `.github/workflows/test.yml`           | pnpm 9                |
| `.github/workflows/lint.yml`           | pnpm 10               |
| `.github/workflows/docker-publish.yml` | pnpm 10               |
| `Dockerfile` 非 CI 路径                | `pnpm@latest`         |
| `package.json`                         | 未声明 packageManager |

锁文件格式是 9.0，不代表必须用 pnpm 9。二开专用 CI 建议验证后统一到一个固定的 pnpm 10 补丁版本和 Node 24；版本在选型验证前不能写成“已经固定”。不要无故升级上游全部依赖或重写锁文件。

初始核查时只有 Node 和 corepack，没有 pnpm 和 node_modules。2026-11-05 的 P0 已验证 Node `v24.22.1` / Corepack `0.36.0` / pnpm `10.34.9`，后续开发使用 `corepack pnpm@10.34.9 <命令>`；当前未修改 package.json 或上游 CI，不能声称 CI 已统一版本。

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

P0 本地基线、P1～P4 功能、P5 自动化与文档已完成；P5 手工/目标环境验收、P0 外部仓库设置和 P6 仍未完成。阶段记录是当时的历史证据，后续浏览器与工具状态以 P5 记录为准。

### P0：建立可信开发基线

- [x] 核查分支/remote/工作区，确认用户允许的改动范围。
- [ ] 配置 upstream、确认 GitHub 默认 main；记录是否由用户完成。**本次未授权远程/GitHub 设置操作，保留为外部待办。**
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

本次没有真实浏览器可执行程序，未做浏览器渲染/交互、OIDC、HTTPS 或反向代理/CDN 验收；HTTP 响应头通过不等于反代缓存验收通过。P0 外部设置未完成，本地基线已建立，可在用户确认后进入 P1。

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

- [ ] 自有 PR 测试工作流，精确工具版本、frozen lockfile。
- [ ] 上游 main 定期集成 PR，保留历史、冲突停止并通知。
- [ ] 自有标签镜像发布，amd64/arm64、SHA 和版本追溯。
- [ ] 确认 GHCR 权限/可见性、可信触发、发布门禁。
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

当前本机自动化无失败，剩余门禁需要操作者的实际设备及获准的目标认证/缓存环境，不是后台任务仍在运行。未提供设备/环境或目标授权时，不自动进入 P6，不代签人工结果，不暴露临时实例到局域网/公网，也不提交/推送/部署。

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
- Docker build context 需单独核查，Git 忽略不等于 Docker 忽略。当前 `.dockerignore` 没有全面覆盖所有 `.env*.local`，正式构建前必须排除敏感文件。
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

## 9. 自动上游同步设计（计划）

建议新增 `.github/workflows/fork-upstream-sync.yml`，而不是大改上游全部工作流。

触发：低频 schedule（例如每周）和 `workflow_dispatch`。职责：

1. 显式以 Fork `main` 为起点，官方 `main` 为唯一上游源，完整获取所需历史。
2. 检测是否已有相同上游 SHA 的更新 PR，幂等处理，使用 concurrency 避免并发推同一分支。
3. 在独立临时分支尝试 merge，不能 force push Fork main。
4. 无更新则结束；冲突则任务失败并通知/创建有明确诊断的 issue，不忽略错误继续发布。
5. 合并成功创建或更新集成 PR，等待独立 CI 和人工审核。
6. 不执行未经信任 PR 修改的脚本，不使用 `pull_request_target` 检出并执行外部代码获取 Secrets。
7. 最小权限：同步任务仅在需要时拥有 contents/pull-requests write；镜像权限只给发布任务。

**事件触发陷阱：** 用默认 `GITHUB_TOKEN` 推送/创建 PR 通常不会像人工推送那样触发后续普通 push/PR 工作流。必须在设计时解决：例如显式调用可信的 reusable/workflow_dispatch 测试入口，或采用权限受限的 GitHub App token。不能看到 PR 已创建就认为必需 CI 会自动执行；使用 PAT/App 需要用户配置和授权，绝不写进仓库。

调度任务依赖 GitHub 默认分支及 Actions 设置，公开 Fork 还可能有启用/闲置限制。GitHub 设置是外部待办，不能在本地写了 YAML 就宣称完成。

## 10. 自有 CI 与镜像发布设计（计划）

### 10.1 已发现的上游适配点

- `docker-publish.yml` 的 build job 限定 `github.repository == 'gethomepage/homepage'`。
- Docker PR 触发分支当前是 `dev`，不能假定 Fork main PR 会走这条构建。
- `test.yml` 上报 Codecov 使用 Secret，且上传错误会导致失败；Fork 未配置服务时需要明确选择保留、条件执行或独立测试工作流。
- 上游其他定时/issue/文档自动化未逐一适配，不能盲目全部启用。
- `Dockerfile` 的 `CI=true` 分支跳过安装和构建，要求上下文已有有效 `.next/standalone` 和 `.next/static`。
- Dockerfile 当前许可证 label 为 `Apache-2.0`，而根 `LICENSE` 与 `CONTRIBUTING.md` 是 GPL v3。发布前核实并修正自有镜像元信息，不能照抄错误标签。

### 10.2 推荐工作流拆分

| 文件（计划新增）         | 触发                           | 职责                                                   |
| ------------------------ | ------------------------------ | ------------------------------------------------------ |
| `fork-ci.yml`            | main 的 PR / main push / 手动  | frozen install、Lint、Vitest、生产构建；不登录镜像仓库 |
| `fork-upstream-sync.yml` | schedule / 手动                | 上游 merge 和更新 PR，不直接部署                       |
| `fork-release.yml`       | 自有 `fork-v*` 标签 / 受控手动 | 再验证、构建 amd64/arm64、推 GHCR                      |

发布前确保现有上游工作流不会重复消耗资源或访问不属于 Fork 的外部服务。是否关闭/适配某项需基于实际检查，不在文档阶段修改。

### 10.3 构建路径必须二选一且验证

A. 在 CI 中安装/构建，确保 `.next` 产物进入 Docker build context，再传 `CI=true`。

B. 让 Docker builder 正常安装/构建，不传 `CI=true`，但先解决 Dockerfile 中浮动 `pnpm@latest`，保证与锁定工具一致。

不能跳过宿主构建却传 `CI=true`，也不能假定另一个 Job 的文件自动存在。跨 Job 要上传/下载产物，跨架构依赖则要验证原生模块兼容；amd64 上构建的依赖不一定适用于 arm64。

### 10.4 发布约束

- 优先 GHCR：`ghcr.io/kanon-h/homepage`，暂不要求 Docker Hub 凭据。
- 自有标签建议 `fork-v0.1.0`；镜像标签可对应 `fork-v0.1.0` 和 `sha-<commit>`。
- 上游标签获取不得自动触发自有发布；标签来源、命名和提交必须符合策略。
- release job 验证提交属于受信任的 main 历史，并在需要时使用 Environment 人工批准；不能只相信任意人推来的标签名。
- 使用源码 SHA、上游基线、自有版本和构建时间标注 OCI 元数据。
- 同一个发布标签不覆盖；生产固定不可变版本或 digest，不能只依赖浮动 latest。
- PR 构建不拥有 packages write、部署密钥或 registry 登录凭据。
- 只授予发布 Job `packages: write`；Actions 依赖版本按既有风格固定并定期维护。
- 核实首次 GHCR package 可见性、仓库关联和拉取权限，不能凭推送成功推断生产可拉取。
- 发布源码和镜像遵守 GPL-3.0 的相应义务，保留许可、修改说明和对应源码信息。

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
