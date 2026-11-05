# Homepage 多地址导航扩展设计

> 状态：设计基线；P0 本地开发基线已验证，多地址功能尚未实现。本文根据本地 Fork 的真实代码编写，不表示扩展已经通过功能测试。
> 读者：仓库所有者、后续开发者、从本目录启动的新会话 Agent。
> 规约版本：v1。行为冲突时以 [SPEC.md](SPEC.md) 为准，开发与发布见 [DEVELOPMENT.md](DEVELOPMENT.md)。

## 1. 项目背景与确定的决策

这是个人自用的 Homepage 二次开发项目，不是重新开发一个导航站。

用户已确认：

1. 复用上游认证，不二开认证、不做用户管理。
2. 主要开发兼容原配置的多地址导航：同一应用可配置默认、内网、VPN、公司网络等地址。
3. 页面右上角全局切换模式；单个应用右键可选择默认地址或其他已配置地址。
4. 旧 Homepage 配置无需迁移，原生 Widget 能力继续保留。
5. GitHub Fork 为主仓，使用 GitHub Actions 测试、构建镜像。
6. 跟踪官方 `main` 分支，通过合并保留二开代码，不采用覆盖式同步。
7. 当前不引入数据库；未来确有持久化需求时优先评估 SQLite 单文件数据库，但必须单独设计、经用户确认。
8. 新会话只需要打开本仓库目录，不能依赖父目录或其他项目。

本文将上述目标细化为 v1 设计。字段名、边界情况和模块划分属于设计决策，不是已经存在的上游接口。后续调整应先更新规约和测试。

## 2. 本地代码核查快照

核查基线（2026-11-05；仅本地引用，未联网确认最新上游）：

| 项目             | 本地观察                                                             |
| ---------------- | -------------------------------------------------------------------- |
| Fork             | `https://github.com/kanon-H/homepage.git`                            |
| `origin`         | 指向上述 Fork，fetch/push 相同                                       |
| 当前分支         | `main`，跟踪 `origin/main`                                           |
| HEAD             | `2e5f10134ae3961bb936d3e7c441f9a1f4a4bf4f`                           |
| 标签 / 包版本    | `v2.7.0` / `2.7.0`                                                   |
| 初始工作区       | 编写本文前干净                                                       |
| 官方远程         | 尚未配置 `upstream`                                                  |
| 本地远程默认引用 | `origin/HEAD -> origin/dev`，不是 `main`                             |
| 技术栈           | Next.js 16 Pages Router、React 19、JavaScript/JSX、SWR、Tailwind CSS |
| 测试             | Vitest、Testing Library、jsdom                                       |
| 认证             | NextAuth 4，密码门禁或 OIDC                                          |
| Node             | 本机观察为 `v24.22.1`；上游 CI 使用 Node 24                          |
| 包管理器         | pnpm；检查时 shell 没有 `pnpm` 可执行文件，有 `corepack`             |
| 依赖             | 检查时没有本地 `node_modules`，未运行测试和构建                      |

以上不是永久状态。下次开发必须重新检查 `git status`、分支、远程与依赖版本，不要将快照当作实时结果。

### 2.1 已存在的认证

- `src/pages/api/auth/[...nextauth].js`：认证入口。
- `src/pages/auth/signin.jsx`：登录页。
- `src/utils/auth.js`：`withAuth`、`withPageAuth`、Host 校验和 Cookie 判断。
- `src/proxy.js`：请求级认证和私有缓存响应头。
- `src/pages/index.jsx`：`getServerSideProps` 使用 `withPageAuth`。
- `docs/installation/index.md`：密码、OIDC 与部署环境变量说明。

密码模式是共享密码门禁，不是多用户账户系统。个人使用足够。多地址扩展不增加登录表、不新增 Session 类型、不改认证路由。

### 2.2 当前导航链路

服务配置：

```text
config/services.yaml
  → servicesFromConfig() / parseServicesToGroups()
  → servicesResponse() / cleanServiceGroups()
  → SSR fallback + /api/services
  → ServicesGroup / Item
  → 图标与标题 <a href={service.href}>
```

相关代码：

- `src/utils/config/config.js`：`CONF_DIR`、`getSettings`、环境变量替换。
- `src/utils/config/service-helpers.js`：服务读取、发现、清洗、嵌套分组。
- `src/utils/config/api-response.js`：服务、书签、Widget 响应组装。
- `src/utils/config/dashboard.js`：首页数据和进程级缓存。
- `src/pages/api/services/index.js`：带 `withAuth` 的服务接口。
- `src/components/services/item.jsx`：图标与标题分别有链接，两处必须一致；卡片还含统计和 Widget。

