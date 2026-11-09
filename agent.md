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
- GitHub Actions 测试并发布 Docker Hub 镜像；Gitea 单向备份仍可选。
- 最新发布目标是正式多地址镜像：仅P5手机兼容验收延期，其余必需工作完成后发布；不采用预览/直接合PR #1的更快路线，不开发Skill。手机已知差异保留为延期未完成，见SPEC12.1及DEVELOPMENT14。

## 当前状态：第二次真实 build-only 仍失败；已定位为 `.dockerignore` 未放行 `tailwind.config.js`

第二轮修复 PR #5 已合入 main：`d67ebbb1ca96b2c70b53eab3c42b5e9de2040a55`（双父 `0d4cfc1d`+`bc7ec5ad`，源分支保留，保护未变），PR #5 head `bc7ec5ad` CI run `42613308828` 与 main CI run `42614710657` 均 attempt1 全步骤成功。

但在 main `d67ebbb1` 上单次 `publish=false` 实跑 run `42615682764` **再次失败于同一点**：`Can't resolve '../../tailwind.config.js'`。真正根因是 **`Dockerfile.fork.dockerignore` 以 `**` 拒绝一切、未显式 `!tailwind.config.js`**；上一轮只修了 context 白名单，文件进了 context 却在 Docker 构建时被 ignore 掉。**未 rerun、未再次 dispatch、未登录 Hub、未推送镜像**；publish job 仍被跳过。日志：`release2-build-log.txt`。

本地修复两文件：`.dockerignore` 增加 `!tailwind.config.js`；测试新增“deny-by-default 必须显式放行构建所需根文件”“放行项必须真实存在”“`globals.css` 的 `@config` 目标必须在 ignore 中放行”三类断言。**2458 测试 / Lint 通过**，并用 Docker ignore 语义模拟确认 12 个必需文件全部 included、无 `config/`、`.next/`、`node_modules`、`.env`、私钥或测试文件泄漏。尚未提交推送；需新授权才能继续。

### P6 第十五小步：第二次 build-only 失败与 dockerignore 根因（最新）

- 教训：镜像能否构建由 **两层**决定——Git context 白名单与 `.dockerignore` 放行；只改一层会得到“context 有文件、镜像里没有”的假修复。已用回归同时锁住两层。
- 本轮运维证据：`fix-pr-create.log`、`fix-ci-verification.json`、`merge-verification.json`、`main2-ci-verification.json`、`release2-preconditions.json`、`release2-dispatch-response.json`、`release2-run-summary.json`、`release2-build-log.txt`、`dockerignore-sim.log`。
- 索引锁第三次复现（空/当前 UID/无进程/无 lsof/两次一致），已清理且未重建索引：`stale-lock-3.json`；根因仍未定位。
- 下一步仍需明确授权：推送该修复 → 后续 PR → 核 head CI → merge → 核 main CI → **再次单次** `publish=false`。不自动 rerun 两个失败 run，不进入 publish=true。

main 现为 `0d4cfc1dfc77c8654cb9cb010d768790d0d1d166`（PR #4 merge commit，双父 `57acb02c`+`adbe0132`，树与受审 head 一致，源分支保留，PR #1 未动）。新 main 精确 CI run `42606899680` attempt1 全步骤成功。feature 已推送 `d4362f1c`（2456 测试），PR #4 head `adbe0132` 的 CI run `42605650425` attempt1 成功。

随后按授权单次 dispatch `fork-release.yml`（`publish=false`、版本留空），run `42608235225` **attempt1 失败并已停止**：`Build both architectures without registry credentials` 在容器内 `next build` 报 `Can't resolve '../../tailwind.config.js'`。根因是白名单 Git context 漏了 `tailwind.config.js`，而 `src/styles/globals.css` 通过 `@config` 引用它。**未 rerun、未再次 dispatch、未登录 Docker Hub、未推送镜像、publish job 被跳过**；失败日志见 `config/p6-image-http/evidence/release-build-log.txt` 与 `release-failure-analysis.json`。

本地修复仅两个文件：`scripts/fork-image-context.mjs` 把 `tailwind.config.js` 加入白名单根文件，`src/__tests__/workflows/fork-release.test.js` 增加“该配置与 globals.css 一起导出”的回归。当前 context 669 个文件、无 `config/`，**2457 测试/Lint/隔离构建通过**。修复尚未提交推送；`fork-image-context.mjs` 不在上轮授权范围内，main 也已前进，需另行授权才能推送、开后续 PR、合并并再单次 dispatch。

### P6 第十四小步：PR #4 入 main 与首次真实 build-only 失败（最新）

- 授权链本地证据：`config/p6-image-http/evidence/` 下 `authorized-before.json`、`feature-push.log`、`foundation-push.log`、`foundation-ci-verification.json`、`merge-before.json`、`merge-verification.json`、`main-ci-verification.json`、`release-preconditions.json`、`release-dispatch-response.json`、`release-run-summary.json`、`release-failure-analysis.json`。
- 8 个发布文件在两分支逐字节一致；基础分支 13 文件（PR #4 原 10 + F03 3），无导航源码、无 feature 祖先，范围门禁曾拦下我最初漏算的 3 个原基础文件，已按实际 13 文件重新核对后合并。
- 索引锁两次复现：首次核对空文件/当前 UID/无 Git 进程/无 lsof/两次状态一致后清理并未重建索引，证据 `stale-index-lock-before.json`、`stale-lock-2.json`；**根因仍未定位**（OPS-L01 保持未完成）。
- 失败属“我的 context 白名单遗漏”，不是不可解或产品缺陷；但本地隔离构建能过、镜像内构建不过，说明该白名单必须有独立回归。已新增。
- 下一步需明确授权：推送该修复 → 开后续 PR 到 main → 核新 head CI → merge → 核新 main CI → **再次单次** `publish=false` 实跑。不得自动 rerun 旧失败 run、不得跳过容器门禁、不得提前 publish=true。

