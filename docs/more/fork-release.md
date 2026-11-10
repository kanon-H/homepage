# Fork 镜像发布与回滚（Docker Hub）

> 本文随 Fork 发布基础交付，实际分支、提交与 PR 状态以 Git/GitHub 为准；工作流存在、策略测试或普通应用 CI 成功都不等于镜像已构建或发布。
>
> **当前发布平台仅为 `linux/amd64`。** arm64 在 GitHub Actions 的 QEMU 下编译 Next.js 会 `SIGILL` 崩溃；同一源码在私有 Docker 主机上 arm64 构建成功，故这是模拟环境限制而非代码问题。恢复 arm64 应先实施 `BUILDPLATFORM` 交叉编译并另行验证，不得靠重试或降级断言绕过。平台集合由 `scripts/fork-release.mjs` 的 `PLATFORMS` 唯一决定。

## 0. 本次目标：正式多地址镜像，不走预览捷径

用户最新决定：除P5实际手机兼容验证延期外，完成其余必需工作后发布正式版。手机浏览器新标签/原页及实际触屏布局的已知差异继续保留为延期未完成，不宣称手机已通过，也不修改target/rel来掩盖差异。桌面中键/完整焦点与Widget交互、适用的认证/Host/目标缓存、真实镜像验证不获豁免；N/A须用户确认适用范围。

继续原顺序：先独立发布基础PR #4入main和基础验证，再补其余验收、将最新main合入feature并审查导航PR #1，最后对含导航的正式main源码/同一发布归档重做门禁。**不直接合PR #1赶发预览版，也不把无导航的基础镜像当正式成果。** 正式版本号与发布操作另行确认；现有fork-vX.Y.Z示例不是已经决定或发布的版本。完整固定ID与F01～F12执行表在功能分支的DEVELOPMENT13～14，规范延期范围在SPEC12.1。

已提交的发布基础仅有Node结构冒烟。最新本地F03工具已接入HTTP/登录/挂载等必经验证，但尚未提交、进入独立PR #4/main或真实Docker实跑。native standalone的103项检查只能证明直接HTTP逻辑，不是两平台容器、OIDC/HTTPS/CDN或完整P5结果；不能仅开发布变量就声称全部完成。所有Git/Actions写入仍须明确授权；HTTP工具完成不自动授权凭据配置、镜像推送或部署。

## 1. 信任边界与流程

仅用于 `kanon-H/homepage`，不启用继承的官方 `docker-publish.yml`，不向 GHCR 登录。

1. 在 main 手动运行 **Fork Docker Hub release**，默认 `publish=false`、版本留空：只验证当前 main，**不需要 Docker Hub 凭据**。
2. 版本必须是已存在且属于 main 历史的 `fork-vX.Y.Z`，不接受任意分支/SHA、上游 `v*`、预发布后缀或 `latest`。版本源码的发布关键文件必须与当前 main 一致；老版本没有发布基础、或发布基础发生变化时拒绝。
3. 自有标签 push 的 **Fork version tag notification** 不 checkout 或执行标签代码，不接触注册表凭据，只向 main 的发布控制器发一次 dispatch。HTTP204 仅说明请求被接受，需查看另一个发布 run。拒绝 rerun 通知任务；未知响应先查询实际 main runs，不盲重发。
4. main 控制器核对事件/工作流来源、实时 main、标签实际 commit 和祖先，固定官方 main 只读查询并记录共同上游基线。规划和发布前分别读取 main/tag，检测到改动则停止；不是自动追最新提交，也不是跨 GitHub/Hub 的原子事务，仍需不可变版本标签规则兜底。
5. 无注册表凭据的 build job：精确源码/Node/pnpm、frozen install、Lint、全量测试、隔离应用构建；从 Git 对象导出允许文件组成 context，再按 `PLATFORMS`（当前仅 `linux/amd64`）构建，禁止复用宿主 `.next`/node_modules。输出 OCI archive。
6. 上传前核查平台集合与版本/源码/上游/GPL标签。fork-image-smoke先固定归档SHA，再从同归档按 `PLATFORMS` 逐个导入，做Node结构检查并启动真实应用；每个平台检查默认root+/app/config及PUID10001/PGID10002+/config，必须完成健康、PID1身份、卷读写、HTTP密码登录/退出、Host、匿名与私有缓存和SSR/API/Next数据一致性。归档前后SHA不变才继续上传。此代码已受审进入main并在真实双架构归档上验证过四种组合；**不替代物理ARM、OIDC、HTTPS/CDN、真实NAS文件系统或P5人工验收**。
7. publisher 等待 `dockerhub-release` Environment；只运行 main 控制器，不安装应用依赖、不重建、不执行 artifact 脚本。下载同一 build job 的精确 artifact ID，核对 archive SHA256，再核对实时 main/tag 和镜像标签。
8. Docker Hub 两个目标标签均不存在时，才各 copy 一次：`fork-vX.Y.Z`、`sha-<完整源码SHA>`。不更新 latest、主次版本别名或已有标签。复制后读回 digest 必须与测试的 OCI index 一致，输出 `release.json`。