配置目前会展开服务对象，`cleanServiceGroups()` 复制顶层服务字段；Widget 内部则采用字段白名单。不要误把扩展地址放进 Widget，也不要为传递地址删除原有 Widget 脱敏逻辑。

首页 `Home` 生成 `servicesAndBookmarks`，将其传给 `QuickLaunch`；后者通过 `window.open(result.href, ...)` 打开匹配结果。因此只改卡片不足以覆盖所有导航入口。

书签通过独立接口和 `src/components/bookmarks/item.jsx` 渲染。v1 不修改书签行为，详见范围约定。

## 3. 范围

### 3.1 v1 必须交付

- `services.yaml` 服务项的多个模式地址。
- `settings.yaml` 中的全局模式定义、默认模式、显式禁用开关。
- 右上角模式选择器，手机也可触达。
- 服务标题/图标的真实链接随模式变化，支持原生中键及 Ctrl/Cmd 点击。
- 服务的右键地址菜单、可见“更多”按钮、复制地址。
- 服务搜索结果随模式变化；普通书签、搜索引擎、搜索建议、手动输入 URL 不变。
- 浏览器本地偏好保存、恢复、失效回退、多标签页同步。
- 不修改原始 `href`，不让导航模式污染共享服务数据或 Widget。
- 明确的异常配置处理、自动化测试、浏览器验收和维护交接。

### 3.2 v1 明确不做

- 自研认证、用户/角色/权限系统、注册链接或账户数据库。
- SQLite 或其他数据库、配置网页编辑器、服务端偏好 API。
- 自动判断当前网络、后台探活候选地址、按 IP/地理位置自动切换。
- 将 Widget API、`ping`、`siteMonitor`、Docker/Kubernetes 连接随模式改写。
- 为每个模式复制应用卡片，或整套重写上游组件。
- 书签多地址、每个模式单独 `target`、地址模板、导入其他应用配置。
- Docker labels/Kubernetes annotations 的专门新语法。已有发现服务必须继续可用；专门扩展配置留待后续。
- 自动部署到用户生产设备，或默认允许无人值守合并所有上游更新。

## 4. 配置模型

使用可选的 `extensions.network` 命名空间，不新增 `lanUrl`、`wanUrl` 等固定二元字段。

```yaml
# settings.yaml：拟新增能力，尚未实现
extensions:
  network:
    enabled: true
    defaultMode: default
    modes:
      - id: default
        label: 默认
      - id: lan
        label: 内网
      - id: vpn
        label: VPN
      - id: office
        label: 公司网络
```

```yaml
# services.yaml：拟新增能力，尚未实现
- 基础设施:
    - NAS:
        href: https://nas.example.com
        icon: synology
        description: 文件管理
        extensions:
          network:
            addresses:
              lan: http://192.168.1.10:5000
              vpn: http://100.64.0.10:5000
              office: https://nas.office.example.com
    - 普通服务:
        href: https://status.example.com
```

- `href` 是原始默认地址与回退地址，不能在原对象上覆盖。
- `default` 是保留模式 ID，始终指向 `href`，不在 `addresses` 重复定义。
- 模式定义确定显示顺序和标签。`default` 自动补齐并置首；也允许显式写出以自定义标签。
- 没有全局配置，或 `enabled: false`，完全沿用上游行为。
- 仅配置服务地址而未启用全局网络配置，不隐式启用功能。
- 具体类型、默认值、非法值与回退规则以 [SPEC.md](SPEC.md) 为准。

v1 采用现有 YAML，不增加服务配置文件。保留未知的其他扩展命名空间，不将其解释为导航配置。

## 5. 核心架构

### 5.1 模块布局（计划新增）

为沿用现有 alias，不额外增加 `extensions` 路径别名。逻辑仍独立，只通过少量接入点集成：

```text
src/utils/network/
  config.js                 # 配置规范化、地址过滤、诊断结果，纯函数
  resolver.js               # 解析某模式地址、构造菜单项目，纯函数
  storage.js                # 带异常保护的偏好读写，浏览器适配层
  *.test.js
src/utils/contexts/network.jsx
src/utils/contexts/network.test.jsx
src/components/network/
  mode-switcher.jsx
  service-menu.jsx
  *.test.jsx
```

建议接口契约（最终函数名可以调整，职责不能散落）：

```text
normalizeNetworkSettings(rawSettings)
  → { enabled, defaultMode, modes, diagnostics }
normalizeServiceAddresses(service, normalizedSettings)
  → { eligible, addresses, diagnostics }
resolveServiceLink(service, normalizedSettings, mode)
  → { href, requestedMode, resolvedMode, fallback, hasLink }
getServiceAddressOptions(service, normalizedSettings, mode)
  → 有序、已校验的菜单候选
NetworkProvider({ initialSettings, children })
  → useNetwork(): { settings, mode, ready, setMode }
```

