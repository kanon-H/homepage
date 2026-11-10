#!/usr/bin/env bash
# 本地构建并发布 Docker Hub 镜像（不依赖 GitHub Actions）。
#
#   bash scripts/local-docker-release.sh              # 构建 + 冒烟 + 推送
#   bash scripts/local-docker-release.sh --build-only  # 只构建，不推送
#   bash scripts/local-docker-release.sh --dry-run     # 只校验环境，不做任何构建/推送
#
# 默认只构建 PLATFORMS 声明的平台（当前 linux/amd64）。arm64 在 QEMU 下编译会 SIGILL，
# 如需恢复请先改 scripts/fork-release.mjs 的 PLATFORMS 并自行验证。
#
# 安全边界：
#   - 凭据只从 config/dockerhub-release.env 读取，不进入 argv、镜像层或构建上下文；
#   - 构建上下文来自 Git 跟踪文件白名单，不包含 config/、.env、.git、node_modules、.next；
#   - 标签为 fork-vX.Y.Z 和 sha-<完整SHA>，不写 latest，不覆盖已存在标签。
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

ENV_FILE="config/dockerhub-release.env"
MODE="${1:-publish}"

die() {
  echo "错误：$*" >&2
  exit 1
}
note() { echo "==> $*"; }

command -v git >/dev/null 2>&1 || die "缺少 git"
command -v node >/dev/null 2>&1 || die "缺少 node"
if [ "$MODE" != "--dry-run" ]; then
  command -v docker >/dev/null 2>&1 || die "缺少 docker，请先安装并确保当前用户可执行 docker"
  docker buildx version >/dev/null 2>&1 || die "缺少 docker buildx（Docker 版本过旧）"
fi

if [ ! -f "$ENV_FILE" ]; then
  printf '错误：缺少 %s。请先执行：\n' "$ENV_FILE" >&2
  printf '  cp scripts/dockerhub-release.env.example %s\n' "$ENV_FILE" >&2
  printf '然后填写 DOCKERHUB_USERNAME / DOCKERHUB_TOKEN（该文件已被 .gitignore 忽略）\n' >&2
  exit 1
fi

# 只取需要的四个键，避免把整个文件注入环境。
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${DOCKERHUB_USERNAME:?请在 $ENV_FILE 填写 DOCKERHUB_USERNAME}"
if [ "$MODE" != "--build-only" ] && [ "$MODE" != "--dry-run" ]; then
  : "${DOCKERHUB_TOKEN:?请在 $ENV_FILE 填写 DOCKERHUB_TOKEN}"
fi

IMAGE="${DOCKERHUB_IMAGE:-${DOCKERHUB_USERNAME}/homepage}"
SHA="$(git rev-parse HEAD)"
DIRTY=""
git diff --quiet && git diff --cached --quiet || DIRTY=" (工作区有未提交改动，镜像仍按已提交内容构建)"

VERSION="${RELEASE_VERSION:-}"
if [ -z "$VERSION" ]; then
  PKG_VERSION="$(node -p "require('./package.json').version")"
  VERSION="fork-v${PKG_VERSION}"
fi
case "$VERSION" in
fork-v[0-9]*.[0-9]*.[0-9]*) ;;
*) die "RELEASE_VERSION 必须是 fork-vX.Y.Z 形式，当前为：$VERSION" ;;
esac

# 平台集合以代码里的 PLATFORMS 为唯一来源。
PLATFORM_LIST="$(node -e "
import('./scripts/fork-release.mjs').then((m) => {
  process.stdout.write(m.PLATFORMS.map((a) => 'linux/' + a).join(','));
});
")"

CREATED="$(node -p "new Date().toISOString()")"
UPSTREAM="$(git rev-parse HEAD:scripts/fork-release.mjs >/dev/null 2>&1 && echo "2e5f10134ae3961bb936d3e7c441f9a1f4a4bf4f" || echo "2e5f10134ae3961bb936d3e7c441f9a1f4a4bf4f")"

OUT_DIR="${TMPDIR:-/tmp}/homepage-local-release"
ARCHIVE="$OUT_DIR/image.tar"
# fork-image-context.mjs 固定写到 $RUNNER_TEMP/fork-release/context，这里保持一致。
CONTEXT="$OUT_DIR/fork-release/context"

note "提交：$SHA$DIRTY"
note "镜像：docker.io/${IMAGE}"
note "版本：$VERSION"
note "平台：$PLATFORM_LIST"

if [ "$MODE" = "--dry-run" ]; then
  note "dry-run：环境校验通过，未构建、未推送"
  exit 0
fi

command -v skopeo >/dev/null 2>&1 || note "提示：未找到 skopeo，构建后将跳过归档结构校验"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

note "从 Git 跟踪文件导出构建上下文（不含 config/、.env、.git、node_modules、.next）"
RELEASE_SOURCE_SHA="$SHA" RUNNER_TEMP="$OUT_DIR" node scripts/fork-image-context.mjs

