# Fork 镜像发布与回滚（Docker Hub）

> 本文随 Fork 发布基础交付。实际分支、提交、PR、镜像标签状态以 Git / GitHub / Docker Hub 为准；工作流文件存在、策略测试通过或普通应用 CI 成功，都不等于镜像已构建或已发布。
>
> **当前发布平台仅为 `linux/amd64`。** arm64 在 GitHub Actions 的 QEMU 下编译 Next.js 会 `SIGILL` 崩溃；同一源码在真实 Docker 主机上 arm64 构建成功，因此这是模拟环境限制，不是代码问题。恢复 arm64 应先实施 `BUILDPLATFORM` 交叉编译并另行验证，不得靠重试或降级断言绕过。平台集合由 `scripts/fork-release.mjs` 的 `PLATFORMS` 唯一决定。

## 0. 两种发布模式

本仓库保留**两套并行的发布方式**，产物语义一致（同一镜像定义、同一平台集合、同一组标签规则、同样不写 `latest`）。可按环境选择，但**同一个版本只应由其中一种方式发布一次**。

| 模式                        | 运行位置               | 前置条件                                                     | 适用场景                                            |
| --------------------------- | ---------------------- | ------------------------------------------------------------ | --------------------------------------------------- |
| **A. Actions 流水线**（§1） | GitHub Actions         | 仓库 Actions 可用；`dockerhub-release` Environment + Secrets | 有可用 Actions 额度，希望构建与发布在受控 CI 中完成 |
| **B. 本地脚本**（§2）       | 任意装有 Docker 的主机 | `config/dockerhub-release.env`                               | GitHub Actions 不可用或额度受限时手动构建发布       |

补充说明：

- GitHub 曾因 Fork 计算资源限制停止为本仓库运行 Actions。若你的仓库 Actions 当前可用，模式 A 仍完全有效；不可用时不要强行重试，改用模式 B。
- 两种模式互不替代对方的**证据**：模式 B 的本地构建记录不能顶替模式 A 的 CI 记录，反之亦然。发布记录里必须写明本次用的是哪种模式。
- 计划中的第三种承载方式（Gitea act-runner）尚未实施，见 §7。

## 1. 模式 A：Actions 流水线

仅用于 `kanon-H/homepage`，不启用继承的官方 `docker-publish.yml`，不向 GHCR 登录。

1. 在 main 手动运行 **Fork Docker Hub release**，默认 `publish=false`、版本留空：只验证当前 main，**不需要 Docker Hub 凭据**。
2. 版本必须是已存在且属于 main 历史的 `fork-vX.Y.Z`，不接受任意分支/SHA、上游 `v*`、预发布后缀或 `latest`。版本源码的发布关键文件必须与当前 main 一致；老版本没有发布基础、或发布基础发生变化时拒绝。
3. 自有标签 push 的 **Fork version tag notification** 不 checkout 或执行标签代码，不接触注册表凭据，只向 main 的发布控制器发一次 dispatch。HTTP204 仅说明请求被接受，需查看另一个发布 run。拒绝 rerun 通知任务；未知响应先查询实际 main runs，不盲重发。
4. main 控制器核对事件/工作流来源、实时 main、标签实际 commit 和祖先，固定官方 main 只读查询并记录共同上游基线。规划和发布前分别读取 main/tag，检测到改动则停止；不是自动追最新提交，也不是跨 GitHub/Hub 的原子事务，仍需不可变版本标签规则兜底。
5. 无注册表凭据的 build job：精确源码/Node/pnpm、frozen install、Lint、全量测试、隔离应用构建；从 Git 对象导出允许文件组成 context，再按 `PLATFORMS` 构建，禁止复用宿主 `.next`/node_modules。输出 OCI archive。
6. 上传前核查平台集合与版本/源码/上游/GPL 标签。`fork-image-smoke` 先固定归档 SHA，再从同归档按 `PLATFORMS` 逐个导入，做 Node 结构检查并启动真实应用；每个平台检查默认 `root` + `/app/config` 及 `PUID10001/PGID10002` + `/config`，必须完成健康、PID1 身份、卷读写、HTTP 密码登录/退出、Host、匿名与私有缓存、SSR/API/Next 数据一致性。归档前后 SHA 不变才继续上传。**不替代物理 ARM、OIDC、HTTPS/CDN、真实 NAS 文件系统或 P5 人工验收。**
7. publisher 等待 `dockerhub-release` Environment；只运行 main 控制器，不安装应用依赖、不重建、不执行 artifact 脚本。下载同一 build job 的精确 artifact ID，核对 archive SHA256，再核对实时 main/tag 和镜像标签。
8. Docker Hub 两个目标标签均不存在时，才各 copy 一次：`fork-vX.Y.Z`、`sha-<完整源码SHA>`。不更新 latest、主次版本别名或已有标签。复制后读回 digest 必须与测试的 OCI index 一致，输出 `release.json`。