`href`/`hasLink` 沿用上游的旧行为；新地址须经单独校验。错误诊断只能含字段路径与原因，不能包含完整 URL、凭据或服务端密钥。

### 5.2 Provider 放置

建议在 `src/pages/index.jsx` 的 `Wrapper` 中，围绕首页 `Index` 增加页面级 `NetworkProvider`，传入真实的 `initialSettings`。

理由：

- `_app.jsx` 的 `SettingsProvider` 初始通常为空，首页 `Home` 在 Effect 中再 `setSettings(initialSettings)`。
- 网络模式不能先把空设置当真实设置，再用默认模式覆盖已有偏好。
- 仅首页需要网络状态，不必改登录页和整个 `_app.jsx` 的 Provider 链。
- 页面级入口减少对上游公共框架的修改。

服务组件独立测试时，网络 Hook 在没有 Provider 时必须返回“扩展关闭”的默认值。测试工具可显式包裹 Provider，不强迫所有上游组件测试改写。

### 5.3 共享数据与页面派生数据

服务器始终返回所有已配置导航候选；浏览器在本地选择模式：

```text
SSR 初始设置和完整服务列表（与模式无关）
  ├─ Provider 恢复浏览器偏好
  ├─ 服务卡片解析本地有效 href
  ├─ 菜单构造候选链接
  └─ QuickLaunch 的服务结果解析本地有效 href
```

不得将浏览器模式写入 `getDashboardData` 的进程缓存、SWR 的原始服务对象、全局模块变量或 YAML。多浏览器并发使用时，各自模式互不影响。

QuickLaunch 推荐在首页构造不可变的派生服务条目，然后和未改动的书签条目合并。只对服务执行解析，不对“访问 URL”、搜索建议、搜索引擎链接套用模式解析。保留原条目的 `type`、名称、target 等字段；若临时覆盖派生对象的 `href`，原对象必须保持不变且原始默认地址来源清晰。

### 5.4 SSR、恢复与首次点击

初始 SSR 和客户端首次 Render 使用同一配置默认模式，不能 Render 时读取 `window` 或 `localStorage`。

为避免浏览器偏好恢复前误开默认地址，对已启用且具有有效备用地址的服务采用短暂的恢复状态：

- `ready: false` 时不提供可导航 `href`，也不开放菜单与该服务的 QuickLaunch 打开操作。
- Effect 完成一次存储读取或失败降级后，`ready: true`，显示最终模式的真实 `<a href>`。
- 没有备用地址的旧服务与普通书签不等待恢复。
- 模式按钮在恢复期间禁用或显示加载状态，禁止先写回默认值。
- v1 不保证关闭 JavaScript 后多地址服务可导航；普通旧服务仍按原行为。此取舍必须在实现文档中保留。

组件状态、统计按钮、Widget 正常工作，不应因为短暂恢复而卸载整张卡片。

## 6. UI 与交互

### 6.1 全局模式

放在首页顶部信息区的右侧，不能误放在当前上游 footer 的主题切换区。没有信息 Widget 时仍要显示；手机布局换行但保持可访问，不遮住搜索入口。

只在扩展启用且存在备用模式时显示；模式切换后更新所有服务入口。缺少某模式地址时，服务回退 `href`，菜单中说明“当前使用默认地址”，不做可达性探测。

### 6.2 服务菜单

右键限定在服务导航区域，不能吞掉 Widget、统计按钮、输入框的原生操作。具有有效备用地址时才接管右键；Shift+右键不调用 `preventDefault`，作为浏览器原生菜单的尽力回退，仍以浏览器实际行为为准。

“更多”按钮提供触屏和键盘入口，不能嵌进 `<a>`。菜单建议使用现有 Headless UI，配合 Portal/定位机制，避免卡片 `overflow-clip` 裁剪。

菜单条目使用真实链接；复制动作使用按钮。显示模式标签，避免重复“当前地址”链接。不同模式恰好同 URL 时保留模式语义，不擅自删除用户定义的模式条目。

支持外部点击关闭、Escape 关闭、方向键导航、焦点回到触发器、视口边缘定位。详细行为见规约。

## 7. 配置校验与诊断

当前 `/api/validate` 主要检查 YAML 语法，不能假设已有新字段语义校验。

v1 计划在配置读取/响应边界复用纯规范化函数，做到：

1. 页面可用优先：新扩展有错时局部降级，不使全部首页崩溃。
2. 全局结构错误降级为扩展关闭；单一模式/单一地址错误只忽略局部。
3. 服务端返回浏览器前过滤无效的新增地址；SSR 与 API 经过同一处理链。
4. 如需接入 `/api/validate`，不得把非致命扩展警告混入现有“错误即阻断页面”的数组。v1 可先使用去重的服务端警告，不另造公开诊断 API。
5. `cleanServiceGroups` 保留递归处理，覆盖嵌套分组，不修改 Widget 白名单。
6. 控制台/日志告知字段路径与错误类型，不输出地址值。

