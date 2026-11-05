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

## 当前状态：P5 自动化与使用文档已完成，人工/目标环境验收待补

当前位于 `feature/multi-address`，跟踪 `origin/feature/multi-address`；本次 P5 提交前基线为 `808af4fa9e82a16a796d49fad9bd2fdc8fd24cfa`（P4 已提交推送）。2026-11-05 用户另行明确授权将本轮 P5 脚本、使用说明及交接摘要提交并推送到该功能分支；具体提交结果以 Git log 和远程引用为准。本次授权不包含恢复已暂停的手机兼容排查、P6、发布或生产部署，本地 config/凭据/证据不提交。

2026-11-05 人工验收实例已启动：用户明确选择局域网直连；复用现有 standalone，仅绑定所选内网 IPv4 与独立端口，启用随机临时密码/认证密钥及严格 Host 校验，使用独立虚构服务/书签配置，不动生产服务、系统防火墙或代理。地址、PID 和到期状态仅在 Git/Docker 忽略的 `config/p5-manual/session-20261105T215005-0e6ff5/status.json`，不在本文记录真实地址或凭据。两小时 watchdog 到 UTC+8 23:50:05 自动停止；本机 HTTP 已验证匿名隔离、原生登录/退出、PNG 图标、配置校验、private/no-store 和非法 Host 拒绝，用户已确认客户端可打开并登录，8 项基础桌面操作正常，详细结果见下方；其余未覆盖人工场景仍待。停止时向该 status.json 中的 supervisor PID 发 SIGTERM 前须再次核对进程身份，不杀其他服务；临时密码不落配置/日志。

2026-11-05 P5 实际变更与证据：

- 新增可分发的 `scripts/network-acceptance.py`：可选 Python Playwright 验收工具，不新增项目/Python 依赖声明，不修改认证或业务源码；自建虚构 YAML、密码认证实例、Widget/监控后端与 HTTPS nginx 缓存代理，全部仅 loopback，结束及异常时清理进程。随机认证变量不写配置/报告，不导出 Cookie/storageState/trace；临时测试 TLS key 自动删除。
- 用户已明确允许隔离下载/解包浏览器运行库和代理工具，均在 Git/Docker 忽略的 `config/p5-baseline/tools/`；未用 sudo、未安装系统包、未修改系统 nginx/nginx-ui 或其他服务。复用 Python Playwright `1.61.0` 与 Chromium 缓存，补齐动态库和字体；不再沿用“当前没有浏览器”的旧环境判断。
- Node `v24.22.1` / pnpm `10.34.9` frozen install、Lint、583 文件 / 2229 测试（续办复跑 98.22 秒）及生产构建通过。依赖/锁文件未改，仍只有两条上游 vi.unmock 警告。
- Chromium `149.0.7827.55`（headless）+ nginx `1.26.3`：enabled/disabled/legacy/chinese 四配置加普通 HTTP 场景 **245 项检查通过**（原 237 项 + HTTP 8 项），无 pageerror。含卡片/菜单真实左键、中键、Linux Ctrl-click；trusted 右键/Shift 放行、Widget/监控右键、键盘焦点、原生滚轮、窗口调整、真实 Clipboard 允许/拒绝、注入 API 缺失、localStorage 异常/刷新/跨页同步、打开搜索后跨页换模式、书签/输入 URL/搜索引擎不变。
- 桌面 1440×900、1200×700、移动触屏模拟 390×844、短视口 320×240；菜单实测边界/Portal 裁剪、内部滚动和 64 码点标签通过。英文/简中资源已验证，隔离补齐 CJK 字体后截图复验；触屏模拟不计物理设备验收。
- HTTPS 真实 nginx 共享缓存具备 MISS→HIT 正对照，未加 Cookie bypass 掩盖来源错误；登录用户首页/API/Next 数据反复预热后，独立匿名客户端及退出客户端仍受限。验证 SSR/API 原始快照同源、恢复前无备用/默认 href、Widget 密钥/非法凭据不泄漏、Host 拒绝和后端 Widget/监控目标不随模式变化。
- 续办新增 `--insecure-http`：保留 `.test` 域名仅在测试浏览器内映射到 loopback 3308，不改系统 DNS/hosts；真实验证 isSecureContext 为 false、Clipboard API 缺失、复制失败不跳转且后续模式切换仍正常，保留原生密码登录与 Host 校验。最新完整构建及 245 项证据在 `config/p5-baseline/run-20261105T120153Z-34cf78/`，副本在 `config/p5-baseline/evidence/continued/`，旧 237 项归档不覆盖。
- 新增[人工验收记录模板](docs/more/network-acceptance.md)，区分原生菜单界面、物理触屏、macOS 与目标认证/缓存；模板默认未执行，不代签操作者。续办检查确认 SPEC/DEVELOPMENT 的归档后变化仅为 P5 表格格式，已保留。
- 新增用户指南 `docs/configs/network.md`，服务文档与站点导航加入入口；补充本地复现命令、证据分层及人工清单。细节和最终证据目录见 DEVELOPMENT 的 P5 记录。没有发现需要改动业务代码的回归；调试过程中修正的是测试工具的代理临时路径、后台标签页观测、Clipboard 权限作用域和搜索关闭动画等待。