从feature/multi-address@8822dba60a34cf6179077117ac3fdd5dbce99f3a继续本地开发，保留原DEVELOPMENT表格格式化。旧head的真实CI run42577634798/check129028827539已通过，但不能代签本轮尚未提交的改动。本地开发阶段未写远程；随后用户已分别授权保存/独立PR #4更新、受审CI通过后Ready/merge #4及main CI、一次publish=false/空版本双架构实跑。操作按条件推进、失败停止，精确结果以Git/GitHub及本轮evidence为准；不动PR #1/保护/Secrets/Hub发布或生产。独立发布基础仍须经受审集成和精确CI后才能实跑。只有手机兼容延期，正式路线不变。

### P6 第十三小步：F03 本地工具与原生 HTTP 回归

- 新增 scripts/fork-image-http.mjs，并接入 fork-image-smoke/build job 的必经步骤及 RELEASE_FILES 可信main一致性校验。两架构各检查默认root+/app/config及PUID10001/PGID10002+/config：实际健康状态、PID1身份、挂载内容/写权限及HTTP登录前后YAML不变。
- 原生密码/CSRF、错误密码、登录/退出、首页/服务/书签/Widget/Next数据私有缓存与匿名隔离、Host负例和SSR/API一致性均有验证。固定loopback连接、不跟随重定向、Cookie只在内存；随机虚构配置卷与测试密码，不读取真实配置或传递宿主凭据。按唯一标签和精确名称清理，不prune共享资源；归档验证前后SHA一致才允许上传。
- 新增40项测试，工作流227项；默认完整Vitest为588文件/2456项通过。实际新构建的native standalone通过103项HTTP检查，临时进程和配置已清理；这不是Docker/QEMU、OIDC、HTTPS/CDN或P5人工验收。
- 初次native测试发现Next数据使用x-nextjs-redirect，已按真实协议补验证及恶意/冲突重定向负例。全量也复现既有认证模块冷导入超时，未修改8822基线同样失败；仅将真实路由预加载移到认证测试beforeAll并补afterAll环境恢复，58项既有用例/断言、默认超时和并发不变，完整重跑通过。原失败与基线证据保留在config/p6-image-http/evidence。
- 本机仍无Docker/Podman/Skopeo；HTTP工具尚未进入独立PR #4/main，无真实容器、镜像或Hub结果。下一步先明确保存/推送及独立基础更新授权，受审后再分别授权F01与一次publish=false实跑；不直接合PR #1或发布。

### P6 第十二小步：正式发布条件与后续门禁（最新用户决定）

- 用户未接受“预览版优先/直接合PR #1”的更快建议，继续原独立基础PR #4路线。只有P5实际手机浏览器导航、触屏/布局兼容验证延期；小米/QQ同页差异未解决，不能记通过或改导航补丁。SPEC12.1只记录手机排期例外，不削弱功能/安全合同。
- 非手机P5必须补齐：桌面中键/完整键盘焦点/Widget统计与原生交互，适用的OIDC/目标反代缓存/Host与匿名隔离。当前未执行仍是未完成；无设备不算通过，N/A需用户确认适用范围。
- DEVELOPMENT13～14详细列固定ID与F01～F12：独立基础入main/新CI →真实基础构建和完善HTTP镜像验证 →非手机P5及其它既有必需验收 →最新main同步feature/新CI →单独审查PR #1合main →最终正式run同一OCI归档完整验证 →Hub设置/不可变规则/回退演练 →正式推送与独立拉取交付。早期基础镜像没有导航，不能当正式成果。
- 上游写入/调度/门禁补充验证继续跟踪，缺真实更新或环境记录为阻塞/待用户决定，不用no-op/模拟冒充完成；R09供应链增强/Gitea保留原后续可选性，Skill暂不开发。
- 本轮只改规划/交接/规范和指南并提交推送，不做上述Git合并或发布操作；实际新head/CI以Git/GitHub和config/p6-formal-plan/evidence为准。下一次从单独授权F01开始，按阶段停止和交接。

### P6 第十一步：独立发布基础 PR 与 feature 保存（历史；已交付）