不要为了“少改一个后端文件”而让 SSR 和 API 行为分裂，也不要在每次 Render 打印重复警告。

## 8. 认证、安全与部署边界

- 继续使用 `HOMEPAGE_AUTH_ENABLED`、`HOMEPAGE_AUTH_SECRET`、`HOMEPAGE_AUTH_PASSWORD`、`HOMEPAGE_EXTERNAL_URL`、`HOMEPAGE_ALLOWED_HOSTS`。
- 全部候选地址会提供给登录浏览器；模式不是权限控制，也不隐藏内网拓扑于已登录用户。
- 不添加新的免认证服务列表接口，不把真实配置放到 `public/` 或示例文件。
- 认证页面、静态资源、健康检查、定制 CSS 与 MCP 有上游特定边界，不能笼统认为所有请求都返回 401；回归测试区分中间代理重定向和 API Handler 401。
- 不新增地址代理接口；浏览器直接导航，不服务端抓取新地址，因此不扩大候选 URL 的 SSRF 面。
- 新增备用地址只接受绝对 HTTP(S) URL，不接受脚本协议或 URL 内嵌凭据；原始旧 `href` 不进行全局重写。
- 公网部署需要 HTTPS、反向代理限流、禁止绕过边缘直连。共享密码没有内置应用级限流。
- 建议同一域名在内外网解析到不同入口，保持 Homepage 自身 canonical URL 一致；模式改变的是被导航应用，不是登录回调地址。
- 当前 `.gitignore` 只忽略 `.env*.local`，不能假定普通 `.env` 安全。部署密钥、PAT、私有服务地址不得提交。

## 9. 上游融合策略

仓库关系：

```text
gethomepage/homepage main
  → upstream integration PR
  → kanon-H/homepage main（含二开）
  → 自有发布标签 / GHCR
  → 可选 Gitea 单向备份
```

保留上游历史，用 merge 集成，不对已发布分支 rebase/force push。不要对 Fork 使用覆盖式“丢弃本地提交”同步。

优先新增独立文件，旧文件只接入必要能力。每次合并重点审查：

- `src/pages/index.jsx` 的 Provider、头部布局、搜索条目构造。
- `src/components/services/item.jsx` 的链接和交互区域。
- 服务配置处理与 Widget 脱敏链。
- 认证边界、Next.js/React 主版本变化。
- 测试 harness、依赖锁文件和 Docker 构建流程。

自动化负责发现、尝试合并、创建 PR、测试，不承诺自动解决语义冲突。人工批准生产发布。向上游贡献前阅读 `CONTRIBUTING.md`：当前上游对 AI 生成 PR 有明确限制，不能默认提交即可接受。

## 10. 发布与长期存储

自有镜像建议先使用 `ghcr.io/kanon-h/homepage`，仓库路径小写。自有标签建议 `fork-v0.1.0` 一类，与上游 `v2.7.0` 标签区分；版本元信息记录自有版本、上游基线、源码 SHA、构建时间。

上游 `docker-publish.yml` 有官方仓库条件，Fork 不能直接发布。专用工作流、权限、回滚和构建陷阱见 [DEVELOPMENT.md](DEVELOPMENT.md)。

未来若引入 SQLite，必须先给出 ADR：数据归属、单文件挂载、事务、备份一致性、迁移/回滚、多副本限制。引入数据库不是当前阶段任务，也不能将其用于替换已稳定的 YAML 配置。

## 11. 当前交付状态

初始交付仅有设计、规约和会话交接文档。2026-11-05 已执行 P0 本地基线：

- 已创建 `feature/multi-address` 分支，HEAD 仍为 `2e5f1013`，没有实现网络模式、地址菜单或偏好存储。
- 已使用 Node `v24.22.1` / pnpm `10.34.9` frozen install；Lint、573 个测试文件 / 1902 项测试及生产构建通过。
- 已用虚构配置在临时 loopback standalone 服务验证原生密码登录、退出、Host、首页/API/SSR 数据权限及私有缓存响应头。未验证真实浏览器、OIDC 或反代缓存。
- 没有修改业务源码、依赖声明、锁文件、远程设置或 Actions；没有构建镜像、提交、推送、发布或部署。
- P0 的 upstream/GitHub 设置仍待单独授权；下一步经用户确认后进入 P1。完整证据与未完成项见 [agent.md](agent.md) 和 [DEVELOPMENT.md](DEVELOPMENT.md)。