用户人工反馈（macOS 电脑）：Chrome `155.0.8059.85` 正式版 arm64、Edge `154.0.4258.37` 正式版 arm64，所给 1～8 项操作均正常：访问/登录、默认/内网导航、刷新保留、临时打开不改模式、Cmd+点击、标题右键/Shift 原生及普通服务原生菜单、上下键/Escape、桌面缩窄菜单及 HTTP 复制失败反馈。设备没有中键，手工中键未执行；macOS 版本/具体 viewport 未提供。原始脱敏反馈在该临时实例的 `manual-feedback.md`，重复消息不重复计数。

物理手机补充：用户确认两机手机步骤 1～4 基础触屏/布局正常；华为手机/华为浏览器/鸿蒙6 报告新标签页打开，红米/小米浏览器报告替换当前页，用户偏好新标签页。手机具体型号、华为/QQ 浏览器及红米系统版本未提供；小米版本和触发动作的后续确认见下文，窗口差异为未解决项，不记全通过。已核查原版支持全局/服务 target；现有测试配置为全局 `_blank` 且服务无覆盖，live Chromium149触屏模拟中标题/图标/菜单真实链接也均为 `_blank`，更多按钮不导航、地址激活新页面。证据在该 session 的 `link-target-probe.json`，不是物理小米浏览器复现，不能据此断言根因。用户随后已明确：红米更多按钮只正常展开菜单，菜单地址激活才替换当前页，直接点标题也替换当前页。同页行为不是菜单专有，更倾向浏览器统一链接策略/兼容性，已获小米版本 `v20.28.1020918`，用户补测红米与鸿蒙手机的 QQ 浏览器也报告原页打开，不能仅归因于红米系统；QQ 版本/客户端设置尚未核查。用户已通过标签列表确认数量不变且 Homepage 被替换，已排除新标签切前台的误判；具体原因未确认。下一步拟准备受原登录保护的临时纯 HTML 链接对照（比较 `_blank` 与 rel 组合，不含业务菜单逻辑），但用户已选择暂停排查，不创建对照页、不修改业务代码、不重启/续期，临时实例按原定 UTC+8 23:50:05 自动停止；恢复时先确认测试环境与授权；不先写强制 window.open、移除 rel 或关闭浏览器安全保护的补丁。

仍未完成：红米链接打开方式差异、手工中键、完整键盘焦点/Widget统计交互等未覆盖场景、物理触屏剩余项目、实际 OIDC（如使用）及目标生产反代/CDN 验收。无头 Chromium/本地 nginx 不代替这些证据，SPEC 完成定义仍未全部满足，P5 完整验收及 v1 不能宣称完成。P6 和 P0 外部仓库设置未执行；本次仅按用户授权提交/推送 P5 已完成成果，不表示完整验收通过，未发布或生产部署。

### P4 服务菜单记录（历史）

P4 验证时 HEAD 为 `3f7aed7e`，随后按用户要求提交推送为 `808af4fa`。

2026-11-05 P4 实际变更：

- 新增 `src/utils/contexts/service-menu.jsx`：NetworkProvider 内独立的单菜单协调器/触发 Hook，不保存全局模式或偏好；根据打开记录身份及 mode/settings/service 校验，关闭旧记录不会误关新菜单。network.jsx 只增加此 Provider 包裹，原偏好逻辑不变。
- 新增 `src/components/network/service-menu.jsx` 及测试，使用现有 Headless UI Portal 与受控 ARIA menu：更多按钮可见且不在链接内；右键仅绑定图标/标题 anchor，Shift 回退原生，Widget/统计不接管；统计标签为更多按钮让出右侧空间。
- 菜单复用 P1 候选和 P3 导航，包含默认/已配置模式的真实 anchor、当前来源、fallback 说明及复制按钮；同 URL 不合并模式。target/rel 与卡片一致，临时打开不改偏好；链接激活后延迟关闭以保留原生动作，旧关闭任务有清理/身份保护。
- 新增 `menu-position.js` 及测试，按实际测量将 fixed 菜单限制在视口内；Portal 避免卡片 overflow-clip。外部点击/右键、页面滚动、窗口缩放、Escape/Tab、模式/配置/服务变化关闭，菜单自身滚动不关闭；方向键/Home/End、Space 链接激活及焦点返回已测试。
- 复制只用安全上下文 Clipboard API，失败/缺失/拒绝给错误反馈，不用 DOM hack，不假报成功；等待复制时焦点保持在菜单，旧异步结果不会污染新菜单。只新增 en/zh-Hans 的 8 项菜单文案。