- 隔离工作树 config/p6-release-bootstrap/worktree，分支 chore/fork-dockerhub-release-bootstrap，直接从 main57acb02c 起步。89f0a542 唯一父为该 main，树 bb64c8f512f9872fe0f118e3a9e28996f5b0ed62，仅10个发布文件/1471行新增，无 feature 祖先、导航、认证、Widget、依赖/锁文件、原 Docker/CI 定义改动。
- 纯 main 基线为576文件/2023测试；发布基础为577文件/2089测试、187项工作流测试，安装锁文件/Lint/隔离应用构建/格式/语法通过，均首次全量成功。7个代码/YAML主动诊断clean，2个Docker路径unsupported、1份Markdown inconclusive；不能套用功能分支2416计数，也不称真实镜像构建完成。
- [PR #4 CI run 42552833352](https://github.com/kanon-H/homepage/actions/runs/42552833352) attempt1 success；check128951971443、Fork verification/App15368、精确89f0a542及全部关键步骤核实。PR测试快照32fc6ea2ca620db2d585f8b432d7421e77c0e46b的树等于基础head。仅恢复中断的GET观察，没有rerun/dispatch；main完整保护、其他设置、默认token read前后不变。
- 原13项按用户本轮授权另存 feature，10项发布文件与独立基础逐项同hash，三份交接补充本轮事实且保留自动格式化，不stash/丢弃。新 feature head 的真实CI结果另见 config/p6-release-bootstrap/evidence/；不能以PR4/main或旧c89检查代签新功能head。
- 下一步须另行授权PR #4 Ready/保留历史合入main，并在新main CI通过后决定一次publish=false真实build-only。P6-R02仍缺人工合并/main CI；R03～R08、上游写入/定时及P5仍独立待办。发布与操作指南和DEVELOPMENT13继续有效，不索取DockerHub Token。

### P6 第十小步：Docker Hub 发布基础（历史本地开发；实际提交/PR以上方为准）

- 新增 fork-release.yml（main-only 手动控制器，默认 build-only）与 fork-release-tag.yml（自有 fork-vX.Y.Z tag 仅通知 main，不 checkout/执行候选代码、不接触注册表凭据）。实际发布须 Repository variable DOCKERHUB_RELEASE_ENABLED=true、精确版本、首次 run 及受保护 dockerhub-release Environment；本轮不配置这些外部项。
- 独立 Dockerfile.fork 保留原上游 Dockerfile/工作流，固定同 Alpine Node24.22.1 基础镜像多平台 digest、pnpm10.34.9/GPL-3.0-only。白名单 Git 对象导出 context，只复制已提交源码；拒绝符号链接、环境/私有配置和宿主 .next/node_modules。不改导航、认证、Widget、依赖/锁文件或既有 fork-ci 定义/pin。
- 无注册表凭据的 build job 重新安装/Lint/测试/应用构建、双架构 OCI 构建与 Node 运行时结构冒烟。publisher 只执行 main 的 stdlib 控制器，核对同 job artifact ID/归档 SHA256、main/tag/祖先与镜像标签，不重建；Token 只用内存 FD，不写 argv/env 子进程或具名凭据文件。已有版本/SHA 标签或未知状态失败，不自动重试写入/覆盖。真正不可变仍需 Hub 服务端策略兜底。
- 新增 66 项发布策略测试，含真实隔离 Git/二进制 context/内存 FD 和模拟 registry/Skopeo。最终 frozen/offline install、Lint、187 项工作流测试、587 文件/2416 项全量测试与隔离应用生产构建通过；仅两条既有警告，未弱化测试。主动诊断最终6 confirmed clean、2 Docker路径unsupported、publisher及4份Markdown共5 inconclusive，详见 DEVELOPMENT 10.5 与 config/p6-release/evidence/，不把空诊断计全clean。模拟通过不证明实际 Skopeo/OCI/Hub。当前无 Docker/Podman，Dockerfile 无语言服务答复，不冒称容器验收完成。
- 操作与权限说明见[发布指南](docs/more/fork-release.md)。DEVELOPMENT 第 13 节用固定 ID 跟踪剩余阶段/依赖/授权与完成证据，替换已过期的“下一步先同步 main”。PR #1 保持 Draft，不因流水线开发而上线导航功能。

### P6 第九小步：功能分支保留历史同步 main（历史；已推送且新 CI 通过）

- 上轮三份交接已单独提交/推送为 aba75941，其真实 CI run 42464356595/check 128680299573 第一次成功，精确 head、App 15368 和全部步骤已核实；这仅作本轮基线，不替代后续新 head CI。
- 只读预演 feature aba75941 与 main57acb02c 得到 clean-merge、无冲突。纯 merge 提交 d34ccc1b 的双父顺序为 aba75941、57acb02c，树 a2853c2d77dfd766502b5aad51a95865e1a9d9ba 与预演完全一致；内容仅新增 FORK_AUTOMATION.md，没有业务、认证、Widget、依赖/锁文件、Docker 或工作流定义变更。不 rebase/squash/force，也没有将功能 PR 合入 main。
- 在真实 d34ccc1b 提交上 frozen/offline install、Lint、3 文件/121 项工作流测试、586 文件/2350 项完整测试、隔离虚构配置生产构建及两份 Node/一份 Bash 语法检查首次全部通过；仅两条既有 vi.unmock 警告，未改认证测试、断言、超时或并发。没有运行浏览器或恢复临时实例，本轮不能补签 P5。
- 必要交接独立文档提交，并在 FORK_AUTOMATION.md 标明基础 PR 历史说明，避免将其 2023 项测试或“不含导航”误当当前功能分支状态。提交前静态/链接/范围检查及推送后精确 head、Fork verification/App 15368、PR 测试快照和全部步骤的核查结果，见 config/p6-feature-sync/evidence/；Markdown 无语言服务答复须记 inconclusive，而不是 clean。
- 本轮只授权同步当前 Fork main 到功能分支、必要交接及验证后推送。不运行写入控制器、不创建 opt-in 变量、不合并 PR #1、不发布部署；真实上游写入演练、workflow-file 权限、每周调度实证、P5、GHCR 双架构与回滚仍未完成。下一步按新的单独授权处理，不能伪造上游更新或直接换 PAT/App。

### P6 第八小步：main 入口与一次只读预检（历史记录；当前以上方为准）

- 用户明确授权仅将基础 PR #3 标记 Ready、以 merge commit 合入 main，源分支保留、不改保护、不动 PR #1；main 自动 CI 通过后，只手动运行一次 fork-upstream-sync.yml，只读失败即停、不自动重跑。已披露 main 会带入每周只读预检配置；写入同步定时仍关闭。
- 合并提交 57acb02c 的父精确为旧 main 2e5f1013 和基础 c64db269，树 12bdba3a121815817cacf01386f02d76d3a0a3b0 与已审基础 head 相同，19 文件 SHA256 逐项复核；没有导航、认证、Widget、依赖/锁文件或 Docker 变更。
- 新 main 的 [自动 push CI run 42452955655](https://github.com/kanon-H/homepage/actions/runs/42452955655) 第一次 completed/success，check 128645880913 的名称 Fork verification、App 15368、精确 main SHA 与全部步骤核实；不是沿用 PR 快照或旧 head。观察器一次网络断连仅重读，未 rerun CI。
- [只读预检 run 42454077403](https://github.com/kanon-H/homepage/actions/runs/42454077403) 仅 dispatch 一次、attempt 1，全步骤成功。真实 job 日志报告 main=57acb02c、官方 refs/heads/main=2e5f1013、mode=read-only-preflight、outcome=up-to-date、candidate_tree_sha=null、conflicts=[]。日志 GITHUB_TOKEN 权限为 Contents/Metadata read；签名日志跳转不转发 Authorization，不保存签名 URL。
- 现有两项设置保持开启、默认 token 仍 read，完整 main 保护/其他策略未变；FORK_UPSTREAM_SYNC_ENABLED 变量不存在，写入控制器 run 和同步 ref 均为 0。本轮不证明真实更新 PR/CI 写入、workflow-file 写权限、冲突 Issue 或每周定时实际触发；不能把 up-to-date 当写入正例。
- 仅 fetch 更新本地 origin/main（不写 FETCH_HEAD），不 checkout/移动本地 main，也不 merge 到 feature。功能分支尚缺 main 的 2 个提交，需后续单独授权同步并重跑 CI；6f9d53c3 的旧绿色不代签新 main 基线。原 PR #1 未合并。
- 证据在 Git/Docker 忽略的 config/p6-main-entry/evidence/：merge-before/response/verification、main-ci-verification、readonly-dispatch-intent/status/verification、readonly-job.log、completion 等。三份交接此前仅在原工作树本地更新；用户现另行明确授权，仅将其提交/推送当前 feature 分支，实际结果以 Git log/远程为准，新 head CI 必须另行核实。本次不包含将 main 合入功能分支或运行写入控制器的授权。
- 下一步先确认保存交接及将 main merge 到功能分支的范围；真实写入控制器演练、写入定时、主 PR #1 合并、P5 和镜像/回滚仍独立待办，不替换 PAT/App 或造假上游更新来凑正例。

### P6 第七小步：独立自动化基础 PR 与最小外部设置（历史准备记录；当前以上方为准）

- 新建 [Draft PR #3](https://github.com/kanon-H/homepage/pull/3)：chore/fork-automation-bootstrap → 本 Fork main。以纯 main 2e5f1013 为父，只提取 feature@27139eba 的 18 个自动化文件，加自包含 FORK_AUTOMATION.md，共 19 文件；不包含导航功能、认证、Widget、依赖/锁文件或 Docker 改动，不带功能分支祖先。
- 原 main 基线 frozen/offline install、Lint、573 文件/1902 测试及隔离构建通过；独立基础补丁为 3 文件/121 工作流测试、576 文件/2023 完整测试和生产构建通过，仍为两条既有 vi.unmock 警告。不要套用功能分支 2350 项计数。新交付 10 文件主动诊断 9 confirmed clean、1 Markdown inconclusive；Shell 用 bash -n，Prettier 无 Shell parser 的工具错误保留，未改源码或测试掩盖。
- c64db269 的 [真实 CI run 42385579913](https://github.com/kanon-H/homepage/actions/runs/42385579913) 第一次 completed/success；check 128442134396 的 name/App 15368/head 与全部步骤均核实。实际 PR 测试快照 83b939067b8229d50f8d33a09fa74356e6b20c9b，API 树 SHA 等于基础 head 的树，不是已合入 main。
- 两项设置已写入并读回：can_approve_pull_request_reviews=true、has_issues=true；默认 token 仍 read。完整 main 保护、其他仓库/合并策略、main 和原 PR #1 前后不变。FORK_UPSTREAM_SYNC_ENABLED 变量不存在且未创建；没有同步 dispatch、定时启用或生产操作。
- 新基础分支、远程引用和隔离工作树一致且干净，工作树位于 config/p6-bootstrap/worktree。原 feature 的 [run 42367180998](https://github.com/kanon-H/homepage/actions/runs/42367180998) 亦已核实成功；交接此前仅在原工作树本地更新；用户现另行明确授权将三份交接提交/推送当前 feature 分支，实际结果以 Git log/远程为准，新 head CI 需另行核实，不沿用旧绿色结果。不改业务、设置或基础分支。
- 所有证据在 Git/Docker 忽略的 config/p6-bootstrap/evidence/：verification、settings/before/after/verification、bootstrap-pr、bootstrap-ci-verification、completion 等 JSON。CI 观察首次 GET 网络瞬断，仅只读重试，无重复设置/建 PR 或 CI rerun。凭据仅在内存，未进入 Git。
- 下一步须单独授权审查并将基础 PR #3 标记 Ready、以 merge commit 合入 main；之后默认入口的手动预检/真实同步演练、workflow-file 写入边界与定时启用仍需分别确认。P5、主 PR #1 合并、镜像发布/回滚均未完成，不能把基础 PR 的绿色 CI 当成同步端到端完成。

### P6 第六小步：上游同步写入流程（历史交付；当前以上方为准）

- de867208 的 [Fork CI run 42351647910](https://github.com/kanon-H/homepage/actions/runs/42351647910) 已只读核实 completed/success；check 128340874058 的名称、App 15368、源码及全部步骤成功。主 PR #1 仍 open/draft、未合并、auto_merge=null，main 仍 2e5f1013；这不是本轮未提交代码的远程 CI。
- 新增 `.github/workflows/fork-upstream-integrate.yml` 和 stdlib 脚本 `scripts/fork-upstream-integrate.mjs`。只在可信 main 执行；手动须选 create_pr=true，定时须仓库变量 FORK_UPSTREAM_SYNC_ENABLED=true（缺省关闭）。本轮不设置变量或启用调度。只读预检工作流仍不具备写权限。
- 对象级合并后构造真实的双父提交（Fork main、官方 main），不切换工作区、不运行合并树代码。仅向固定 Fork 的 sync/upstream-main-完整上游SHA 分支做非 force push，创建 Draft PR；不合并、审批、发布或删除。Token 只在内存、Git 子进程临时且 URL 限定的 header 中，不进入参数/配置文件/错误输出。
- 同 SHA 的已知分支/PR/CI 可复用；人工修改、main 过期或未知树/父提交则停下，不覆盖；关闭未合并的 PR 视为拒绝，同一时间不另开其他上游 PR。冲突/失败创建或复用机器人 Issue，通知失败明确报告 unconfirmed；不承诺邮件送达。
- CI 显式 dispatch 到同步分支，不依赖 GITHUB_TOKEN 推送/PR 事件。先验证 main CI 的固定 SHA256、候选中定义未改和默认入口 active，再验证 run/分支/head、job/check URL 与 App、结论和关键步骤；不把树或 caller main 的检查冒充 PR head。机器人意图评论先于 dispatch 持久化；未知响应或有意图无 run 时不盲目重发，需人工检查。
- 补充仅接受有/无 .git 后缀两种规范 Fork HTTPS origin：既有真实 checkout 日志证明 actions/checkout 实际用无后缀 URL，旧预检的精确字符串判断会误拒绝。没有放宽主机、协议或目标仓库；原 Git 隔离选项/环境抽成共用导出，预检仍只读。
- 新增同步测试 56 项，另加 1 项 checkout origin 回归。最终 frozen install、Lint、3 文件/121 项工作流测试、全量 586 文件/2350 测试、隔离生产构建和两个脚本 Node 语法检查通过。主动诊断 8 文件：4 confirmed clean、4 inconclusive（3 Markdown 无答复、1 push-only/silent-on-clean），不称全 clean。证据在 Git/Docker 忽略的 config/p6-integrate/evidence/。基线及首次全量都曾出现既有 auth-boundary 的 5 秒导入超时，原样复跑通过；未改认证测试、断言、超时或并发配置。
- 本轮已获八个交付文件的提交/推送授权；远程同步仍待：main 默认入口的受控集成、Actions 创建 PR 开关和 Issue 能力核查、获授权的手动实跑，然后再决定启用定时变量。目前没有真实新上游更新 PR/dispatch 的端到端证据，不能称自动同步已在运行。仅支持内置 GITHUB_TOKEN；换 App/PAT 必须重审事件/身份边界，不直接替换。发布/回滚与 P5 剩余验收仍未完成。

### P6 第五小步：只读上游 main 预检（历史交付；当前以上方为准）

- c40d9eb6 的 [Fork CI run 42217278462](https://github.com/kanon-H/homepage/actions/runs/42217278462) completed/success，check 127890320033 的名称、App 15368、head 和全部 job 步骤均核对成功，不沿用旧 head 的状态。主 PR #1 仍 Draft/未合并。
- 新增 `.github/workflows/fork-upstream-sync.yml`，当前仅 weekly/manual 的只读预检：本 Fork main 条件、事件确切 SHA、完整历史、固定 Node 24.22.1、contents: read、无凭据持久化，无发布/PR/推送权限。文件现按随后授权随代码提交/推送功能分支，结果以 Git log/远程为准；仍未合入 main，未验证此预检的远程调度运行。
- 新增 `scripts/fork-upstream-preflight.mjs`：固定官方 HTTPS main，只获取观察到的 SHA 的对象，不取 tags、不写 FETCH_HEAD/refs；通过 Git 2.38+ merge-tree 计算合并树，不 checkout、不建分支/提交、不执行上游脚本/hooks。冲突或无共同历史失败；树 SHA 不是可供 CI 测试的提交，冲突时不输出可发布候选树。
- 子进程不继承 GitHub Token/Git 认证/全局配置，拒绝本地自定义合并驱动、过滤器、URL 重写等配置；只输出受控错误码，不回显 Git stderr 或环境。不会读取用户 YAML 或更改导航/认证/Widget。
- 新增 35 项测试：受信事件/来源/SHA、防误调用、真实 Git 的分叉/冲突/无共同历史/dirty 文件保护、对象抓取不改 refs/index/FETCH_HEAD、hooks/驱动与 URL 重写拒绝；两份 workflow 测试共 64 项通过。
- 实际只读访问官方 main，观察 SHA 为 2e5f1013，与 Fork main 相同，结果 up-to-date；HEAD/refs/index/worktree/FETCH_HEAD 前后比对完全不变。冲突等情形有真实 Git 合成 fixture 证据，不声称实际有上游更新或已生成同步 PR。
- frozen install、Lint、585 文件/2293 测试、隔离生产构建通过，仍仅两条已有 vi.unmock 警告。依赖/锁文件及业务代码未改，无新工具下载。证据在忽略的 `config/p6-sync/evidence/`；新工作流/脚本/测试 3 文件主动诊断 confirmed clean，3 份 Markdown 无语言服务答复为 inconclusive，不计 clean。
- 完整自动同步仍待：bot PR 幂等/冲突通知、保留祖先的真实 merge commit、明确 CI dispatch/head 关联及结果处理。只读预检不算其完成；Actions 创建 PR 开关本轮只读核查仍为 false，main 尚无专用 CI 入口，外部设置/默认分支集成另行授权。镜像发布/回滚未开发，P5 仍暂停。

### P6 第四小步：失败 CI 隔离负例（历史验证记录）

- 临时 [PR #2](https://github.com/kanon-H/homepage/pull/2) 基于已知绿色的远程 8e633e62；相对该正例只改 `.github/workflows/fork-ci.yml`，在 checkout 前加固定 exit 42 步骤。Node/YAML 结构比较确认触发器、权限、原步骤等均未变；应用、依赖/锁文件及用户配置不改。
- 临时 head=`1ed37174f0eaf39004b657665ed552df06a98c70`；[run 42214850900](https://github.com/kanon-H/homepage/actions/runs/42214850900) 实际 failure，check_run 127882191736 为 `Fork verification` / App 15368，源码匹配。唯一失败步骤是预期注入点，注解明确 exit code 42，原安装/Lint/测试/构建步骤全部 skipped；这不是应用回归或一次新的完整测试通过。
- 验证时 PR 非 Draft、Git mergeable=true（无冲突）、auto_merge=null、未合并，GitHub 的 mergeable_state 明确为 **blocked**。main 的唯一必需检查/来源和其他保护前后完全一致；不是用 Draft 阻止合并来冒充 CI 负例。
- 验证后已关闭 PR #2（未合并）、删除临时分支，并用 GET 确认引用不存在。main 仍 2e5f1013、远程 feature 仍 8e633e62、本地仍 2b18802f，主 PR #1 保持 Draft；没有调用任何合并 API。
- 状态/验证/退出码/清理证据在 Git/Docker 忽略的 `config/p6-remote/evidence/gate-negative/`；凭据仅在内存。不独立测试“检查完全缺失”、过期分支及其他绕过场景，不声称实际调用合并 API 遭拒。
- CI 基础正例、必需检查绑定和本次失败检查的 blocked 状态已取得证据；P5 完整验收、上游同步、镜像发布/回滚仍待办，不自动合并主 PR 或进入发布。

### P6 第三小步：绑定 main 必需检查（历史配置记录；当前以上方为准）

- 最新 [Fork CI run 42209452117](https://github.com/kanon-H/homepage/actions/runs/42209452117) 对 head `8e633e62…` 第一次运行 success，全部步骤成功；实际 job 日志再次确认 584 文件/2258 测试、生产构建成功，测试 PR 合并快照为 `7101527c19b355a31795e3882e2f6c427474b4cd`，不是沿用 12116208 的旧结果。
- check_run `127864197191`：`Fork verification`，来源 `github-actions` App `15368`，head_sha 精确匹配 8e633e62。main 现要求此检查及来源，strict=true，需与最新 main 保持同步；完整保护和独立 required_status_checks GET 均已确认。
- 首次局部 PATCH 返回 404“Required status checks not enabled”。先 GET 比对确认保护完全未变，再使用原配置完整保留的 PUT 首次启用；之后逐字段比较，除 required_status_checks 外全部不变。不将失败请求盲目重试或覆盖其他规则。
- 必须 PR、零强制审批、管理员受约束、禁止强推/删除、不要求线性历史和允许 merge commit 等保持原状。main 仍 `2e5f1013`；[PR #1](https://github.com/kanon-H/homepage/pull/1) 仍 open/draft、merged=false、auto_merge=null。
- 脱敏前后配置、写入策略和新 job 日志在 Git/Docker 忽略的 `config/p6-remote/evidence/main-gate/`。下载日志首次 TLS 握手超时，只重试 GET 后成功，不关闭 TLS 校验、不转发凭据给签名下载地址；无重复设置写入。
- 已验证：真实绿色 CI 与检查来源、正例关联、保护配置生效和其他规则不变。**未验证：失败/缺失检查的实际阻断负例**；没有调用合并 API，也没有新建测试分支/PR。不能把配置读回或 Draft 状态当成负例通过。
- 下一步可在另行授权后做隔离负例，创建临时测试分支/PR、读取 blocked 状态并清理，绝不合入 main。P5 完整验收、同步、镜像/回滚仍待办，三份交接现按用户随后授权仅本地提交，结果以 Git log 为准，未推送。

### P6 第二小步：Fork PR 与真实 CI（历史首次验证；当前以上方为准）

- [PR #1](https://github.com/kanon-H/homepage/pull/1)：`kanon-H/homepage:feature/multi-address → kanon-H/homepage:main`，不是向官方提交。保持 open/draft、merged=false、auto_merge=null；正文明确 AI 辅助及 P5 未完成项，不冒充完整 v1 验收。
- [Fork CI run 42205861009](https://github.com/kanon-H/homepage/actions/runs/42205861009) 第一次运行完成 success；工具版本/SHA 核对、frozen install、Lint、584 文件/2258 测试、隔离生产构建及清理步骤全部 success。测试数量与生产编译成功也由实际 job 日志核实，不是沿用本地报告推断。
- PR/head 为 `1211620882e860bb64cc621ed3d7e62a984ad552`；job 日志确认实际 checkout/测试的是 GitHub PR 合并快照 `01198d99b6bb75b81c2fbd3c6ff194aa59a28344`。这是 refs/pull 的测试快照，不代表已合入 main。
- 真实 check_run `127852191491`：name=`Fork verification`，app=`github-actions` / ID `15368`，head_sha=`12116208…`，completed/success。未来绑定 main 使用远程确认的检查名/App，不能把显示路径 `Fork CI / Fork verification` 随意当成另一个 context。
- API 复核 main 仍为 `2e5f10134ae3961bb936d3e7c441f9a1f4a4bf4f`，required_status_checks=null；管理员约束、禁止强推/删除等基础保护保持原状。本轮没有保护规则/Actions 设置/Secrets 写入，没有重新跑 workflow 或发布镜像。
- Actions 已启用、默认 token 为 read，现有凭据仅内存调用 API。旧 Lint/Tests/Docs 的 PR job 按官方条件 skipped；base/main 的 anti-slop 与 Auto Label PR 实际运行 success，未关闭 PR，未擅自暂停机器人。这不是保证以后都不会干预。
- API GET 一度网络失败，仅只读复查后恢复，无重复建 PR。脱敏快照和 job 日志仅在 Git/Docker 忽略的 `config/p6-remote/evidence/`；不向下载日志的跨域签名地址转发 GitHub 凭据。
- 下一步仍需另行授权绑定 main 必需检查并验证门禁；P5 剩余验收、同步、镜像发布和回滚未完成。后续若提交新源码/文档，必须核查新 head 的 CI，不能继续套用这次 12116208 的绿色结果。

### P6 第一小步：Fork CI 基础（历史实施记录；当前以上方为准）

- 新增 `.github/workflows/fork-ci.yml`：仅本 Fork 的 main PR、main push、手动触发；固定 Ubuntu 24.04 / Node `24.22.1` / pnpm `10.34.9`，按顺序 frozen install、Lint、Vitest、生产构建。单 Job 名为 `Fork verification`，真实必需检查名称/来源仍须远程读取确认，尚未绑定保护规则。
- CI 只有 contents: read；Actions 使用上游已有完整 SHA，checkout 使用事件的确切 SHA 并核对 HEAD，persist-credentials=false；不读取自定义 Secrets，无 Codecov、共享缓存、产物上传、镜像登录或发布权限。构建失败不会 continue-on-error。
- 新增 `scripts/fork-ci-build.sh`：随机临时目录中的虚构多地址 YAML、仅子进程环境中的随机密码/认证密钥，强制生产构建；成功和失败均清理临时配置。检测到 Next.js 会自动加载的 `.env` / `.env.local` / `.env.production` / `.env.production.local`（含符号链接）时拒绝，不删除用户文件。不启动实例或浏览器，不依赖 config 下的私有基线工具。
- 9 份继承工作流仅增加官方仓库 job 门禁，阻止 Fork 重复跑原测试/Codecov、Crowdin、PR/Issue 关闭机器人、Release Drafter 等；既有 Docker/Docs 已有官方条件，保持不动。Crowdin 的原 paths flow-list 被 js-yaml 5.5 拒绝，改为等价 block-list，路径值不变。本轮现获授权随 P6 提交推送这些门禁；尤其 pull_request_target 仍读取 base/main，首次 PR 前可能须另行授权暂停旧机器人，不能认为功能分支的改动已经改变 main 的远程行为。
- 新增 `src/__tests__/workflows/fork-ci.test.js`，29 项测试覆盖触发/权限/版本/源 SHA、全部 11 份上游工作流 job 条件，以及 mock pnpm 下的配置/认证隔离、失败退出码、清理和 4 种 .env 拒绝。mock 测试不算实际生产构建。
- 本地 frozen install、修改前 Lint/583 文件/2229 测试通过；修改后 Lint、584 文件/2258 测试及实际 `bash scripts/fork-ci-build.sh` 生产构建通过。仅两条已有 vi.unmock 警告；未改业务、认证、依赖/锁文件、Dockerfile 或本地 Git/GitHub 设置。命令与证据见 DEVELOPMENT 第 10 节及忽略的 `config/p6-baseline/evidence/`。
- 不新增 source_sha 复用入口：checkout 另一个 SHA 不会自动改变 GitHub check_run 所属提交。后续同步拟显式 dispatch CI 到同步分支，核对实际 head_sha、分支和运行结果；当前未实现同步工作流，也未解决/宣称已解决真实 PR 的检查门禁。
- 新工作流、Shell 脚本和 JS 测试分别主动诊断 confirmed clean；继承工作流保留 7 项既有 zizmor 诊断（3 项 checkout 凭据持久化、4 项危险触发器），均明确 defer 而非 false-positive/suppress，未改上游触发器或添加忽略。Fork 通过 job 条件跳过这些自动化；3 份 Markdown 无语言服务答复，不算 clean。
- shell PATH 未发现 Docker/Podman/actionlint/zizmor，但主动诊断实际调用了托管 zizmor；不再把 PATH 未找到误写成工具完全不可用。未下载工具，未取得独立 actionlint 命令证据。远程 Actions、main 必需检查、上游同步、双架构镜像/可信标签、GHCR 和回滚实演均未完成。本轮不重跑 P5 浏览器/物理手机，不表示完整 v1 已验收。

### 2026-11-06 P0 基础外部设置（已验证）

- 新增官方 `upstream=https://github.com/gethomepage/homepage.git`，fetch refspec 仅 `main`；已 `fetch --no-tags upstream main`，得到 `2e5f10134ae3961bb936d3e7c441f9a1f4a4bf4f`（v2.7.0，与原基线相同）。没有 checkout、merge、rebase 或更新本地 main。origin 与两个本地分支的跟踪关系保留不变。
- 官方 GitHub 当前默认仍是 dev；我们明确选择稳定 main 作来源，本地 upstream/HEAD 指向 upstream/main，不将官方默认分支误当成需要跟踪的开发分支。
- Fork `kanon-H/homepage` 的 GitHub 默认分支从 dev 改为 main；REST API 与 `git ls-remote --symref origin HEAD` 均确认 main。本地 origin/HEAD 已刷新为 origin/main。
- main 基础保护已由 API 重新读取确认：必须 PR、required approvals=0（个人可自行合并）、enforce_admins=true、禁止强推/删除、不要求线性历史；allow_merge_commit 仍 true，squash/rebase 仓库开关保留原值。未执行任何 PR 合并。
- **P0 当时未绑定必需 CI**（required_status_checks=null），按用户确认留给 P6。本轮 P6 已按最新授权绑定真实检查及 App，当前配置以上方第三小步为准，负例仍未演练；不把 P0 基础保护当作当时已完成 CI 门禁。
- P0 配置时 main/origin/main/upstream/main 保持 `2e5f1013`，二开位于 feature 分支 `d5ade7b6`；后续 P0 文档提交不等于把二开合入 main。
- 复用现有仓库 Git 凭据，仅在内存使用 API 认证，无新凭据或安装工具。初次 GitHub PATCH 返回 500；先用 API/传输确认仍是 dev/未保护，再原样重试成功，未盲目覆盖现有规则。脱敏审计在 Git/Docker 忽略的 `config/p0-external/evidence/`，不提交凭据或原始配置。
- 上轮手工测试实例已按原期限自动停止（status=expired，监听已消失）；未重启/续期，手机兼容排查继续暂停。

### P5 已交付与未完成记录（历史交接；当前 P6 以上方为准）

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

仍未完成：红米链接打开方式差异、手工中键、完整键盘焦点/Widget统计交互等未覆盖场景、物理触屏剩余项目、实际 OIDC（如使用）及目标生产反代/CDN 验收。无头 Chromium/本地 nginx 不代替这些证据，SPEC 完成定义仍未全部满足，P5 完整验收及 v1 不能宣称完成。P0 基础外部设置已按上方补齐，必需 CI 绑定仍待 P6；P6 未执行，P5 完整验收未完成。上轮只提交/推送 P5 已完成成果，本轮 P0 交接已获随后明确提交/推送授权，未发布或生产部署。

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

按DEVELOPMENT14的正式路线，下一步仍是单独授权审查PR #4、Ready/merge commit入main并核新main CI（F01），再获准执行无Hub凭据的真实build-only及补足HTTP镜像验证。非手机P5和其它必需验收需完成；随后同步最新main到feature、核最新CI，再单独决定PR #1合入main，对最终含导航源码的同一正式OCI归档重新验证。用户已明确不采用直接合PR #1的更快/预览路线。仅P5手机兼容延期，其他未完成项保持待办，不假定豁免；上游无真实更新时也不能把no-op算写入验收。Docker Hub Token由用户自己在Environment设置，不进聊天。本轮只是规划提交/推送，不执行F01或恢复实例。下列非手机验收按设备/目标环境与后续授权执行，手机项目继续延期：

1. 已取得上述 macOS 两浏览器 8 项基础反馈（含原生右键/Shift 与 Cmd-click）；下一步按[人工验收模板](docs/more/network-acceptance.md)补非手机的完整键盘焦点/Widget统计等场景，实际手机触屏/兼容项继续延期。当前设备没有中键记为未执行，不改成通过；未报告的 OS 版本/viewport 不推断。
2. 如实际使用 OIDC 或生产反代/CDN，另行明确授权和目标，再验证真实登录/退出、HTTPS/canonical URL 和匿名缓存隔离；本轮只验证受控 nginx，不操作生产。
3. 使用说明在 `docs/configs/network.md`；按需复跑 `scripts/network-acceptance.py --build --insecure-http ...`。不得跳过 SPEC 的手工完成定义，不自动提交、推送、发布或部署。

内部约定：default 的 `label: null` 用 i18n；候选为 `{ id, label, href, current }`，fallback 说明取解析结果。菜单状态只在当前 NetworkProvider 内，不读写偏好；新菜单使用记录身份隔离旧关闭任务/复制结果。getServiceSearchEntry 始终接收原始服务。

P0 基础外部设置已按本轮授权完成；GitHub 默认 main 和本地 origin/HEAD→origin/main 均已验证，初始 dev 快照仅是历史。CI 必需检查已绑定，配置/绿色正例及真实失败检查的 blocked 状态已验证；检查完全缺失等其他场景未独立演练，不扩大结论。不要一口气改全部页面和 CI；每阶段有证据后再更新状态。

## 容易踩坑的关键点

1. `SettingsProvider` 初始为空，`Home` Effect 才注入配置。Provider 设计应接收首页真实 initialSettings，不能先写默认偏好覆盖已有选择。
2. 卡片图标和标题有两处 href；QuickLaunch 是另一条导航链，不能漏掉。
3. 原始 href 不变；Widget URL、ping、siteMonitor 与浏览器导航模式无关。
4. 规范使用 `extensions.network`，保留 `default` 模式；旧配置不启用扩展。
5. v1 书签不做多地址，搜索引擎/访问 URL 也不套用模式规则。
6. 卡片含 `overflow-clip`，菜单要避免裁剪；右键不能覆盖 Widget/统计区域操作。
7. 恢复前不让可扩展服务误开默认地址；存储失败仍要完成 ready。
8. `/api/validate` 现有错误会阻断首页，不应直接塞入非致命网络警告。
9. 上游镜像任务限定官方仓库；Fork 使用独立 Dockerfile.fork，从允许的 Git 源码重新构建，不走上游 CI=true 的宿主预构建路径。
10. GitHub GITHUB_TOKEN 创建 PR 后不一定触发其他普通工作流，自动同步须验证 CI 确实被触发。
11. 继承 CI/原 Dockerfile 的工具版本差异仍保留；Fork 镜像独立固定 Node/pnpm/base digest，不宣称整个上游已统一或位级可复现。
12. 原 Dockerfile 的 Apache label 未改；新 Fork 镜像采用与根 LICENSE 一致的 GPL-3.0-only 并带 LICENSE，不能选错 Dockerfile 发布。
13. 普通 .env 不保证被 Git 忽略。Fork context 采用 Git 对象白名单和专用 ignore 双重排除，但不能把已经公开提交的任意文件内容自动判定无秘密；审查仍必需。
14. 所有“功能完成”“测试通过”“发布成功”必须附实际证据，不能从文档推断。

## 后续交接如何更新

每次开发结束，更新本文件的当前阶段/状态和实际验证摘要，保留历史事实与计划的区别。若接口行为发生变化，同步更新 SPEC；架构变化同步 DESIGN；工具、流程、命令变化同步 DEVELOPMENT。不要把 AGENTS 扩成不断增长的运行日志。
