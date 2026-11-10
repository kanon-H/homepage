# 交接：当前现状与后续工作（Kimi Code 接手）

> 生成时间：2026-11-10
> 仓库：`/home/openclaw/workset/data/workspace/homepage-workspace/homepage`
> 阅读顺序：本文件 → `AGENTS.md` → `agent.md` → `DESIGN.md` → `SPEC.md` → `DEVELOPMENT.md`

---

## 0. 一句话现状

**多地址导航功能已完整实现并实测可用，首个正式镜像已发布到 Docker Hub（`fork-v2.7.0`，仅 amd64），但代码仍停在 `feature/multi-address` 分支，尚未合入 `main`。**

---

## 1. Git 事实（2026-11-10 实测）

### 1.1 分支状态

| 位置                           | 提交       | 说明                                                            |
| ------------------------------ | ---------- | --------------------------------------------------------------- |
| `origin/main`                  | `197a7990` | PR #8 merge，**落后 feature 30 个提交**                         |
| `origin/feature/multi-address` | `2ddc65b3` | 当前开发分支，工作区干净                                        |
| 本地 `main`                    | `2e5f1013` | **是上游 2.7.0 标签提交，不是 fork main**，勿直接 checkout 使用 |
| 本地 `dev`                     | `e95addaf` | 上游分支，与 fork 开发无关                                      |

**重要**：本地 `main` 指向 `2e5f1013`（上游 `2.7.0`），而 `origin/main` 是 `197a7990`。要操作 fork 的 main，必须先 `git checkout -B main origin/main` 或直接基于 `origin/main` 开分支。

### 1.2 差距量化

```
feature 领先 origin/main：30 个提交
改动：48 文件，+9844 / -2723
```

按性质拆分：

| 类别                 | 文件数 | 内容                                                                                                                                                              |
| -------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **导航功能**（源码） | 21     | `src/utils/network/`(12)、`src/components/network/`(4)、`src/utils/contexts/network.jsx`、`service-menu.jsx`、`item.jsx`、`quicklaunch.jsx`、`pages/index.jsx` 等 |
| **导航功能**（测试） | 5      | 对应单测 + `src/__tests__/pages/index.test.jsx`                                                                                                                   |
| **发布基础设施**     | 6      | `scripts/local-docker-release.sh`、`fork-image-{context,publish,smoke,http}.mjs`、`fork-release.mjs`                                                              |
| **CI workflow**      | 1      | `.github/workflows/fork-release.yml`                                                                                                                              |
| **文档**             | 8      | `agent.md`、`AGENTS.md`、`DESIGN.md`、`SPEC.md`、`DEVELOPMENT.md`、`docs/more/fork-release.md`、`docs/configs/network.md`、`mkdocs.yml`                           |
| **其他**             | 7      | i18n、`FORK_AUTOMATION.md`、`api-response.js` 等                                                                                                                  |

### 1.3 `main` 上的发布链是坏的

`origin/main`（`197a7990`）上：

- ❌ **没有** `scripts/local-docker-release.sh`
- ❌ **没有** `PLATFORMS` 常量（`fork-release.mjs` 里搜不到）
- ❌ `fork-image-smoke.mjs` 硬编码 `for (const arch of ["amd64", "arm64"])`
- ❌ `fork-image-publish.mjs` 用旧错误码 `EXPECTED_TWO_PLATFORMS`
- ❌ `fork-release.yml` 里 `platforms: linux/amd64,linux/arm64`

**结论：在 `main` 上无法完成 amd64-only 发布，会因 arm64 QEMU SIGILL 失败。**

### 1.4 远端分支清理建议

已合入 `main`，可删除：

```
chore/fork-image-context-fix
chore/fork-dockerignore-fix
chore/fork-smoke-diagnostics
chore/fork-gate-defects
chore/fork-dockerhub-release-bootstrap
chore/fork-automation-bootstrap
```

**未合入**，需保留或处理：

```
chore/fork-amd64-only    (7592eeb8) — CI 未跑（Actions 已禁用），但其内容已包含在 feature 里
```

### 1.5 PR 状态

- **PR #1**（多地址主功能）：**始终 open / Draft / 未合并**
- **PR #4～#8**：均已合入 `main`
- **PR #9**（amd64-only）：未合并（Actions 被禁用，CI 没跑）

> `gh` CLI 在本机**不可用**，需要用 Web 或 API 操作 PR。

---

## 2. 已完成的实际成果

### 2.1 多地址导航功能

配置路径：`settings.yaml` → 服务项 → `extensions.network`