全部 job 的 GITHUB_TOKEN 默认仅 contents:read；plan/publisher 另有 actions:read，只读核验 Environment 保护，只有无注册表凭据的 tag 通知 job 获得 actions:write。没有 packages:write、生产部署或自动合并权限。内置 token 生成的普通 push/tag 事件不保证触发另一个 workflow；未来若由机器人创建版本标签，应显式调用可信 main 控制器，不能假设普通触发有效。

### 1.1b 第二次 build-only（仍失败，已定位真正根因）

PR #5（`bc7ec5ad`）合入后 main 为 `d67ebbb1`，头尾 CI 均通过，但单次 dispatch run `42615682764` 仍在同一处失败。根因不是 context 选择，而是 **`Dockerfile.fork.dockerignore` 的 deny-by-default**：`**` 排除全部，未显式 `!tailwind.config.js`，因此文件虽在 context 中，Docker 构建时仍被过滤。

修复：`.dockerignore` 增加 `!tailwind.config.js`；测试锁住“deny-by-default 必须显式放行构建所需根文件”“放行项必须真实存在”“`globals.css` 的 `@config` 目标必须已放行”。本地 2458 测试与 Lint 通过，并用 ignore 语义模拟确认必需文件全部进入、无私有/构建产物泄漏。**仍未在真实容器内验证**；重验需另行授权。

main `0d4cfc1d` 上单次 dispatch（`publish=false`、版本空）run `42608235225` attempt1 在 build job 失败：容器内 `next build` 报 `Can't resolve '../../tailwind.config.js'`。白名单 context 漏了 `tailwind.config.js`，而 `src/styles/globals.css` 用 `@config '../../tailwind.config.js'` 引用它。未 rerun、未重新 dispatch、未登录 Docker Hub、未推送镜像，publish job 被跳过。

本地修复：将 `tailwind.config.js` 加入 `scripts/fork-image-context.mjs` 白名单，并新增“与 globals.css 一起导出”的回归断言；现 context 669 文件、无 `config/`，2457 测试/Lint/隔离构建通过。**镜像内构建与本地构建的差异必须靠该回归守护，不能只用本地构建代签。** 重验需另行授权。

- scripts/fork-image-http.mjs使用随机虚构JSON/YAML配置、随机测试密码和Secret；真实配置和生产凭据不进入容器、argv、日志或artifacts。随机测试密码/Secret经Docker stdin提供，不创建环境文件；不继承宿主GitHub/Hub/NextAuth凭据或Docker远程连接设置。
- 端口只映射127.0.0.1随机端口，原生Host校验保持启用。HTTP客户端不使用代理、不跟随重定向、限制响应大小及等待时间；检查Location和Next数据的x-nextjs-redirect，两者存在时均须为同源登录页。
- 结构及配置种子容器禁网；应用使用临时bridge，不是断外网沙箱。使用独立命名配置卷，不挂宿主config、Docker socket或生产数据；不启用privileged/host网络/重启策略。运行后只按唯一label及精确名称清理本轮容器/卷，不使用prune，失败阻止上传。目标NAS绑定卷/反代缓存仍独立验收。
- 每平台每挂载模式仅记录platform/mount/uid/gid/checks/healthy，Cookie保存在内存且退出后不手工清空客户端Cookie来冒充登出成功。HTTP前后按原始字节检查YAML，拒绝挂载未生效或HTTP请求改写配置；浏览器模式切换仍由P5单独验收。
- 当前本机无Docker，native standalone只验证了原生密码和直接HTTP流程；不宣称上述容器门禁已真实执行。新helper已加入RELEASE_FILES，不能选择缺少/改动该控制器的老tag绕过可信main校验。

## 2. 先集成，再配置（均需另行授权）

独立发布基础已经作为Draft PR #4提交，head89f0a542、应用CI通过，仅10个发布文件，无feature祖先或导航。下一步先单独授权审查/Ready/merge #4并核main CI；不重复建立基础PR，不跳到直接合导航PR #1。始终保留merge历史，不squash/强推。

main尚未合入多地址功能时，基础build-only仅验证发布基础，不能推为本次正式多地址成果。非手机验收完成后，需要先同步最新main到feature并核新CI，再单独授权PR #1 Ready/merge；手机延期许可不等于Git合并/Actions或发布授权。