全部 job 的 `GITHUB_TOKEN` 默认仅 `contents:read`；plan/publisher 另有 `actions:read`，只读核验 Environment 保护，只有无注册表凭据的 tag 通知 job 获得 `actions:write`。没有 `packages:write`、生产部署或自动合并权限。内置 token 生成的普通 push/tag 事件不保证触发另一个 workflow；未来若由机器人创建版本标签，应显式调用可信 main 控制器。

### 1.1 模式 A 的 GitHub 设置

创建 Environment：`dockerhub-release`。

- Deployment branches/tags：选择 **Selected branches and tags**，只添加 `type=branch`、`name=main` 一条规则，不使用"所有受保护分支"或通配符，不允许标签。控制器在规划及真正 copy 前通过只读 API 核验该配置，缺失/错误/无法读取都会停止。
- 建议至少一个 Required reviewer；个人仓库允许本人审批时不要启用 Prevent self-review。
- 把凭据放 **Environment secrets**，不要放 Repository secrets 或 YAML：

| 名称                 | 值                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------- |
| `DOCKERHUB_USERNAME` | Docker Hub ID，小写用户名，不是邮箱                                                |
| `DOCKERHUB_TOKEN`    | Docker Hub Access Token，具备目标仓库 pull/push 权限，不用登录密码，不授予删除权限 |

Repository **variables**：

| 名称                        | 默认/用途                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `DOCKERHUB_IMAGE`           | 可省略，默认 `<DOCKERHUB_USERNAME>/homepage`；组织仓库填小写 `namespace/repository`，不含 registry、tag 或 digest |
| `DOCKERHUB_RELEASE_ENABLED` | 缺省关闭；完成真实 build-only 验收与保护配置后，明确设为字符串 `true` 才允许发布                                  |

Docker Hub 密钥只传给 publisher 的一个步骤；Skopeo 使用 Linux tmpfs 中**先 unlink 再写入**的内存文件描述符，子进程通过 `/proc/self/fd/3` 读取。Token 不进入 argv、子进程环境、具名磁盘文件、Docker config、build args 或镜像层。平台不支持 tmpfs/FD 时失败，不回退到持久凭据文件。

### 1.2 模式 A 的历史调试结论（保留）

前几轮 Actions 实跑的失败已被逐一定位，其中三项是发布基础设施的真实缺陷、三项是门禁自身缺陷，均已修复并入 main：

| ID  | 缺陷                                                     | 真实错误                                           |
| --- | -------------------------------------------------------- | -------------------------------------------------- |
| —   | Git context 白名单缺 `tailwind.config.js`                | `Can't resolve '../../tailwind.config.js'`         |
| —   | `.dockerignore` deny-by-default 未放行同一文件           | 同上报错，第二层                                   |
| G1  | `docker create --env-file=/dev/stdin` 在 pipe 下不可打开 | `open /dev/stdin: no such device or address` (125) |
| G2  | `finally` 中 cleanup 抛错覆盖真实门禁错误                | 只见 `SMOKE_*_CLEANUP_FAILED`                      |
| G3  | 冒烟入口把带冒号诊断压成通用码                           | 只见 `IMAGE_VERIFICATION_FAILED`                   |
| G4  | 非 root 模式 seed root 所有卷再要求 PUID 写入            | `EACCES binding.writeFileUtf8`                     |
| G5  | buildx 外层 index 包一层嵌套 index                       | `EXPECTED_TWO_PLATFORMS`                           |
| G6  | 归档含 `unknown/unknown` provenance manifest             | 硬编码"恰好两个"必失败                             |

**G2 是关键**：它使最初几次门禁失败的真实原因无法进入日志，导致误判为"反复同一错误"。修复后诊断信息可正常透出。

修复后的门禁已在真实双架构 OCI 归档上验证：两个架构 × 两种挂载/身份组合，各 **103 项检查**通过。该验证在私有 Docker 主机完成，属于模式 B 的前身实践，**不能替代模式 A 的 CI 记录**。

五个失败 run（`42608235225` / `42615682764` / `42622961033` / `42631136692` / `42655571841`）按用户要求保留为证据，未 rerun。

## 2. 模式 B：本地脚本

### 2.1 一次性准备

1. 在一台已安装 Docker（含 buildx）的机器上克隆本仓库。
2. 复制模板并填写凭据。真实文件位于 `config/`，**已被 `.gitignore` 忽略，不会提交**：

   ```bash
   cp scripts/dockerhub-release.env.example config/dockerhub-release.env
   # 编辑后填入 DOCKERHUB_USERNAME 与 DOCKERHUB_TOKEN
   ```