已实现：

- 模式切换器（右上角），模式持久化到浏览器 localStorage
- 每服务多地址解析（独立纯函数，集中在 `src/utils/network/`）
- 卡片链接、服务搜索结果、右键/更多菜单**随模式一致变化**
- 菜单支持复制地址、键盘导航、边缘定位
- 原始 `href` 始终保留，切换模式不修改 YAML / SWR 原对象 / 服务器共享缓存
- URL 校验、非法配置 fallback
- 未扩展书签，未改 Widget URL/密钥、ping/siteMonitor、上游发现语法

### 2.2 镜像发布（本次新完成）

**已发布到 Docker Hub：**

```bash
docker pull docker.io/kanonhua/homepage:fork-v2.7.0
docker pull docker.io/kanonhua/homepage:sha-2ddc65b3f70c00318b070699609fa3fca12e7ad1
```

| 项       | 值                                                                                      |
| -------- | --------------------------------------------------------------------------------------- |
| 标签     | `fork-v2.7.0`、`sha-2ddc65b3f70c00318b070699609fa3fca12e7ad1`                           |
| Digest   | `sha256:f84e010c1356f9b41166a7354a7eed5d6cead170b45391a99a13b55ad075a336`（两标签一致） |
| 平台     | `linux/amd64` **仅此一个**                                                              |
| 源码提交 | `2ddc65b3`                                                                              |
| 上游基线 | `2e5f10134ae3961bb936d3e7c441f9a1f4a4bf4f`                                              |
| 许可     | `GPL-3.0-only`                                                                          |
| `latest` | **未写入**（远端正只有上述两个标签）                                                    |

**验证证据（均实测，非推测）：**

- 运行时冒烟：`/app/config`(uid=0) 与 `/config`(uid=10001:10002) 两种挂载各 **103 项检查 healthy**
- 镜像启动实测：`/api/healthcheck` → `200 up`；首页渲染正常；`/api/services` → 200
- Host 校验实测：非白名单 Host 返回 **400**（安全行为完好）
- 独立拉取：从 Hub 重新 `docker pull` 成功，digest 与推送一致
- 镜像内标签核对：`revision=2ddc65b3...`、`version=fork-v2.7.0`

### 2.3 本轮修复的 4 个真实缺陷（commit `2ddc65b3`）

| 缺陷                 | 现象                                                  | 修复                                                                                         |
| -------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| OCI exporter 不支持  | `OCI exporter is not supported for the docker driver` | 脚本自动建临时 `docker-container` builder，`trap` 退出时删除                                 |
| 上下文路径错位       | `path ".../context" not found`                        | `CONTEXT` 改为 `$OUT_DIR/fork-release/context`，与 `fork-image-context.mjs` 固定写入路径对齐 |
| 单平台归档误判       | `EXPECTED_PLATFORMS` / `WRONG_IMAGE_PLATFORMS`        | `skopeo inspect --raw` 单平台返回 **manifest 而非 index**，改为直读归档内 `index.json`       |
| skopeo↔Docker 不兼容 | `writing blob: io: read/write on closed pipe`         | 改走 `skopeo → docker-archive → docker load`                                                 |

测试：新增 2 条断言锁定上述路径，全量 **588 文件 / 2464 测试通过**。

---

## 3. 环境事实

### 3.1 开发机（当前）

| 项                       | 值                                                                             |
| ------------------------ | ------------------------------------------------------------------------------ |
| Node                     | `v24.22.1` ✅                                                                  |
| pnpm                     | **不在 PATH**；用 `corepack pnpm`（会下载 12.18.0，**与 CI 的 10.34.9 不符**） |
| Git                      | `2.47.3`                                                                       |
| Docker / Podman / Skopeo | **全部没有**                                                                   |

**验证命令实际可用形式：**

```bash
npx vitest run                 # 测试（已验证 588 文件 / 2464 项）
npx eslint .                   # Lint
npx prettier --check <files>   # 格式
```

`pnpm install --frozen-lockfile` **在本机未验证成功**（pnpm 版本不一致）。若需完整构建验证，用 `app-server`。

### 3.2 测试服务器 `app-server`（192.168.6.11）

