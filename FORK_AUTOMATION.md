# Fork 自动化基础与交接

本补丁以 `kanon-H/homepage/main@2e5f10134ae3961bb936d3e7c441f9a1f4a4bf4f` 为起点，仅引入自动化基础。来源是已验证的 `feature/multi-address@27139ebaa3c51f8d446287a596420732415fbbd9` 中的自动化文件，不合并该功能分支的业务代码或提交祖先。

**这不是多地址导航功能上线。** 原功能 PR #1 和 P5 未完成的手机/人工/目标环境验收保持独立；本补丁不改变导航、认证、Widget、依赖或锁文件，不代表完整 v1 验收通过。

## 范围

- `.github/workflows/fork-ci.yml`：本 Fork 的 main PR / main push / 手动 CI，只有 contents: read。固定 Node 24.22.1、pnpm 10.34.9、完整 Action SHA；不持久化 Git 凭据、不读取自定义 Secrets、不共享缓存或上传产物。
- `.github/workflows/fork-upstream-sync.yml`：main 的只读上游预检，每周一 UTC 04:17 / 手动；只计算对象、合并树与冲突，不发布分支或 PR。
- `.github/workflows/fork-upstream-integrate.yml`：默认关闭的写入控制器。只有 main 手动明确选择 create_pr=true，或定时事件且仓库变量 FORK_UPSTREAM_SYNC_ENABLED=true 才执行；本次不设置该变量或运行同步。
- 9 份继承工作流只补齐官方仓库 job 门禁，避免 Fork 执行上游翻译、Codecov、PR/Issue 机器人等；Docker/Docs 原有官方门禁不改。
- `scripts/fork-ci-build.sh`、`scripts/fork-upstream-preflight.mjs`、`scripts/fork-upstream-integrate.mjs` 和 3 份工作流测试。脚本不依赖忽略目录中的私有工具或生产配置。

## 信任与权限边界

同步只允许官方 `gethomepage/homepage` 的 HTTPS **main** 为来源，不跟随其默认 dev。只读预检可新增本地 Git 对象，但不改 refs/index/worktree/FETCH_HEAD；树 SHA 不是提交。

写入控制器只执行可信 main 代码，不 checkout 或运行合并树中的脚本。通过 commit-tree 构造 Fork main / 官方 main 的双父提交，只向固定 Fork 的 `sync/upstream-main-<完整上游SHA>` 非 force 推送，创建 Draft PR；不审批、合并、删除、发布或部署。

- 只有 integration job 获得 contents/pull-requests/issues/actions write，分别用于分支、PR、诊断 Issue/意图评论和 CI dispatch；不提高仓库默认 token 的 read 权限。
- 只使用内置 GITHUB_TOKEN。Token 仅在进程内存和 URL 限定的临时 Git header 环境中，不写参数、Git config 或日志；HTTP 不跟随重定向。
- 同 SHA 的已知分支/PR/CI 可复用；人工修改、过期 main、未知树/父提交或重复 PR 则停止，不覆盖历史。拒绝的 PR 不重开，有其他更新待审时不重复开第二个。
- 冲突/失败创建或复用机器人 Issue；通知失败明确 unconfirmed，不承诺邮件送达。Git 推送若被 workflow-file 权限拒绝，不剔除上游变更或偷偷改用 PAT/App。
- 默认 main 的 fork-ci.yml 必须匹配脚本 CI_DIGEST，候选中的定义也必须完全相同。修改 CI 定义须在同一受审 PR 显式更新 pin 和测试。
- GITHUB_TOKEN 的推送/建 PR 不保证触发普通 CI，因此显式 dispatch CI 到同步分支。先持久化该 head 的机器人意图评论，未知响应或有意图无 run 时不盲重发。
- 核对 run/path/event/repo/分支/head、job/check URL、check id/name/App 15368 和关键步骤；失败、跳过、缺失或超时不算通过。不把 caller main 的检查或 tree SHA 冒充 PR head。

## 本次授权与尚未执行

用户已明确授权：准备独立基础分支，验证后提交/推送并创建到本 Fork main 的 **Draft PR**；只开启 Actions 创建/审批 PR 开关和仓库 Issues，保留默认 token read 和 main 全部保护。两项设置已写入并读回：can_approve_pull_request_reviews=true、has_issues=true；默认 token 仍 read，完整 main 保护、其他仓库策略和原功能 PR 均未改变，定时 opt-in 变量不存在且未创建。实际提交、PR 和新 head CI 结果以 Git/GitHub 及审计记录为准。

本次不合并任何 PR、不修改原功能 PR #1、不启用定时变量、不真实执行同步写入、不发布/部署或恢复 P5 排查。原功能分支代码和远程引用不因本补丁而改变。

## 本地验证

固定工具：Node 24.22.1、pnpm 10.34.9、Git 2.38+（本机 2.47.3）。

```bash
corepack pnpm@10.34.9 install --frozen-lockfile
corepack pnpm@10.34.9 lint
corepack pnpm@10.34.9 exec vitest run src/__tests__/workflows
corepack pnpm@10.34.9 test
bash scripts/fork-ci-build.sh
```

构建只使用临时虚构 YAML 和随机构建用认证变量，成功/失败均清理；拒绝 Next.js 会自动加载的 4 种本地生产 .env 文件及符号链接，不删除操作者文件。不启动服务或浏览器。

纯 main 的 frozen/offline install、Lint、573 文件/1902 项测试及隔离构建已验证；基线构建在内存中只重定位可信构建脚本的 cd，以保证实际构建此纯 main 工作树，而不是原功能工作树。加入自动化后 frozen/offline install、Lint、3 文件/121 项工作流测试、576 文件/2023 项完整测试和隔离生产构建通过，保留两条既有 vi.unmock 警告；未放宽认证测试或超时。10 个交付文件主动诊断：9 confirmed clean、1 Markdown 无语言服务答复（inconclusive），不称全部 clean。JS/YAML 使用 Prettier，Shell 使用 bash -n（本机 Prettier 无 Shell parser，不把该工具报错当成源码失败）。不搬用功能分支的 2350 项测试作为本分支结果。

本地审计在原工作树 Git/Docker 忽略的 `config/p6-bootstrap/evidence/`，不提交凭据、真实 YAML、Session、缓存或构建产物。模拟 API/隔离 Git/bare 推送测试不是 GitHub 写权限、真实上游 PR/dispatch 或生产兼容性的端到端证明。

## 合并前及后续

1. 先核实本基础 PR 的真实 Fork verification、App 15368、head 和全部步骤，再由用户单独决定是否以 merge commit 合入 main。不放宽门禁、不 squash 或强推。
2. 文件进入默认 main 后，才具备可信手动入口。另行授权只读预检和写入演练；上游无更新的 no-op 不算真实 PR/CI 正例。还需核实内置 token 对 workflow-file 更新的限制和 Fork 调度/闲置限制。
3. 真实演练成功后再决定是否设置定时 opt-in；自动化始终等待人工审核合并，不能无人值守合并或部署。
4. 本基础 PR 若合入 main，原功能分支会缺少新的 main 祖先；后续需另行授权 merge main 到功能分支并重跑 CI，不能 rebase/force 丢弃二开历史。即使文件内容相同，strict 门禁也不能仅靠旧 head 的绿色结果代签。
5. 多地址功能的 P5 剩余验收/主 PR 合并，以及 GHCR 双架构发布与回滚是后续独立阶段，不由本补丁自动完成。