P4 验证（Node `v24.22.1` / pnpm `10.34.9`）：

- frozen install、Lint、生产构建通过；聚焦 13 文件 / 362 测试、全量 583 文件 / 2229 测试通过（比 P3 新增 49 项），全量耗时 107.95 秒；仅两条已有 vi.unmock 警告。
- 新菜单、协调器、定位模块聚焦覆盖：行 100%、分支 94.3%、函数 97.72%；覆盖率运行 4 文件 / 102 测试通过，不以覆盖率代替真实浏览器验收。
- 在 P4 工作树复用 `python3 config/p3-baseline/run-baseline.py` 构建并运行 enabled/disabled/legacy 三配置 standalone HTTP/SSR/认证回归，全部通过，临时实例均已停止。日志 P3 字样来自复用脚本，不代表真实菜单点击验收。
- 本轮日志和源码校验和归档至 Git/Docker 忽略的 `config/p4-baseline/evidence/`；复现脚本仍在 p3-baseline，认证密钥/密码/Cookie 仅在内存。没有新增依赖或浏览器下载。
- 主动检查 13 个文件：7 个 JS/JSX 均 clean；两个 JSON 保留 5 条已有 widget ID/文案拼写提示；4 份 Markdown 无语言服务答复（inconclusive），未计为 LSP 通过。代码 Prettier、复用脚本 py_compile、JSON/文档静态及 git diff --check 通过；未改动 P3 已说明的 QuickLaunch 单点规则例外。

P4 结束时未完成：真实中键/Ctrl-Cmd/原生右键/Shift、菜单边缘/遮挡、窄屏/触屏/实际焦点、多标签页、OIDC 与反代/CDN。P4 当时没有可用浏览器，未进入 P5、未提交/推送/发布/部署；后续提交与 P5 自动化进展以上方记录为准，旧 jsdom/测量 mock 不算浏览器证据。

### P3 链接/切换器/搜索记录（历史）

P3 验证时 HEAD 为 `73d36b37`，随后源码、文档与 JSON 格式调整已按用户要求提交推送为 `3f7aed7e`。

2026-11-05 P3 实际变更：

- 新增 `src/utils/network/navigation.js` 及测试，作为纯 UI 导航适配层共用 P1 解析结果和 P2 ready 信号，不把恢复状态塞入原 resolver。只在有有效备用地址且未 ready 时清空派生 href；原始服务、Widget、监控数据不变。
- 新增 `src/components/network/mode-switcher.jsx` 及测试：顶部信息区右侧的原生 select，有多个模式才显示，恢复时禁用；支持键盘、限制宽度/换行。无 Widget 或 widgets 尚未返回时仍存在；手机实际布局尚未验收。
- 卡片图标/标题的真实 href 共用适配层，保留 service > settings > _blank 及 rel，未改成 onClick 导航；恢复时只有可扩展服务暂时不生成链接，旧服务正常，Widget 与统计不卸载。
- 首页搜索先按原始 href 筛选服务，再生成不可变派生项，保留 type/target/名称；书签不解析网络字段。恢复中的服务结果仍占原位置但无 href，QuickLaunch 按钮禁用，点击/Enter 均不打开、不关闭面板、不排队。模式或 storage 事件更新后，已打开面板使用新地址。
- 英文/简中文案仅新增 network.mode/default/restoring；测试使用真实 i18next 资源验证两种语言和缺失语言的英文回退，配置标签作为纯文本。
- 未开发 P4 菜单/复制，也未改变认证、服务发现、后端地址、依赖、锁文件或 Actions。

P3 验证（Node `v24.22.1` / pnpm `10.34.9`）：