```
SSH:  ssh -o BatchMode=yes app-server      # 密钥 ~/.config/harbor-ops/ssh/app_server_ed25519
用户: kanon（在 docker 组，无需 sudo 跑 docker）
OS:   Debian 12 / x86_64
Docker 29.9.3, buildx v0.31.1
skopeo 1.9.3
Node: 仅 nvm 下有 v14.7.0 / v22.8.0（**低于要求的 v24.22.1**）
      → 用 export PATH=/home/kanon/.nvm/versions/node/v22.8.0/bin:$PATH
磁盘: 293G 总 / 242G 可用
内存: 5.9G 总 / 约 3.9G 可用（偏紧，构建需串行）
sudo: **需要密码**，非交互拿不到
出网: npm registry 正常；**Docker Hub 频繁 EOF 抖动**（需重试）
```

**发布工作目录：** `/home/kanon/workset/data/workspace/homepage-release/repo`

### 3.3 ⛔ 生产环境 `fnos-max`（192.168.6.6，飞牛 NAS）

**严禁用于本仓库任何测试、构建、调试、重建、清缓存、改配置，也不得主动连接。**

- 该机是生产环境，跑着约 76 个生产容器
- 历史上的调试残留清理**只能由用户本人执行**，脚本在 `config/cleanup-fnos-max/`（Git 忽略，用完删）
- 用户已在 `fnos-max` 部署 gitea-runner（DinD，未挂 docker.sock）用于打包，那是**用户自己操作**，不是 Agent 可直接操作的对象

---

## 4. 关键决策（不要推翻）

1. **复用上游认证**，不做用户管理，不引入数据库
2. **保留原始 `href`**，模式切换不改 YAML / SWR / 服务器缓存
3. **merge commit 保留历史**，不 squash / rebase / 强推
4. **只用 `fork-vX.Y.Z` 标签，绝不写 `latest`**
5. **一个版本只由一种模式发布一次**，两种模式证据不可互相顶替
6. **先只发 amd64**；arm64 需先实施 `BUILDPLATFORM` 交叉编译，不得靠重试/降级断言绕过 SIGILL
7. **手机兼容验收是唯一允许延期的项**；其它门禁不豁免
8. 不开发 Skill
9. 不读、不依赖、不修改本仓库以外的参考项目

---

## 5. 后续工作（按优先级）

### P0 — 立即可做，无阻塞

#### 5.1 把发布基础设施修复带入 `main`（建议 PR-A）

**为什么重要**：`main` 的发布链现在是坏的，任何人从 `main` 发布都会撞 arm64 SIGILL。

**做法**：从 `origin/main` 开新分支，只摘发布基础设施修复，**不带导航源码**：

```
必含：
  scripts/local-docker-release.sh          （新增）
  scripts/fork-image-publish.mjs           （PLATFORMS + index.json + attestation）
  scripts/fork-image-smoke.mjs             （PLATFORMS 循环 + docker load）
  scripts/fork-image-http.mjs              （若 main 缺失）
  scripts/fork-release.mjs                 （PLATFORMS 常量）
  scripts/fork-image-context.mjs           （tailwind 白名单）
  Dockerfile.fork.dockerignore             （tailwind 放行）
  .github/workflows/fork-release.yml       （platforms 从 PLATFORMS 派生）
  scripts/dockerhub-release.env.example
  相关测试
不含：
  src/utils/network/**、src/components/network/** 等导航源码
```

**注意**：这些脚本之间有 import 依赖，不能只挑单个文件。建议用 `git checkout origin/feature/multi-address -- <path>` 精确取文件，然后跑 `npx vitest run src/__tests__/workflows/` 确认自洽。

**验证**：`npx vitest run`（应 578+ 文件）+ `npx eslint .`

**合并方式**：先建 PR（Draft 即可），CI 若不可用则记录原因；合并用 merge commit。

#### 5.2 清理远端已合并分支

删除 §1.4 列出的 6 个已合入分支（保留 `chore/fork-amd64-only` 供参考，或在其内容确认已进 feature 后删除）。

#### 5.3 确认 Docker Hub 仓库设置

用户需自行操作（Agent 不碰凭据）：

- 仓库可见性（public / private）
- 标签不可变策略（建议开启，防止覆盖已发布标签）
- 确认 `latest` 确实不存在

### P1 — 导航功能合入 `main`

#### 5.4 完成非手机验收后合并 PR #1

**已完成的验收：**

- ✅ Chromium 自动化 245 项
- ✅ macOS 8 项用户实测正常（中键未执行）

**仍缺的非手机验收：**

- ❌ 鼠标中键原生行为
- ❌ 完整键盘焦点流转
- ❌ Widget / 统计区域交互不被菜单吞掉
- ❌ 适用时的 OIDC、目标反代、CDN 场景

**唯一允许延期的：** 手机兼容（华为新标签、小米 `v20.28.1020918`、红米/鸿蒙 QQ 替换原页）