3. `DOCKERHUB_TOKEN` 请用 Docker Hub 的 Access Token（仅需目标仓库 Read & Write），不要使用账号登录密码。

### 2.2 命令

```bash
bash scripts/local-docker-release.sh --dry-run     # 只校验环境，不构建不推送
bash scripts/local-docker-release.sh --build-only  # 只构建，产出 OCI 归档与 SHA256
bash scripts/local-docker-release.sh               # 构建 + 冒烟 + 推送两个标签
```

脚本行为：

- 平台取自 `scripts/fork-release.mjs` 的 `PLATFORMS`，当前仅 `linux/amd64`。
- 构建上下文由 Git 跟踪文件白名单导出，**不含** `config/`、`.env*`、`.git`、`node_modules`、`.next`。
- 若已安装 `skopeo`，会在推送前执行与模式 A 相同的运行时冒烟（结构 + 原生登录/Host/挂载/身份/健康）。缺少 skopeo 时提示并跳过，可用 `SKIP_SMOKE=1` 显式跳过。
- 推送 `fork-vX.Y.Z` 与 `sha-<完整SHA>` 两个标签，**不写 `latest`**；任一标签已存在则停止，不覆盖。
- 登录密码经 stdin 传入，不进入 argv；登录配置写在临时目录并在退出时删除。
- 版本默认取 `package.json` 的版本，生成 `fork-v<version>`；可用 `RELEASE_VERSION` 覆盖。

### 2.3 模式 B 的边界

- 本地构建证据**不能**替代模式 A 的 CI 记录，也不能证明 arm64 可用。发布说明必须写明本次所用模式，以及当前只提供 `linux/amd64`。
- 凭据文件、真实配置、Cookie/Session 均不得进入 Git、镜像层或发布记录。
- "标签已存在则停止"是脚本级预检，不是注册表原子锁；真正的不可变保证来自 Docker Hub 服务端的标签不可变策略。
- `--build-only` 后应先用同一归档核对 digest 与冒烟结果，再执行推送。

## 3. 两模式共用的发布纪律

无论用 A 还是 B，以下规则都适用：

- 版本号必须是 `fork-vX.Y.Z`，与上游 `v*` 区分；**不发布 `latest`**、不发布主次版本别名。
- 推送前确认两个目标标签都不存在；不使用覆盖或强制推送补救。
- 推送后读回 digest，与本次验证的归档一致才算完成。
- 一个版本只发布一次。若第一次结果未知，先只读核实注册表实际状态，再决定补救，不盲目重跑。
- 发布说明必须写明：所用发布模式、平台仅为 `linux/amd64`、手机兼容验收仍延期及其已知差异。

## 4. 失败和部分发布

- 仅显式 `404/MANIFEST_UNKNOWN` 被当作目标标签缺失；401/403/429、网络、坏 JSON、缺仓库/未知状态一律停止，不能当成"空仓库可覆盖"。
- archive 替换、标签/源码/上游/GPL 元信息错误、main/tag 前进、已有标签或 digest 不一致都停止。
- 第一标签 copy 成功、第二标签失败可能是**部分发布**。未知响应也可能已经写入；不自动重试、不删标签、不覆盖、不修补，不把失败标为成功。
- 人工只读核实两个 tag 的 digest、源码和本次运行记录，再决定接受完整发布记录、受控补救或新提交/新版本。
- 发布日志可能成功但记录上传失败，同样先读回注册表并核实，不重复写入。

## 5. 回滚（说明，不是自动部署）

预先保存：新旧版本、完整源码 SHA、上游基线、镜像 index digest、平台、配置快照代号和验收摘要；配置及登录密钥不进入 Git/artifacts。

1. 独立验证旧 `<namespace/repository>@sha256:<digest>` 仍可拉取，且与当前配置兼容。
2. 经用户部署授权后，切回旧 digest；不强推 main、不篡改版本标签或 latest。
3. 必要时关闭 `extensions.network.enabled`；原 href、认证、Widget/监控仍保留。当前无数据库迁移。
4. 验证登录/退出、Host/配置挂载、导航和健康状态，记录真实结果；未实演前回滚待办不勾选。
5. 修复发布新提交和新版本。任何自动化流程**都不会重启 NAS/生产容器**。

## 6. 正式多地址镜像的目标与顺序

