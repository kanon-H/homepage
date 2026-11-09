# Fork 镜像发布与回滚（Docker Hub）

> 本文随 Fork 发布基础交付，实际分支、提交与 PR 状态以 Git/GitHub 为准；工作流存在、策略测试或普通应用 CI 成功都不等于镜像已构建或发布。本次开发主机没有 Docker/Podman，真实双架构容器/注册表验收须按下列步骤另行核实。

## 1. 信任边界与流程

仅用于 `kanon-H/homepage`，不启用继承的官方 `docker-publish.yml`，不向 GHCR 登录。

1. 在 main 手动运行 **Fork Docker Hub release**，默认 `publish=false`、版本留空：只验证当前 main，**不需要 Docker Hub 凭据**。
2. 版本必须是已存在且属于 main 历史的 `fork-vX.Y.Z`，不接受任意分支/SHA、上游 `v*`、预发布后缀或 `latest`。版本源码的发布关键文件必须与当前 main 一致；老版本没有发布基础、或发布基础发生变化时拒绝。
3. 自有标签 push 的 **Fork version tag notification** 不 checkout 或执行标签代码，不接触注册表凭据，只向 main 的发布控制器发一次 dispatch。HTTP204 仅说明请求被接受，需查看另一个发布 run。拒绝 rerun 通知任务；未知响应先查询实际 main runs，不盲重发。
4. main 控制器核对事件/工作流来源、实时 main、标签实际 commit 和祖先，固定官方 main 只读查询并记录共同上游基线。规划和发布前分别读取 main/tag，检测到改动则停止；不是自动追最新提交，也不是跨 GitHub/Hub 的原子事务，仍需不可变版本标签规则兜底。
5. 无注册表凭据的 build job：精确源码/Node/pnpm、frozen install、Lint、全量测试、隔离应用构建；从 Git 对象导出允许文件组成 context，再分别构建 amd64/arm64，禁止复用宿主 `.next`/node_modules。输出 OCI archive。
6. 上传前核查两架构和版本/源码/上游/GPL 标签，并通过 QEMU 分别启动 Node 检查运行时文件与配置边界。**这是运行时结构冒烟，不是应用 HTTP 登录、物理 ARM 或 P5 全量验收**。
7. publisher 等待 `dockerhub-release` Environment；只运行 main 控制器，不安装应用依赖、不重建、不执行 artifact 脚本。下载同一 build job 的精确 artifact ID，核对 archive SHA256，再核对实时 main/tag 和镜像标签。
8. Docker Hub 两个目标标签均不存在时，才各 copy 一次：`fork-vX.Y.Z`、`sha-<完整源码SHA>`。不更新 latest、主次版本别名或已有标签。复制后读回 digest 必须与测试的 OCI index 一致，输出 `release.json`。

全部 job 的 GITHUB_TOKEN 默认仅 contents:read；plan/publisher 另有 actions:read，只读核验 Environment 保护，只有无注册表凭据的 tag 通知 job 获得 actions:write。没有 packages:write、生产部署或自动合并权限。内置 token 生成的普通 push/tag 事件不保证触发另一个 workflow；未来若由机器人创建版本标签，应显式调用可信 main 控制器，不能假设普通触发有效。

## 2. 先集成，再配置（均需另行授权）

当前多地址功能仍在 Draft PR #1，不会为发布基础而提前合并。可先把发布基础提取到纯 main 的独立 PR：两份 `fork-release*.yml`、`Dockerfile.fork`/专用 ignore、四份 `fork-image-*.mjs`/`fork-release.mjs` 中实际存在的发布脚本（context、publish、smoke、release）、新策略测试和本指南；依赖 main 已有的预检 Git 工具、隔离构建脚本。保留 merge 历史、真实 CI 和人工审核。

**main 尚未合入多地址功能时，从 main 发布的镜像也不含该功能。** 是否恢复 P5、调整验收范围、合并 PR #1 是另一项决策，流水线不代替它。

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

按顺序，不跳过：

1. 获准提交/推送、PR 审查并将发布基础合入 main；核实新的精确 head CI，而不是沿用功能分支旧绿。
2. 在 main 手动触发 `publish=false`、版本留空。记录 run/main/source/upstream、两平台构建与结构冒烟、OCI archive SHA；不登录或推送 Docker Hub。
3. 在获准的临时 Docker 环境对该 archive/镜像补 HTTP 启动、原生密码登录/退出、Host、Widget/配置挂载边界冒烟。按实际需要验证 PUID/PGID 和健康检查。不用结构冒烟代签这些项目；不操作生产。
4. 完成 Environment/版本标签/Hub 不可变策略、Token/目标镜像名检查，再由所有者设置发布 opt-in。
5. 在已审 main 历史上创建新的自有版本标签并推送（这是另行授权的 Git 写入，不是本文自动执行）：

   ```bash
   git tag -a fork-v0.1.0 <reviewed-main-sha> -m "Fork release 0.1.0"
   git push origin refs/tags/fork-v0.1.0
   ```

   也可在 main 手动选已存在版本标签并显式 `publish=true`。不要对未知结果 rerun 通知/发布；新 dispatch 也是发布操作，须先调查并另行确认。

6. 审批 Environment，跟踪 main 发布 run，核对 `release.json` 的完整源码/upstream/version/created/digest、两个标签 digest、两平台清单。标签通知成功或有镜像 tag 不等于发布全部成功。
7. 独立客户端实际 pull `<image>@sha256:...`；public 应匿名验证，private 应验证目标生产身份。确认 amd64/arm64 拉取及相应临时运行，不由 push 成功推断可拉取。
8. 保存非秘密发布记录与对应源码/许可证；根 GPLv3、镜像 GPL-3.0-only 标签及 `/usr/share/doc/homepage/LICENSE` 一致。源码通过固定公开仓库与完整 revision 追溯。

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

- [ ] 发布基础独立 PR/真实 CI/main 集成。
- [ ] main build-only 的实际双架构 OCI 构建、上下文核验和结构冒烟。
- [ ] 实际容器 HTTP/认证/挂载/PUID/健康验收。
- [ ] Environment/main-only/reviewer、Git 标签及 Docker Hub 不可变策略读回。
- [ ] 所有者配置 Environment Secrets/镜像名，单独启用发布 opt-in。
- [ ] 首次真实版本发布、两个 tag/index digest、独立拉取/运行和长期记录。
- [ ] 失败/部分发布与旧 digest 回滚演练（非生产优先）。
- [ ] 需要时补充 SBOM、provenance、签名和原生 ARM 验收。

自动上游写入 PR/CI/权限演练、每周调度实证、P5 剩余人工验收、PR #1 合并与可选 Gitea 备份是独立事项，不因本流水线文件存在而完成。