补齐上述非手机项后，PR #1 转 Ready 并 merge commit 合入 `main`。

### P2 — Gitea act-runner 迁移（用户已部署，未接入仓库）

#### 5.5 让 workflow 直接调用本地脚本

**最省事路线**：不要重写 `fork-release.mjs` 的 GitHub API 校验（它依赖 `api.github.com`、`GITHUB_REPOSITORY`、`GITHUB_WORKFLOW_REF`、Environment 保护规则）。改为：

```yaml
- run: bash scripts/local-docker-release.sh --build-only # 或直接发布
```

**需先解决：**

1. **凭据**：`config/dockerhub-release.env` 被 `.gitignore` 忽略，checkout 里不会有。建议改脚本：文件不存在时回退读环境变量
2. **runner 资源**：DinD 的镜像层会累积。建议给 runner 容器设内存/磁盘上限，并定期清理 DinD 内旧层（**不要**用宿主机 prune）
3. **磁盘写满风险**：DinD 若用 vfs 驱动，层占用可达 overlay2 的 5~10 倍。写满会波及宿主机所有服务
4. **OOM 风险**：宿主机内存吃紧时，OOM killer 可能选中生产容器。建议限制 runner 容器内存

**Gitea 仓库迁移本身：**

```bash
# 必须用 mirror 保留历史（30 提交 / 8 分支 / 6 标签 / merge 历史）
git clone --mirror https://github.com/kanon-H/homepage.git homepage-mirror.git
cd homepage-mirror.git
git remote set-url origin https://<gitea>/<user>/homepage.git
git push --mirror
```

**克隆 fork 而非上游**：上游没有 `Dockerfile.fork`、没有多地址代码、没有发布脚本。

### P3 — arm64 恢复（暂缓）

需先实施 `BUILDPLATFORM` 交叉编译：

```dockerfile
# builder 阶段用原生架构构建
FROM --platform=$BUILDPLATFORM node:24 ... AS builder
# runner 阶段用目标架构
FROM --platform=$TARGETPLATFORM node:24 ...
```

然后改 `scripts/fork-release.mjs` 的 `PLATFORMS = ["amd64"]` → `["amd64", "arm64"]`，重跑冒烟。**不得**改断言迁就 QEMU 崩溃。

### P4 — 手机兼容验收（明确延期）

需覆盖：

- 华为浏览器新标签行为
- 小米 `v20.28.1020918`
- 红米 / 鸿蒙 QQ 替换原页

约束：不得改 `target` / `rel` / `window.open` 语义。

---

## 6. 容易踩的坑

### 6.1 本地 `main` 是陷阱

```
本地 main  → 2e5f1013（上游 2.7.0）
origin/main → 197a7990（fork main）
```

直接 `git checkout main` 会进入上游代码，看不到 fork 的任何工作。开工前先 `git fetch origin`，基于 `origin/main` 操作。

### 6.2 陈旧 `.git/index.lock` 会反复出现

本会话复现 **4 次**，根因未定位。

**清理前必须逐项核实**（不要直接 `rm`）：

```bash
L=.git/index.lock
stat -c 'uid=%u size=%s inode=%i mtime=%y' "$L"
pgrep -a -f "git " | grep -v pgrep     # 必须为空
lsof "$L"                               # 必须为空
id -u                                   # 必须与文件的 uid 一致
```

四项都满足才可 `rm -f "$L"`。**不要**因此重建索引。

### 6.3 pnpm 版本不一致

- CI 要求：`pnpm 10.34.9` + `node v24.22.1`
- 本机：`corepack pnpm` → 下载 **12.18.0**
- `app-server`：只有 node v22.8.0

**本机验证用 `npx vitest run` / `npx eslint .` 即可**，不要用 `pnpm install --frozen-lockfile` 作为门禁（版本不符会失败，且不是代码问题）。

### 6.4 Docker Hub 网络抖动

`app-server` 到 `registry-1.docker.io` 会间歇 `EOF`。**这不是镜像问题**：

- 推送失败后**先核实** `skopeo list-tags`，确认无部分发布，再重推
- 验证 digest 要**带重试**，否则两次查询都失败会误报 `MISMATCH`

### 6.5 `skopeo inspect --raw` 的行为差异

- **多平台**归档 → 返回 index（有 `manifests`）
- **单平台**归档 → 返回 **manifest**（无 `manifests`）

所以判断平台不能只看 `--raw`，要读归档内 `index.json`。

### 6.6 `docker load` 不认 OCI 格式