用户最新决定：除 P5 实际手机兼容验证延期外，完成其余必需工作后发布正式版。手机浏览器新标签/原页及实际触屏布局的已知差异继续保留为延期未完成，不宣称手机已通过，也不修改 target/rel 来掩盖差异。桌面中键/完整焦点与 Widget 交互、适用的认证/Host/目标缓存不获豁免；N/A 须用户确认适用范围。

继续原顺序：先独立发布基础入 main 和基础验证，再补其余验收、将最新 main 合入 feature 并审查导航 PR #1，最后对含导航的正式 main 源码/同一发布归档重做门禁。**不直接合 PR #1 赶发预览版，也不把无导航的基础镜像当正式成果。** 完整固定 ID 与阶段表见 `DEVELOPMENT.md` 第 13～14 节，规范延期范围见 `SPEC.md` 12.1。

## 7. 计划：迁移到 Gitea act-runner（尚未实施）

用户后续计划改用 **Gitea 的 act-runner** 承接本地/自托管打包，不再依赖 GitHub Actions。本节记录约束与迁移前置条件，**当前没有任何实现**，不得据此声称已支持。

### 7.1 复用边界

- 现有 `.github/workflows/fork-release.yml` 与四个 stdlib 脚本（`fork-release.mjs`、`fork-image-context.mjs`、`fork-image-smoke.mjs`、`fork-image-publish.mjs`）大部分逻辑与托管平台无关，迁移时应**复用而非重写**。
- 依赖 GitHub 专有的部分必须替换：Environment 分支保护与 reviewer 校验、`github.token` 权限模型、`actions/upload-artifact`、`GET /repos/...` 的仓库/标签/祖先校验、以及 `fork-release-tag.yml` 的 dispatch 机制。
- `PLATFORMS` 仍是唯一平台来源；act-runner 若同样无法稳定模拟 arm64，仍只发 amd64。

### 7.2 迁移前置条件（缺一不可）

1. **可信源码来源**：等价的"只从受审 main 构建"校验，避免 runner 上运行未审分支代码。
2. **凭据隔离**：Docker Hub token 不进入 workflow 定义、runner 日志、镜像层或 `act` 默认环境；继续走内存/临时文件的既有做法。
3. **产物同源**：冒烟测试的归档必须与最终推送的归档字节一致，不能重建。
4. **标签不变性**：Docker Hub 服务端标签不可变策略必须启用；脚本预检不是原子锁。
5. **失败即停**：未知响应不重试、不覆盖；与 §4 一致。
6. **本地可验证**：先用 `act` 在本地跑通 build-only，再接入真实推送。

### 7.3 与模式 B 的关系

在 act-runner 落地之前，**模式 B 是 Actions 不可用时的正式替代路径**，不是临时权宜。act-runner 落地后，可视为"模式 A 的自托管等价物"，届时再更新本节与 §0 的对照表；在此之前不新增第三种状态的宣称。

## 8. 追踪清单

- [x] 发布基础独立 PR #4 与对应真实应用 CI。
- [x] 发布基础合入 main，核新 main CI。
- [x] 容器门禁 G1～G6 缺陷修复，并在真实双架构归档上验证四组合各 103 项检查。
- [x] 平台集合收敛为 `PLATFORMS` 单点控制，当前 `linux/amd64`。
- [x] 本地发布脚本与凭据模板（模式 B），含 dry-run / build-only / 推送。
- [ ] 模式 A 在 Actions 可用环境下重新实跑一次并留下记录（当前 Actions 不可用）。
- [ ] 模式 B 在真实 Docker 主机上完成一次完整构建 + 冒烟 + 推送，并记录 archive SHA 与 digest。
- [ ] 非手机 P5、适用目标认证/缓存等其它必需验收完成或记录明确阻塞；仅手机兼容延期。
- [ ] 最新 main 同步 feature、完整回归，单独审查导航 PR 合入 main。
- [ ] 最终正式候选确含导航，同一归档已完成全部镜像检查。
- [ ] Docker Hub 目标仓库、标签不可变策略读回；Git 标签规则配置。
- [ ] 首次正式版本发布、两个 tag/digest 读回、独立拉取与实际临时运行。
- [ ] 部分发布处置与旧 digest 回滚演练（非生产优先）。
- [ ] Gitea act-runner 迁移（§7）：可行性验证、凭据隔离、同源产物、本地 `act` 跑通。
- [ ] 需要时补充 SBOM、provenance、签名和原生 ARM 验收。

上游写入/权限/幂等、实际调度及补充门禁未完成时继续记录，不因流水线文件或模拟/no-op 通过而完成，也不自动豁免。手机兼容是本次唯一明确的验收延期；SBOM/签名等仍为原后续增强，Gitea 备份仍可选。缺条件先报告，任何范围调整与 Git/Actions/发布/部署动作另行授权。