### GitHub 设置（由仓库所有者完成，不把 Token 发给 Agent）

创建 Environment：`dockerhub-release`。

- Deployment branches/tags：选择 **Selected branches and tags**，只添加 type=branch、name=main 一条规则，不使用“所有受保护分支”或通配符，不允许标签。控制器在规划及真正 copy 前通过只读 API 核验该配置，缺失/错误/无法读取都会停止；实际 publisher 始终在 main dispatch 运行。
- 建议至少一个 Required reviewer；个人仓库允许本人审批时不要启用 Prevent self-review。若 GitHub 计划不支持这些保护，先重新评估，不改放到无保护仓库 Secrets 来绕过。
- 把下列凭据放 **Environment secrets**，不要放 Repository secrets 或 YAML：

| 名称                 | 值                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------- |
| `DOCKERHUB_USERNAME` | Docker Hub ID，小写用户名，不是邮箱                                                |
| `DOCKERHUB_TOKEN`    | Docker Hub Access Token，具备目标仓库 pull/push 权限，不用登录密码，不授予删除权限 |

Token 尽量限制目标仓库；若账户方案不能细粒度限制，使用最小权限专用身份。创建 Docker Hub 目标仓库并确认其 public/private 设置。

Repository **variables**：

| 名称                        | 默认/用途                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `DOCKERHUB_IMAGE`           | 可省略，默认 `<DOCKERHUB_USERNAME>/homepage`；组织仓库填小写 `namespace/repository`，不含 registry、tag 或 digest |
| `DOCKERHUB_RELEASE_ENABLED` | 缺省关闭；完成真实 build-only 验收与保护配置后，明确设为字符串 `true` 才允许发布                                  |

还需配置 GitHub 自有版本标签规则，防止更新/删除版本标签；在 Docker Hub 启用版本/SHA 标签不可变策略，禁止覆盖。流水线的“先检查不存在”不是对外部并发写入的原子锁；只有服务端不可变策略和权限隔离才能兜底，不能把预检宣称为注册表强制不可变。首次发布前核实这些设置真实生效。

Docker Hub 密钥只传给 publisher 的一个步骤；Skopeo 使用 Linux tmpfs 中**先 unlink 再写入**的内存文件描述符，子进程通过 `/proc/self/fd/3` 读取。Token 不进入 argv、子进程环境、具名磁盘文件、Docker config、build args 或镜像层。平台不支持 tmpfs/FD 时失败，不回退到持久凭据文件。

## 3. 首次验收与正式发布

按顺序，不跳过；基础验证和最终正式候选验证必须分开记录：

1. 单独授权PR #4审查/Ready/merge入main，核新main精确CI；不沿用旧head绿色，不提前合PR #1。
2. 获准后仅运行main `publish=false`、空版本的构建。记录实际Docker/OCI/Skopeo/context/结构冒烟及archive SHA，不登录或推送Hub；无导航时不能当正式成果。
3. 本地F03已补足可重复HTTP/原生认证/Host/匿名隔离/配置挂载/PUID/健康验证并接入build job；先受审集成最新工具，再在同一真实归档上实跑。当前native103项及模拟Docker测试不能代签容器门禁，未通过不上传归档或进入publisher。
4. 完成非手机P5和适用目标安全验收，保留真实OS/浏览器/设备/配置代号。其它现有必需验收如上游写入/权限/调度或门禁负例也继续逐项给证据；若外部条件不足记阻塞，不能自行N/A或no-op代签。仅手机兼容延期。
5. 保存工作后将最新main保留历史merge到feature，审查二开/发布关键文件和指南冲突；完整回归及新head CI通过后，单独授权PR #1 Ready/merge到main并核main CI。
6. 对最终**含多地址功能**的main源码重新验证 `PLATFORMS` 内的平台和全部适用镜像门禁。正式run中实际推送的**同一OCI归档**必须通过HTTP/认证等检查；另一轮build-only的不同version/created/digest不能代替。失败先修复和受审，不降低断言。
7. 所有者配置Environment/标签保护/Hub不可变策略/目标仓库与最小权限Secrets；在隔离环境用可信基础/旧版与候选演练配置兼容和回退。首次无旧正式版也不能虚构已验旧digest；不操作生产。
8. 预发布门禁完成后，由用户确认正式版本及精确main源、单独授权开启opt-in并创建/推送自有标签（以下只是命令格式示例，不是已选定版本或本文自动执行）：

   ```bash
   git tag -a fork-v0.1.0 <reviewed-main-sha> -m "Fork release 0.1.0"
   git push origin refs/tags/fork-v0.1.0
   ```

   也可在 main 手动选已存在版本标签并显式 `publish=true`。不要对未知结果 rerun 通知/发布；新 dispatch 也是发布操作，须先调查并另行确认。