OCI tar 会报 `invalid archive: does not contain a manifest.json`。必须先用 skopeo 转成 `docker-archive`。

### 6.7 `type=oci` 需要 `docker-container` 驱动

默认 `docker` 驱动直接报错。脚本已自动处理，但**手工执行 `docker buildx build --output type=oci` 时要自己加 `--builder`**。

### 6.8 凭据文件

- 真实凭据：`config/dockerhub-release.env`（`.gitignore` 第 44 行 `/config` 整目录忽略）
- 模板：`scripts/dockerhub-release.env.example`（受跟踪）
- `DOCKERHUB_IMAGE`、`RELEASE_VERSION` 可以为空，脚本有默认值（`<user>/homepage`、`fork-vX.Y.Z`）
- **不要把凭据写进 Git、测试快照、日志或 Docker context**

### 6.9 不要在 `fnos-max` 上做任何事

见 §3.3。这是硬红线。

---

## 7. 常用命令速查

### 本机（开发 + 测试）

```bash
cd /home/openclaw/workset/data/workspace/homepage-workspace/homepage

git fetch origin
git status --short --branch

npx vitest run                              # 全量：588 文件 / 2464 项
npx vitest run src/__tests__/workflows/     # 只跑发布相关
npx eslint .
npx prettier --check <files>
```

### app-server（构建 + 发布）

```bash
ssh -o BatchMode=yes app-server
cd /home/kanon/workset/data/workspace/homepage-release/repo
export PATH=/home/kanon/.nvm/versions/node/v22.8.0/bin:$PATH

git fetch -q origin feature/multi-address && git checkout -q FETCH_HEAD

bash scripts/local-docker-release.sh --dry-run     # 环境校验
bash scripts/local-docker-release.sh --build-only  # 只构建+冒烟
bash scripts/local-docker-release.sh               # 构建+冒烟+推送
```

### 验证已发布镜像

```bash
skopeo list-tags --creds "$USER:$TOKEN" docker://docker.io/kanonhua/homepage
skopeo inspect --format '{{.Digest}}' --creds "$USER:$TOKEN" \
  docker://docker.io/kanonhua/homepage:fork-v2.7.0
```

---

## 8. 提交代码到远端的流程（给 Kimi Code）

### 8.1 每次开工

```bash
git fetch origin
git status --short --branch
# 若出现陈旧 index.lock，按 §6.2 核实后清理
```

### 8.2 提交前门禁

```bash
npx vitest run          # 必须全绿，当前基线 2464 项
npx eslint .            # 必须 0 错误
npx prettier --check <改动的文件>
```

### 8.3 提交规范

- 沿用现有风格：`feat(network): ...`、`fix(release): ...`、`docs: ...`、`ci: ...`
- commit body 说明**为什么**，尤其是修复类
- 不要一次提交大量无关文件
- 不要 squash 已有历史

### 8.4 推送

```bash
git push origin <branch>
```

**推送后**：若 Actions 可用会触发 CI；当前该 Fork 的 Actions **已被禁用**，不要假设 CI 会跑。

### 8.5 分支命名惯例（沿用现有）

```
feature/multi-address          多地址功能
chore/fork-*                   发布/CI 基础设施
```

### 8.6 合并到 `main`

- 走 PR，用 **merge commit**（不 squash）
- 合并前确认 `origin/main` 上必需检查（若 Actions 不可用则如实记录未运行）
- **不要**强推 `main`

---

## 9. 待用户确认的事项

1. **是否先做 PR-A**（把发布基础设施修复摘到 `main`），还是与导航 PR #1 一起解决？
2. **Docker Hub 仓库设置**：可见性、标签不可变策略是否已配置？
3. **`chore/fork-amd64-only` 分支**保留还是删除？
4. **迁移 Gitea 的时机**：先跑通本地脚本（已完成），还是先接 runner？
5. **arm64** 何时排期？

---

## 10. 不要做的事

- ❌ 在 `fnos-max` 上做任何测试/构建/调试
- ❌ 写 `latest` 标签
- ❌ squash / rebase / 强推 `main`
- ❌ 修改断言来迁就环境缺陷（如 QEMU SIGILL）
- ❌ 把凭据写入 Git / 日志 / 镜像
- ❌ 用 DOM 注入或字符串替换打补丁
- ❌ 放开认证、Host 校验或缓存边界
- ❌ 在 `src/pages/` 下新增测试（放 `src/__tests__/pages/`）
- ❌ 删除认证测试或弱化断言
- ❌ 声称"CI 通过"而实际未运行