note "构建镜像（$PLATFORM_LIST）"
# `type=oci` 需要 containerd image store 或 docker-container 驱动的 builder。
# 默认 docker 驱动会报 "OCI exporter is not supported"，所以这里自备一个临时 builder。
BUILDER_ARGS=()
TMP_BUILDER=""
created_builder() {
  if docker buildx inspect "$1" >/dev/null 2>&1; then
    docker buildx rm "$1" >/dev/null 2>&1 || true
  fi
}
if ! docker buildx build --help 2>/dev/null | grep -q 'output'; then
  die "docker buildx 不可用，请安装 buildx"
fi
DRIVER="$(docker buildx inspect --bootstrap 2>/dev/null | awk '/^Driver:/{print $2}')"
if [ "$DRIVER" != "docker-container" ]; then
  TMP_BUILDER="hp-release-builder-$$"
  note "当前 builder 驱动为 ${DRIVER:-unknown}，创建临时 docker-container builder：$TMP_BUILDER"
  trap 'created_builder "$TMP_BUILDER"' EXIT
  docker buildx create --name "$TMP_BUILDER" --driver docker-container --bootstrap >/dev/null ||
    die "无法创建 docker-container builder"
  BUILDER_ARGS=(--builder "$TMP_BUILDER")
fi

docker buildx build \
  ${BUILDER_ARGS[@]+"${BUILDER_ARGS[@]}"} \
  --platform "$PLATFORM_LIST" \
  --file "$CONTEXT/Dockerfile.fork" \
  --build-arg "BUILDTIME=$CREATED" \
  --build-arg "VERSION=$VERSION" \
  --build-arg "REVISION=$SHA" \
  --build-arg "UPSTREAM_REVISION=$UPSTREAM" \
  --output "type=oci,dest=$ARCHIVE" \
  "$CONTEXT"

ARCHIVE_SHA="$(sha256sum "$ARCHIVE" | cut -d ' ' -f 1)"
note "归档：$ARCHIVE"
note "SHA256：$ARCHIVE_SHA"

if [ "${SKIP_SMOKE:-}" = "1" ]; then
  note "已按 SKIP_SMOKE=1 跳过运行时冒烟（不建议）"
else
  if command -v skopeo >/dev/null 2>&1; then
    note "运行时冒烟：结构 + 原生登录/Host/挂载/身份/健康"
    RELEASE_ARCHIVE="$ARCHIVE" \
      RELEASE_SOURCE_SHA="$SHA" \
      RELEASE_VERSION="$VERSION" \
      RELEASE_UPSTREAM_SHA="$UPSTREAM" \
      RELEASE_CREATED="$CREATED" \
      node scripts/fork-image-smoke.mjs
  else
    note "跳过冒烟：缺少 skopeo。发布前建议安装后重跑。"
  fi
fi

if [ "$MODE" = "--build-only" ]; then
  note "build-only：已构建，未推送"
  note "归档保留在：$ARCHIVE"
  exit 0
fi

TAG_VERSION="$VERSION"
TAG_SHA="sha-${SHA}"

note "检查目标标签是否已存在（已存在则停止，不覆盖）"
for TAG in "$TAG_VERSION" "$TAG_SHA"; do
  if docker manifest inspect "docker.io/${IMAGE}:${TAG}" >/dev/null 2>&1; then
    die "标签已存在：${IMAGE}:${TAG}。请改用新版本号，脚本不会覆盖已有标签。"
  fi
done

note "登录 Docker Hub"
# 用 stdin 传密码，不进 argv；登录后立即清理配置目录。
DOCKER_CONFIG_DIR="$(mktemp -d)"
trap 'rm -rf "$DOCKER_CONFIG_DIR"' EXIT
printf '%s' "$DOCKERHUB_TOKEN" | DOCKER_CONFIG="$DOCKER_CONFIG_DIR" docker login \
  --username "$DOCKERHUB_USERNAME" --password-stdin docker.io >/dev/null

note "推送两个标签：$TAG_VERSION、$TAG_SHA"
for TAG in "$TAG_VERSION" "$TAG_SHA"; do
  DOCKER_CONFIG="$DOCKER_CONFIG_DIR" skopeo copy \
    --all \
    --preserve-digests \
    --retry-times=0 \
    "oci-archive:$ARCHIVE" \
    "docker://docker.io/${IMAGE}:${TAG}"
done

note "读回 digest 校验"
for TAG in "$TAG_VERSION" "$TAG_SHA"; do
  DIGEST="$(docker manifest inspect --verbose "docker.io/${IMAGE}:${TAG}" 2>/dev/null |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(j.Digest||j.digest||'')}catch{process.stdout.write('')}})" || true)"
  if [ -n "$DIGEST" ]; then
    echo "    ${IMAGE}:${TAG} -> ${DIGEST}"
  else
    echo "    ${IMAGE}:${TAG} 已推送（digest 读回需 docker manifest inspect 支持，可稍后手动核对）"
  fi
done

note "完成。已推送："
echo "    docker pull docker.io/${IMAGE}:${TAG_VERSION}"
echo "    docker pull docker.io/${IMAGE}:${TAG_SHA}"
echo "    （未写 latest；未推送 arm64）"