9. 审批Environment，跟踪main正式run，核对release.json的源码/upstream/version/created、同归档SHA、两个标签/index digest及平台清单；手机延期/已知差异写入发布说明。通知或push成功不等于正式交付完成。
10. 发布后独立客户端实际pull精确digest；public匿名、private目标身份分别按适用范围验证，`PLATFORMS` 内每个平台实际临时运行，并核回退digest可拉取。未完成这些交付验收，不宣布正式版验收完成。发布说明必须写明当前仅提供 `linux/amd64`。
11. 归档非秘密源码/许可、全部验证及失败/回退记录；根GPLv3、GPL-3.0-only标签/镜像LICENSE一致，完整revision可追溯。源配置、Cookie/Session、Token不进记录。

发布控制器同一时刻串行，`cancel-in-progress=false`；GitHub concurrency **不是可靠无限队列**，密集版本事件可能替换 pending run。每个版本都要核实实际 run，不承诺每个标签自动成功发布。OCI artifacts 保留 7 天，发布记录保留 90 天；长期记录由所有者归档。环境中 apt/Skopeo 版本未完全锁定，不宣称位级可复现。暂未启用 SBOM/provenance，后续单独评估，不能声称已签名供应链。

## 4. 失败和部分发布

- 仅显式 `404/MANIFEST_UNKNOWN` 被当作目标标签缺失；401/403/429、网络、坏 JSON、缺仓库/未知状态一律停止，不能当成“空仓库可覆盖”。
- archive 替换、标签/源码/上游/GPL 元信息错误、main/tag 前进、已有标签或 digest 不一致都停止。
- 第一标签 copy 成功、第二标签失败可能是**部分发布**。未知响应也可能已经写入；脚本不自动重试、删标签、覆盖或修补，不把失败 run 标为成功。
- 人工只读核实两个 tag 的 digest、源码和 run，再决定接受完整发布记录、受控补救或新提交/新版本；不盲目重跑，不覆盖旧版本。
- 发布日志可能成功但上传 record 失败，同样先读回注册表并核实，不重复写入；正确归档之前不宣称发布验收完成。

## 5. 回滚（说明，不是自动部署）

预先保存：新旧版本、完整源码 SHA、上游基线、镜像 index digest、平台、配置快照代号和验收摘要；配置及登录密钥不进入 Git/Actions artifacts。

1. 独立验证旧 `<namespace/repository>@sha256:<digest>` 仍可拉取，且与当前配置兼容。
2. 经用户部署授权后，切回旧 digest；不强推 main、不篡改版本标签或 latest。
3. 必要时关闭 `extensions.network.enabled`；原 href、认证、Widget/监控仍保留。当前无数据库迁移。
4. 验证登录/退出、Host/配置挂载、导航和健康状态，记录真实结果；未实演前回滚待办不勾选。
5. 修复发布新提交和新版本。自动流水线**不会重启 NAS/生产容器**。

## 6. 追踪清单

- [x] 发布基础独立Draft PR #4/head89f0a542与对应真实应用CI。
- [ ] 单独授权PR #4 Ready/merge与新main CI；不能直接合PR #1走捷径。
- [ ] main build-only 的实际 OCI 构建、上下文核验和结构冒烟（当前平台集合为 amd64）。
- [ ] 补足并实跑HTTP/认证/Host/挂载/PUID/健康检查，纳入最终同归档发布门禁。
- [ ] 非手机P5、适用目标认证/缓存与其它必需验收完成或记录明确阻塞；只有手机兼容延期。
- [ ] 最新main同步feature/完整新CI，单独审查PR #1合入main。
- [ ] 最终正式候选确含导航，同一正式run/归档已完成全部镜像检查。
- [ ] Environment/main-only/reviewer、Git 标签及 Docker Hub 不可变策略读回。
- [ ] 所有者配置 Environment Secrets/镜像名，单独启用发布 opt-in。
- [ ] 首次真实版本发布、两个 tag/index digest、独立拉取/运行和长期记录。
- [ ] 失败/部分发布与旧 digest 回滚演练（非生产优先）。
- [ ] 需要时补充 SBOM、provenance、签名和原生 ARM 验收。

上游写入/权限/幂等、实际调度及补充门禁未完成时继续记录，不因流水线文件或模拟/no-op通过而完成，也不自动豁免。手机兼容是本次唯一明确的验收延期；SBOM/签名等仍为原后续增强，Gitea仍可选，Skill暂不开发。缺条件先报告，任何范围调整与Git/Actions/发布/部署动作另行授权。