- frozen install、Lint、生产构建通过；聚焦 11 文件 / 313 测试、全量 581 文件 / 2180 测试通过（比 P2 新增 38 项），全量耗时 105.37 秒；仅有两条原有 vi.unmock 警告。
- 新增导航适配/切换器覆盖率行/分支/函数均 100%；卡片真实 SSR/hydration 测试证明恢复时无默认 href、恢复后两个链接直接使用已保存模式，无 recoverable hydration 错误；不是原生中键/右键验收。
- `python3 config/p3-baseline/run-baseline.py`：虚构配置生产构建，分别以 enabled / disabled / legacy 配置启动 loopback standalone 实例；验证无 Widget 的顶部原生选择器、SSR 恢复保护、普通服务/书签原链接、禁用后的双链接及 target、SSR/API 原始数据一致、认证和私有缓存头，全部通过，三个临时实例均已停止。
- 本地脚本、配置和证据位于 Git/Docker 已忽略的 `config/p3-baseline/`，密码/认证密钥/Cookie 仅在内存。未下载浏览器或新增 E2E 依赖。
- 主动检查 17 个文件：9 个 clean；4 个文件保留 13 条既有 advisory（QuickLaunch/首页静态建议及翻译中已有 widget ID 的拼写提示）；4 份文档无语言服务答复（inconclusive），未计为 LSP 通过。另有 1 项 QuickLaunch 既有 window.open 启动器的 no-open-redirect 规则例外：这是用户主动外链导航，不是认证重定向，新备用 URL 仍严格校验；逐调用点保留说明/忽略，不关闭整个规则，不把该位置计为检测器 clean。代码 Prettier、Python py_compile、JSON/文档静态及 git diff --check 通过。

未完成：真实中键/Ctrl-Cmd/原生右键、窄屏/触屏、真实跨标签页、反代/CDN、OIDC 验收；P4 菜单及 P5/P6，P0 外部设置仍待授权。当前环境没有浏览器可执行程序；P3 代码/自动化完成不代表 v1 完成。P3 结束时未进入 P4、未提交推送、未发布部署；后续提交与 P4 状态以上方记录为准。

### P2 Provider 与偏好恢复记录（历史）

P2 验证时 HEAD 为 `b584b902`，随后源码与文档已按用户要求提交并推送为 `73d36b37`。

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

未完成：P3 真实链接/搜索/模式切换器、P4 菜单、P5 完整浏览器/反代验收、P6 CI/CD；P0 外部仓库设置仍待单独授权。没有真实跨标签页浏览器、触屏、OIDC 或反代验收；上游主题/颜色等自身的存储容错不在本阶段改动范围。P2 结束时未进入 P3、未提交推送、未发布部署；后续提交与 P3 状态以上方记录为准。

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

P1 结束时尚未进入 P2，功能与文档随后已授权提交推送；后续 P2/P3 状态以上方记录为准。P0 外部设置及 P4～P6 仍未完成。

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

初始交付时所有新增字段均待实现；目前 P1～P4 已提供解析、响应过滤、偏好、切换器、卡片/搜索联动及菜单，完整浏览器/安全与发布验收仍待后续阶段。

## 初始核查快照（2026-11-05）

- 分支 `main` 跟踪 `origin/main`，HEAD `2e5f10134ae3961bb936d3e7c441f9a1f4a4bf4f`，标签 `v2.7.0`。
- 编写文档前工作区干净，origin 是用户 Fork。
- 尚未配置 upstream，尚未修改 GitHub 默认分支或分支保护。
- 本地 `origin/HEAD -> origin/dev`；GitHub 真实当前默认分支仍需按需联网确认。
- Node `v24.22.1`，有 corepack；shell 未发现 pnpm，未安装 node_modules。
- 上游已有认证与相关回归测试，不需要重新开发。

快照仅供定位。下次先检查当前状态，不要自动回退到上述 commit。

## 建议下一步

P5 自动化与文档已完成，下一步最小任务是补齐 **P5 人工/目标环境验收**，不是自动进入 P6：

1. 已取得上述 macOS 两浏览器 8 项基础反馈（含原生右键/Shift 与 Cmd-click）；下一步按[人工验收模板](docs/more/network-acceptance.md)补物理触屏及完整键盘焦点/Widget统计等未覆盖场景。当前设备没有中键记为未执行，不改成通过；未报告的 OS 版本/viewport 不推断。
2. 如实际使用 OIDC 或生产反代/CDN，另行明确授权和目标，再验证真实登录/退出、HTTPS/canonical URL 和匿名缓存隔离；本轮只验证受控 nginx，不操作生产。
3. 使用说明在 `docs/configs/network.md`；按需复跑 `scripts/network-acceptance.py --build --insecure-http ...`。不得跳过 SPEC 的手工完成定义，不自动提交、推送、发布或部署。

内部约定：default 的 `label: null` 用 i18n；候选为 `{ id, label, href, current }`，fallback 说明取解析结果。菜单状态只在当前 NetworkProvider 内，不读写偏好；新菜单使用记录身份隔离旧关闭任务/复制结果。getServiceSearchEntry 始终接收原始服务。

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
